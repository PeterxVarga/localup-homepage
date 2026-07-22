// ============================================================
// GET /api/audit/available-slots
// Generates available time slots, filtering booked + freeBusy
// ============================================================

import type { APIRoute } from 'astro';
import { isSupabaseConfigured } from '../../../lib/supabase';
import { generateAvailableSlots } from '../../../lib/booking/generateSlots';
import { getAggregatedFreeBusy } from '../../../lib/calendar/syncBookingToCalendar';
import { getBookingServiceContext } from '../../../lib/booking-service/queries';
import {
  LOCALUP_SITE_SLUG,
  LOCALUP_AUDIT_SERVICE_SLUG,
} from '../../../lib/booking-service/constants';

export const GET: APIRoute = async () => {
  try {
    // Supabase is required for accurate booked-slot filtering and race-condition
    // protection. Without it we cannot return reliable availability.
    if (!isSupabaseConfigured()) {
      return new Response(
        JSON.stringify({ error: 'service_unavailable', message: 'Booking service is not configured' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const service = await getBookingServiceContext(
      LOCALUP_SITE_SLUG,
      LOCALUP_AUDIT_SERVICE_SLUG,
    );
    const slots = await generateAvailableSlots(service, getAggregatedFreeBusy);

    return new Response(JSON.stringify({ slots }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err) {
    console.error('available-slots error:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to load available slots' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
