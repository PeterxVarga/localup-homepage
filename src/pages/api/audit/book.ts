// ============================================================
// POST /api/audit/book
// Full booking flow: validate, check slot, insert, calendar, email, track
// ============================================================

import type { APIRoute } from 'astro';
import { auditBookingSchema } from '../../../lib/audit/validation';
import { isSupabaseConfigured } from '../../../lib/supabase';
import { createBooking, updateBookingStatus } from '../../../lib/booking/createBooking';
import { trackEvent } from '../../../lib/booking/trackEvent';
import { syncBookingToCalendar, isSlotAvailable } from '../../../lib/calendar/syncBookingToCalendar';
import { sendBookingConfirmation } from '../../../lib/email/sendBookingConfirmation';
import { sendAdminNotification } from '../../../lib/email/sendAdminNotification';

// Simple in-memory rate limiter (V1: per IP, 3 requests per minute)
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(ip) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  rateLimitMap.set(ip, recent);
  return recent.length >= RATE_LIMIT_MAX;
}

function recordRequest(ip: string): void {
  const timestamps = rateLimitMap.get(ip) ?? [];
  timestamps.push(Date.now());
  rateLimitMap.set(ip, timestamps);
}

function getClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('cf-connecting-ip') ||
    'unknown'
  );
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  const ip = getClientIp(request);

  // Rate limit
  if (isRateLimited(ip)) {
    return jsonResponse(
      { success: false, error: 'rate_limited', message: 'Too many requests. Please wait.' },
      429,
    );
  }
  recordRequest(ip);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { success: false, error: 'invalid_json', message: 'Invalid request' },
      400,
    );
  }

  const bodyRecord = body as Record<string, unknown>;

  // --- Best-effort tracking path (used by the client funnel events) ---
  if (bodyRecord?._trackOnly === true) {
    const sessionId = typeof bodyRecord.sessionId === 'string' ? bodyRecord.sessionId : crypto.randomUUID();
    const eventName = typeof bodyRecord.eventName === 'string' ? bodyRecord.eventName : 'audit_unknown_event';
    const metadata = typeof bodyRecord.metadata === 'object' && bodyRecord.metadata !== null
      ? (bodyRecord.metadata as Record<string, unknown>)
      : {};

    await trackEvent({
      eventName: eventName as import('../../../lib/booking/trackEvent').AuditEventName,
      sessionId,
      ctaLocation: typeof bodyRecord.ctaLocation === 'string' ? bodyRecord.ctaLocation : undefined,
      sourceUrl: typeof bodyRecord.sourceUrl === 'string' ? bodyRecord.sourceUrl : undefined,
      metadata,
    });

    return jsonResponse({ success: true, tracked: true }, 200);
  }

  // Honeypot check
  if (bodyRecord?.honeypot) {
    // Silently accept (bot filled hidden field)
    return jsonResponse({ success: true, bookingId: 'bot-blocked' }, 200);
  }

  // Validate
  const parsed = auditBookingSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      { success: false, error: 'validation', message: parsed.error.issues[0]?.message || 'Invalid input' },
      400,
    );
  }

  const input = parsed.data;
  const sessionId = input.sessionId || crypto.randomUUID();

  // --- Service availability guard ---
  // Supabase is the source of truth for bookings, tracking, and race-condition
  // protection. If it's not configured, we cannot accept bookings.
  if (!isSupabaseConfigured()) {
    return jsonResponse(
      { success: false, error: 'service_unavailable', message: 'Booking service is not configured' },
      503,
    );
  }

  // Track: booking submitted
  await trackEvent({
    eventName: 'audit_booking_submitted',
    sessionId,
    ctaLocation: input.ctaLocation,
    sourceUrl: input.sourceUrl,
    metadata: { goals: input.goals, businessType: input.businessType },
  });

  // 1. Slot re-check: aggregated freeBusy across all providers
  try {
    const available = await isSlotAvailable(input.slotStart, input.slotEnd);
    if (!available) {
      await trackEvent({
        eventName: 'audit_booking_failed',
        sessionId,
        metadata: { reason: 'slot_conflict_freebusy' },
      });
      return jsonResponse(
        {
          success: false,
          error: 'slot_taken',
          message: 'That time was just taken. Please choose another available slot.',
        },
        409,
      );
    }
  } catch (err) {
    console.error('freeBusy check error:', err);
    // Continue with booking — don't block on freeBusy failure
  }

  // 2. Insert booking (DB-level race condition protection via unique index)
  const result = await createBooking(input);
  if (!result.success) {
    return jsonResponse(result, result.error === 'slot_taken' ? 409 : 500);
  }

  const { bookingId } = result;

  // 3. Sync to calendar providers (provider-agnostic)
  const syncOutcome = await syncBookingToCalendar({
    businessName: input.businessName,
    name: input.name,
    email: input.email,
    phone: input.phone,
    websiteUrl: input.websiteUrl,
    city: input.city,
    businessType: input.businessType,
    goals: input.goals,
    notes: input.notes,
    ctaLocation: input.ctaLocation,
    slotStart: input.slotStart,
    slotEnd: input.slotEnd,
  });

  if (syncOutcome.overallStatus === 'synced' || syncOutcome.overallStatus === 'partially_synced') {
    await updateBookingStatus(bookingId, 'booked', syncOutcome.primaryEventId ?? undefined);
  } else {
    await updateBookingStatus(bookingId, 'calendar_failed');
  }

  const finalStatus =
    syncOutcome.overallStatus === 'synced' || syncOutcome.overallStatus === 'partially_synced'
      ? 'booked'
      : 'calendar_failed';

  // 4. Send emails
  const slotDate = new Date(input.slotStart);
  const dateStr = slotDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = slotDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  const endDate = new Date(input.slotEnd);
  const endTimeStr = endDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  const goalLabels = input.goals.map((g) => {
    const labels: Record<string, string> = {
      more_visibility: 'More local visibility',
      more_calls: 'More calls / bookings',
      better_website: 'Better website',
      more_reviews: 'More reviews',
      not_sure: 'Not sure yet',
    };
    return labels[g] || g;
  });

  // Fire and forget emails (don't block response)
  Promise.allSettled([
    sendBookingConfirmation({
      email: input.email,
      businessName: input.businessName,
      date: dateStr,
      timeRange: `${timeStr} – ${endTimeStr}`,
      goals: goalLabels,
      bookingId,
    }),
    sendAdminNotification({
      businessName: input.businessName,
      name: input.name,
      email: input.email,
      phone: input.phone,
      websiteUrl: input.websiteUrl,
      city: input.city,
      businessType: input.businessType,
      goals: goalLabels,
      notes: input.notes,
      slotStart: input.slotStart,
      slotEnd: input.slotEnd,
      ctaLocation: input.ctaLocation,
      status: finalStatus,
      bookingId,
    }),
  ]).catch((err) => console.error('Email send error:', err));

  // 5. Track: confirmed or failed
  await trackEvent({
    eventName:
      syncOutcome.overallStatus === 'failed' || syncOutcome.overallStatus === 'not_configured'
        ? 'audit_booking_failed'
        : 'audit_booking_confirmed',
    sessionId,
    bookingId,
    metadata: { status: finalStatus, goals: input.goals },
  });

  return jsonResponse(
    {
      success: true,
      bookingId,
      slotStart: input.slotStart,
      slotEnd: input.slotEnd,
      status: finalStatus,
    },
    200,
  );
};
