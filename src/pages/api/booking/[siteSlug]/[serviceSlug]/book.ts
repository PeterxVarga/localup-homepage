// ============================================================
// POST /api/booking/[siteSlug]/[serviceSlug]/book
//
// Creates a generic booking. Server resolves site/service from route slugs;
// the request body may only contain customer and slot fields.
// Full availability revalidation happens before insert.
// ============================================================

import type { APIRoute } from 'astro';
import { isSupabaseConfigured } from '../../../../../lib/supabase';
import { genericBookingRequestSchema } from '../../../../../lib/generic-booking/validation';
import { createGenericBooking } from '../../../../../lib/generic-booking/createBooking';
import { generateAvailableSlots } from '../../../../../lib/booking/generateSlots';
import {
  resolveGenericAvailabilityProvider,
  bindGetFreeBusy,
} from '../../../../../lib/calendar/genericAvailabilityProvider';
import { getBookingServiceContext } from '../../../../../lib/booking-service/queries';
import {
  isRateLimited,
  recordRequest,
  getRetryAfterSeconds,
} from '../../../../../lib/rateLimit';

const BOOKING_LIMIT = {
  namespace: 'generic_book',
  max: 3,
  windowMs: 10 * 60_000,
};

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

export const POST: APIRoute = async ({ params, request }) => {
  // Rate limit before parsing the body.
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

  const siteSlug = typeof params.siteSlug === 'string' ? params.siteSlug : '';
  const serviceSlug =
    typeof params.serviceSlug === 'string' ? params.serviceSlug : '';

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { success: false, error: 'invalid_json', message: 'Invalid request' },
      400,
    );
  }

  // Honeypot: silently accept so bots do not retry with different payloads.
  if ((body as Record<string, unknown>)?.honeypot) {
    return jsonResponse({ success: true, bookingId: 'bot-blocked' }, 200);
  }

  const parsed = genericBookingRequestSchema.safeParse(body);
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

  let service;
  try {
    service = await getBookingServiceContext(siteSlug, serviceSlug);
  } catch (err) {
    console.error('generic booking service context error:', err);
    return jsonResponse(
      {
        success: false,
        error: 'service_unavailable',
        message: 'Booking service is not configured',
      },
      503,
    );
  }

  if (!service.publicBookingEnabled) {
    return jsonResponse(
      {
        success: false,
        error: 'service_unavailable',
        message: 'Booking service is not configured',
      },
      503,
    );
  }

  // Full availability revalidation using the same generator as the slot list.
  try {
    const requestedStart = new Date(input.slotStart).toISOString();
    const requestedEnd = new Date(input.slotEnd).toISOString();
    const provider = await resolveGenericAvailabilityProvider(
      service.siteId,
      service.siteSlug,
    );
    const availableDays = await generateAvailableSlots(
      service,
      bindGetFreeBusy(provider),
    );
    const available = availableDays.some((day) =>
      day.slots.some(
        (slot) =>
          slot.start === requestedStart && slot.end === requestedEnd,
      ),
    );

    if (!available) {
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
    console.error('generic availability revalidation error:', err);
    return jsonResponse(
      {
        success: false,
        error: 'service_unavailable',
        message:
          'A foglalási időpont most nem ellenőrizhető. Kérlek próbáld újra később.',
      },
      503,
    );
  }

  const result = await createGenericBooking(input, service);
  if (!result.success) {
    const statusMap: Record<
      typeof result.error,
      number
    > = {
      invalid_slot: 400,
      slot_taken: 409,
      db_error: 500,
    };
    return jsonResponse(result, statusMap[result.error] ?? 503);
  }

  return jsonResponse(
    {
      success: true,
      bookingId: result.bookingId,
      slotStart: result.slotStart,
      slotEnd: result.slotEnd,
    },
    200,
  );
};
