// ============================================================
// POST /api/booking/reschedule
//
// Reschedules a generic booking using a management token.
// Works on public.bookings only. No email or Calendar CRUD in this slice.
// ============================================================

import type { APIRoute } from 'astro';
import {
  isRateLimited,
  recordRequest,
  getRetryAfterSeconds,
} from '../../../lib/rateLimit';
import { isSupabaseConfigured } from '../../../lib/supabase';
import { rescheduleGenericBooking } from '../../../lib/generic-booking/rescheduleBooking';

const RESCHEDULE_LIMIT = {
  namespace: 'generic_reschedule',
  max: 5,
  windowMs: 60_000,
};

function jsonResponse(
  body: unknown,
  status: number,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

const STATUS_CODE_MAP: Record<
  import('../../../lib/generic-booking/rescheduleBooking').RescheduleGenericBookingErrorCode,
  number
> = {
  not_found: 404,
  invalid_state: 409,
  service_unavailable: 503,
  cutoff_passed: 403,
  max_reschedules_reached: 403,
  booking_changed: 409,
  invalid_slot: 400,
  slot_taken: 409,
  db_error: 500,
};

export const POST: APIRoute = async ({ request }) => {
  if (isRateLimited(request, RESCHEDULE_LIMIT)) {
    const retryAfter = getRetryAfterSeconds(request, RESCHEDULE_LIMIT);
    return jsonResponse(
      {
        success: false,
        error: 'rate_limited',
        message: 'Túl sok módosítási próbálkozás. Kérlek várj egy kicsit.',
      },
      429,
      { 'Retry-After': String(retryAfter) },
    );
  }
  recordRequest(request, RESCHEDULE_LIMIT);

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
  const token = typeof bodyRecord.token === 'string' ? bodyRecord.token : '';
  const expectedOldSlotStart =
    typeof bodyRecord.expectedOldSlotStart === 'string'
      ? bodyRecord.expectedOldSlotStart
      : '';
  const newSlotStart =
    typeof bodyRecord.newSlotStart === 'string'
      ? bodyRecord.newSlotStart
      : '';

  if (!token || !expectedOldSlotStart || !newSlotStart) {
    return jsonResponse(
      {
        success: false,
        error: 'missing_fields',
        message: 'Hiányzó adatok.',
      },
      400,
    );
  }

  const result = await rescheduleGenericBooking({
    rawToken: token,
    expectedOldSlotStart,
    newSlotStart,
  });

  if (!result.success) {
    return jsonResponse(
      { success: false, error: result.error, message: result.message },
      STATUS_CODE_MAP[result.error] ?? 400,
    );
  }

  return jsonResponse(
    {
      success: true,
      bookingId: result.bookingId,
      oldSlotStart: result.oldSlotStart,
      oldSlotEnd: result.oldSlotEnd,
      newSlotStart: result.newSlotStart,
      newSlotEnd: result.newSlotEnd,
      rescheduleCount: result.rescheduleCount,
      idempotent: result.idempotent ?? false,
    },
    200,
  );
};
