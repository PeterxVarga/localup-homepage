// ============================================================
// GET /api/audit/manage/[token]
// Returns non-sensitive booking details for the manage page.
// Never mutates data.
// ============================================================

import type { APIRoute } from 'astro';
import { isRateLimited, recordRequest, getRetryAfterSeconds } from '../../../../lib/rateLimit';
import { getManageBookingDetails } from '../../../../lib/booking/manageBooking';

const MANAGE_LIMIT = { namespace: 'manage', max: 60, windowMs: 60_000 };

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

export const GET: APIRoute = async ({ params, request }) => {
  if (isRateLimited(request, MANAGE_LIMIT)) {
    const retryAfter = getRetryAfterSeconds(request, MANAGE_LIMIT);
    return jsonResponse(
      { success: false, error: 'rate_limited', message: 'Túl sok kérés.' },
      429,
      { 'Retry-After': String(retryAfter) },
    );
  }
  recordRequest(request, MANAGE_LIMIT);

  const rawToken = params.token;
  if (!rawToken || typeof rawToken !== 'string') {
    return jsonResponse({ success: false, error: 'not_found' }, 404);
  }

  const result = await getManageBookingDetails(rawToken);

  if (!result.found) {
    return jsonResponse({ success: false, error: 'not_found' }, 404);
  }

  const d = result.details;
  return jsonResponse(
    {
      success: true,
      booking: {
        bookingId: d.bookingId,
        businessName: d.businessName,
        name: d.name,
        slotStart: d.slotStart,
        slotEnd: d.slotEnd,
        meetLink: d.meetLink,
        isCancelled: d.isCancelled,
        isExpired: d.isExpired,
        cancelCutoffPassed: d.cancelCutoffPassed,
        rescheduleCutoffPassed: d.rescheduleCutoffPassed,
        rescheduleCount: d.rescheduleCount,
        maxReschedules: d.maxReschedules,
      },
    },
    200,
  );
};
