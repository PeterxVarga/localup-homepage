// ============================================================
// POST /api/audit/cancel
// Cancels a booking using a management token.
// Cancellation succeeds even if email sending fails.
// ============================================================

import type { APIRoute } from 'astro';
import { isRateLimited, recordRequest, getRetryAfterSeconds } from '../../../lib/rateLimit';
import { cancelBooking } from '../../../lib/booking/cancelBooking';
import {
  sendUserCancellationEmail,
  sendAdminCancellationEmail,
} from '../../../lib/email/sendCancellationEmails';
import { getManageBookingDetails } from '../../../lib/booking/manageBooking';
import { trackEvent } from '../../../lib/booking/trackEvent';

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

  // Send emails only for a fresh cancellation.
  // Log results and track failures, but never fail the cancellation itself.
  if (!result.alreadyCancelled) {
    const lookup = await getManageBookingDetails(token);
    if (lookup.status === 'found') {
      const d = lookup.details;
      const emailParams = {
        bookingId: d.bookingId,
        businessName: d.businessName,
        name: d.name,
        email: d.email,
        slotStart: d.slotStart,
        slotEnd: d.slotEnd,
        reason,
        calendarDeleted: result.calendarDeleted,
      };

      const [customerResult, adminResult] = await Promise.all([
        sendUserCancellationEmail(emailParams),
        sendAdminCancellationEmail(emailParams),
      ]);

      const emailFailures: string[] = [];

      if (customerResult.success) {
        console.log('Customer cancellation email sent:', customerResult.emailId);
      } else {
        console.error('Customer cancellation email failed:', customerResult.error);
        emailFailures.push(`customer: ${customerResult.error}`);
      }

      if (adminResult.success) {
        console.log('Admin cancellation email sent:', adminResult.emailId);
      } else {
        console.error('Admin cancellation email failed:', adminResult.error);
        emailFailures.push(`admin: ${adminResult.error}`);
      }

      if (emailFailures.length > 0) {
        await trackEvent({
          eventName: 'cancellation_email_failed',
          sessionId: '',
          bookingId: d.bookingId,
          metadata: {
            failures: emailFailures,
            calendarDeleted: result.calendarDeleted,
          },
        });
      }
    } else {
      const reason =
        lookup.status === 'service_unavailable'
          ? 'service_unavailable_after_cancel'
          : 'manage_lookup_failed_after_cancel';
      console.error('Manage lookup failed after successful cancellation:', reason);
      await trackEvent({
        eventName: 'cancellation_email_failed',
        sessionId: '',
        metadata: {
          reason,
          calendarDeleted: result.calendarDeleted,
        },
      });
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
