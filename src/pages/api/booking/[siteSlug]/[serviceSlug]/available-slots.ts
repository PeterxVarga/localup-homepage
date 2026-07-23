// ============================================================
// GET /api/booking/[siteSlug]/[serviceSlug]/available-slots
//
// Returns available slots for any active site/service pair, filtering against
// audit bookings, generic bookings, and Google Calendar free/busy.
// Fail-closed: missing/inactive site or service returns 503 without details.
// ============================================================

import type { APIRoute } from 'astro';
import { isSupabaseConfigured } from '../../../../../lib/supabase';
import { generateAvailableSlots } from '../../../../../lib/booking/generateSlots';
import { getBookingServiceContext } from '../../../../../lib/booking-service/queries';
import { resolveGenericAvailabilityProvider } from '../../../../../lib/calendar/genericAvailabilityProvider';

export const GET: APIRoute = async ({ params }) => {
  const siteSlug = typeof params.siteSlug === 'string' ? params.siteSlug : '';
  const serviceSlug =
    typeof params.serviceSlug === 'string' ? params.serviceSlug : '';

  if (!isSupabaseConfigured()) {
    return new Response(
      JSON.stringify({
        error: 'service_unavailable',
        message: 'Booking service is not configured',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  try {
    const service = await getBookingServiceContext(siteSlug, serviceSlug);

    if (!service.publicBookingEnabled) {
      return new Response(
        JSON.stringify({
          error: 'service_unavailable',
          message: 'Booking service is not configured',
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const provider = await resolveGenericAvailabilityProvider(
      service.siteId,
      service.siteSlug,
    );
    const slots = await generateAvailableSlots(
      service,
      (timeMin, timeMax) => provider.getFreeBusy(timeMin, timeMax),
    );

    return new Response(JSON.stringify({ slots }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err) {
    console.error('generic available-slots error:', err);
    return new Response(
      JSON.stringify({
        error: 'service_unavailable',
        message: 'Failed to load available slots',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
