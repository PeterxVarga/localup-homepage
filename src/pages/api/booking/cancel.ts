// ============================================================
// POST /api/booking/cancel
//
// Cancels a generic booking using a management token.
// Works on public.bookings only. No email or Calendar CRUD in this slice.
// ============================================================

import type { APIRoute } from 'astro';
import {
  isRateLimited,
  recordRequest,
  getRetryAfterSeconds,
} from '../../../lib/rateLimit';
import { isSupabaseConfigured } from '../../../lib/supabase';
import { cancelGenericBooking } from '../../../lib/generic-booking/cancelBooking';

const CANCEL_LIMIT = {
  namespace: 'generic_cancel',
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
  import('../../../lib/generic-booking/cancelBooking').CancelGenericBookingErrorCode,
  number
> = {
  not_found: 404,
  invalid_state: 409,
  service_unavailable: 503,
  cutoff_passed: 403,
  db_error: 500,
};

export const POST: APIRoute = async ({ request }) => {
  if (isRateLimited(request, CANCEL_LIMIT)) {
    const retryAfter = getRetryAfterSeconds(request, CANCEL_LIMIT);
    return jsonResponse(
      {
        success: false,
        error: 'rate_limited',
        message: 'Túl sok lemondási próbálkozás. Kérlek várj egy kicsit.',
      },
      429,
      { 'Retry-After': String(retryAfter) },
    );
  }
  recordRequest(request, CANCEL_LIMIT);

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
  const reason =
    typeof bodyRecord.reason === 'string' ? bodyRecord.reason : undefined;

  if (!token) {
    return jsonResponse(
      { success: false, error: 'missing_token', message: 'Hiányzó token.' },
      400,
    );
  }

  const result = await cancelGenericBooking(token, reason);

  if (!result.success) {
    return jsonResponse(
      { success: false, error: result.error, message: result.message },
      STATUS_CODE_MAP[result.error] ?? 400,
    );
  }

  return jsonResponse(
    { success: true, status: 'cancelled' },
    200,
  );
};
