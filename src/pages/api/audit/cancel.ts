// ============================================================
// POST /api/audit/cancel
// Cancels a booking using a management token.
// ============================================================

import type { APIRoute } from 'astro';
import { isRateLimited, recordRequest, getRetryAfterSeconds } from '../../../lib/rateLimit';
import { cancelBooking } from '../../../lib/booking/cancelBooking';
import { sendUserCancellationEmail, sendAdminCancellationEmail } from '../../../lib/email/sendCancellationEmails';
import { getManageBookingDetails } from '../../../lib/booking/manageBooking';

const CANCEL_LIMIT = { namespace: 'cancel', max: 5, windowMs: 60_000 };

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: 'invalid_json' }, 400);
  }

  const bodyRecord = body as Record<string, unknown>;
  const token = typeof bodyRecord.token === 'string' ? bodyRecord.token : '';
  const reason = typeof bodyRecord.reason === 'string' ? bodyRecord.reason : undefined;

  if (!token) {
    return jsonResponse(
      { success: false, error: 'missing_token', message: 'Hiányzó token.' },
      400,
    );
  }

  const result = await cancelBooking(token, reason);

  if (!result.success) {
    return jsonResponse(
      { success: false, error: result.error, message: result.message },
      result.status ?? 400,
    );
  }

  // Send emails only for a fresh cancellation
  if (!result.alreadyCancelled) {
    const lookup = await getManageBookingDetails(token);
    if (lookup.found) {
      const d = lookup.details;
      Promise.allSettled([
        sendUserCancellationEmail({
          bookingId: d.bookingId,
          businessName: d.businessName,
          name: d.name,
          email: d.email,
          slotStart: d.slotStart,
          slotEnd: d.slotEnd,
          reason,
          calendarDeleted: result.calendarDeleted,
        }),
        sendAdminCancellationEmail({
          bookingId: d.bookingId,
          businessName: d.businessName,
          name: d.name,
          email: d.email,
          slotStart: d.slotStart,
          slotEnd: d.slotEnd,
          reason,
          calendarDeleted: result.calendarDeleted,
        }),
      ]).catch((err) => console.error('Cancellation email error:', err));
    }
  }

  return jsonResponse(
    {
      success: true,
      status: 'cancelled',
      alreadyCancelled: result.alreadyCancelled,
      calendarDeleted: result.calendarDeleted,
    },
    200,
  );
};
