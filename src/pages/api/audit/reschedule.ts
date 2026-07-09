// ============================================================
// POST /api/audit/reschedule
// Reschedules an existing booking to a new slot.
// ============================================================

import type { APIRoute } from 'astro';
import { isRateLimited, recordRequest, getRetryAfterSeconds } from '../../../lib/rateLimit';
import { rescheduleBooking } from '../../../lib/booking/rescheduleBooking';
import { sendUserRescheduleEmail, sendAdminRescheduleEmail } from '../../../lib/email/sendRescheduleEmails';
import { trackEvent } from '../../../lib/booking/trackEvent';

const RESCHEDULE_LIMIT = { namespace: 'reschedule', max: 5, windowMs: 60_000 };

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: 'invalid_json' }, 400);
  }

  const bodyRecord = body as Record<string, unknown>;
  const token = typeof bodyRecord.token === 'string' ? bodyRecord.token : '';
  const expectedOldSlotStart =
    typeof bodyRecord.expectedOldSlotStart === 'string'
      ? bodyRecord.expectedOldSlotStart
      : '';
  const newSlotStart =
    typeof bodyRecord.newSlotStart === 'string' ? bodyRecord.newSlotStart : '';

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

  const result = await rescheduleBooking({
    rawToken: token,
    expectedOldSlotStart,
    newSlotStart,
  });

  if (!result.success) {
    return jsonResponse(
      { success: false, error: result.error, message: result.message },
      result.status,
    );
  }

  // Send confirmation emails — never fail the reschedule because of email errors
  if (!result.idempotent) {
    const emailParams = {
      bookingId: result.bookingId,
      businessName: result.businessName,
      name: result.name,
      email: result.email,
      oldSlotStart: result.oldSlotStart,
      oldSlotEnd: result.oldSlotEnd,
      newSlotStart: result.newSlotStart,
      newSlotEnd: result.newSlotEnd,
      meetLink: result.meetLink,
      manageToken: token,
      rescheduleCount: result.rescheduleCount,
    };

    const [customerResult, adminResult] = await Promise.all([
      sendUserRescheduleEmail(emailParams),
      sendAdminRescheduleEmail(emailParams),
    ]);

    const emailFailures: string[] = [];

    if (customerResult.success) {
      console.log('Customer reschedule email sent:', customerResult.emailId);
    } else {
      console.error('Customer reschedule email failed:', customerResult.error);
      emailFailures.push(`customer: ${customerResult.error}`);
    }

    if (adminResult.success) {
      console.log('Admin reschedule email sent:', adminResult.emailId);
    } else {
      console.error('Admin reschedule email failed:', adminResult.error);
      emailFailures.push(`admin: ${adminResult.error}`);
    }

    if (emailFailures.length > 0) {
      await trackEvent({
        eventName: 'reschedule_email_failed',
        sessionId: '',
        bookingId: result.bookingId,
        metadata: { failures: emailFailures },
      });
    }
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
