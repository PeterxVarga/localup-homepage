// ============================================================
// GET /api/booking/manage/[token]
//
// Returns non-sensitive generic booking details for the manage page.
// Works on public.bookings only. Never mutates data.
// ============================================================

import type { APIRoute } from 'astro';
import {
  isRateLimited,
  recordRequest,
  getRetryAfterSeconds,
} from '../../../../lib/rateLimit';
import { isSupabaseConfigured } from '../../../../lib/supabase';
import { getManageBookingDetails } from '../../../../lib/generic-booking/manageBooking';

const MANAGE_LIMIT = { namespace: 'generic_manage', max: 60, windowMs: 60_000 };

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

  const rawToken = params.token;
  if (!rawToken || typeof rawToken !== 'string') {
    return jsonResponse(
      { success: false, error: 'not_found', message: 'Érvénytelen link.' },
      404,
    );
  }

  const result = await getManageBookingDetails(rawToken);

  if (result.status === 'not_found') {
    return jsonResponse(
      {
        success: false,
        error: 'not_found',
        message: 'Érvénytelen vagy lejárt link.',
      },
      404,
    );
  }

  if (result.status === 'service_unavailable') {
    return jsonResponse(
      {
        success: false,
        error: 'service_unavailable',
        message:
          'A foglalási adatok átmenetileg nem érhetők el. Kérlek próbáld újra később.',
      },
      503,
    );
  }

  const d = result.details;
  return jsonResponse(
    {
      success: true,
      booking: {
        bookingId: d.bookingId,
        siteSlug: d.siteSlug,
        serviceSlug: d.serviceSlug,
        name: d.name,
        email: d.email,
        slotStart: d.slotStart,
        slotEnd: d.slotEnd,
        isCancelled: d.isCancelled,
        cancelCutoffPassed: d.cancelCutoffPassed,
        rescheduleCutoffPassed: d.rescheduleCutoffPassed,
        rescheduleCount: d.rescheduleCount,
        maxReschedules: d.maxReschedules,
      },
    },
    200,
  );
};
