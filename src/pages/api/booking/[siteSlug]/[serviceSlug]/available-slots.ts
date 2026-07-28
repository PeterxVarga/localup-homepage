// ============================================================
// GET /api/booking/[siteSlug]/[serviceSlug]/available-slots
//
// Returns available slots for any active site/service pair, filtering against
// audit bookings, generic bookings, and Google Calendar free/busy.
// Fail-closed: missing/inactive site or service returns 503 without details.
// ============================================================

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { isSupabaseConfigured } from '../../../../../lib/supabase';
import { generateAvailableSlots } from '../../../../../lib/booking/generateSlots';
import { getBookingServiceContext } from '../../../../../lib/booking-service/queries';
import {
  resolveGenericAvailabilityProvider,
  bindGetFreeBusy,
} from '../../../../../lib/calendar/genericAvailabilityProvider';
import {
  calculateQuoteForService,
  PublicQuoteServiceError,
} from '../../../../../lib/booking-pricing/publicQuoteService';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseOptionIds(url: URL): { optionIds: string[] } | { error: string } {
  const raw = url.searchParams.getAll('optionId');
  if (raw.length === 0) {
    return { optionIds: [] };
  }

  if (raw.length > 20) {
    return { error: 'At most 20 optionIds are allowed' };
  }

  const uuidSchema = z.uuid({ message: 'Each optionId must be a valid UUID' });
  for (const value of raw) {
    const parsed = uuidSchema.safeParse(value);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid optionId' };
    }
  }

  return { optionIds: raw };
}

export const GET: APIRoute = async ({ params, request }) => {
  const siteSlug = typeof params.siteSlug === 'string' ? params.siteSlug : '';
  const serviceSlug =
    typeof params.serviceSlug === 'string' ? params.serviceSlug : '';

  const optionIdResult = parseOptionIds(new URL(request.url));
  if ('error' in optionIdResult) {
    return jsonResponse(
      { success: false, error: 'validation', message: optionIdResult.error },
      400,
    );
  }

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

    let quote;
    try {
      quote = await calculateQuoteForService(service, optionIdResult.optionIds);
    } catch (err) {
      if (err instanceof PublicQuoteServiceError) {
        const status = err.code === 'service_unavailable' ? 503 : 400;
        return jsonResponse(
          { success: false, error: err.code, message: err.message },
          status,
        );
      }

      console.error('available-slots quote error: unexpected failure');
      return jsonResponse(
        {
          success: false,
          error: 'service_unavailable',
          message: 'Failed to load available slots',
        },
        503,
      );
    }

    const effectiveService = {
      ...service,
      durationMinutes: quote.durationMinutes,
    };

    const provider = await resolveGenericAvailabilityProvider(
      service.siteId,
      service.siteSlug,
    );
    const slots = await generateAvailableSlots(
      effectiveService,
      bindGetFreeBusy(provider),
    );

    return new Response(JSON.stringify({ slots }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err) {
    console.error('generic available-slots error: unexpected failure');
    return new Response(
      JSON.stringify({
        error: 'service_unavailable',
        message: 'Failed to load available slots',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
