// ============================================================
// POST /api/audit/book
// Full booking flow: validate, check slot, insert, calendar, email, track
// Rate limit: 3 real booking attempts / 10 min / IP
// ============================================================

import type { APIRoute } from 'astro';
import { auditBookingSchema } from '../../../lib/audit/validation';
import { isSupabaseConfigured } from '../../../lib/supabase';
import { createBooking, updateBookingCalendarSync } from '../../../lib/booking/createBooking';
import { trackEvent } from '../../../lib/booking/trackEvent';
import { syncBookingToCalendar, isSlotAvailable } from '../../../lib/calendar/syncBookingToCalendar';
import { sendBookingConfirmation } from '../../../lib/email/sendBookingConfirmation';
import { sendAdminNotification } from '../../../lib/email/sendAdminNotification';
import { isRateLimited, recordRequest, getRetryAfterSeconds } from '../../../lib/rateLimit';

const BOOKING_LIMIT = { namespace: 'book', max: 3, windowMs: 10 * 60_000 };

function jsonResponse(
  body: unknown,
  status: number,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export const POST: APIRoute = async ({ request }) => {
  // Rate limit: only real booking submissions are counted
  if (isRateLimited(request, BOOKING_LIMIT)) {
    const retryAfter = getRetryAfterSeconds(request, BOOKING_LIMIT);
    return jsonResponse(
      {
        success: false,
        error: 'rate_limited',
        message:
          'Túl sok foglalási próbálkozás. Kérlek várj pár percet, majd próbáld újra.',
      },
      429,
      { 'Retry-After': String(retryAfter) },
    );
  }
  recordRequest(request, BOOKING_LIMIT);

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

  // Honeypot check
  if (bodyRecord?.honeypot) {
    // Silently accept (bot filled hidden field)
    return jsonResponse({ success: true, bookingId: 'bot-blocked' }, 200);
  }

  // Validate
  const parsed = auditBookingSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      {
        success: false,
        error: 'validation',
        message: parsed.error.issues[0]?.message || 'Invalid input',
      },
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
      {
        success: false,
        error: 'service_unavailable',
        message: 'Booking service is not configured',
      },
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
          message:
            'That time was just taken. Please choose another available slot.',
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

  const { bookingId, managementToken } = result;

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

  const calendarSyncStatus: 'synced' | 'failed' =
    syncOutcome.overallStatus === 'synced' ||
    syncOutcome.overallStatus === 'partially_synced'
      ? 'synced'
      : 'failed';

  await updateBookingCalendarSync(
    bookingId,
    calendarSyncStatus,
    syncOutcome.primaryEventId ?? undefined,
    syncOutcome.meetLink,
  );

  const finalStatus = calendarSyncStatus === 'synced' ? 'booked' : 'calendar_failed';

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
      meetLink: syncOutcome.meetLink,
      manageToken: managementToken,
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
      meetLink: syncOutcome.meetLink,
    }),
  ]).catch((err) => console.error('Email send error:', err));

  // 5. Track: confirmed or failed
  await trackEvent({
    eventName:
      syncOutcome.overallStatus === 'failed' ||
      syncOutcome.overallStatus === 'not_configured'
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
