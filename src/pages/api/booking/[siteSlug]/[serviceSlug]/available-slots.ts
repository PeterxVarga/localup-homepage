// ============================================================
// GET / POST /api/booking/[siteSlug]/[serviceSlug]/available-slots
//
// Returns available slots for any active site/service pair, filtering against
// audit bookings, generic bookings, and Google Calendar free/busy.
//
// GET (legacy): only optionIds can be passed as query params.
// POST: accepts a JSON body with optionIds and typed intakeData. POST is the
// preferred method for dynamic flows that derive pricing options from intake
// (e.g. dog-weight-kg → dog-size), because intake data must not appear in URLs.
//
// Both methods use complete selection validation: only a full, strict option
// contract can block calendar time.
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
import { quoteRequestSchema } from '../../../../../lib/booking-pricing/validation';
import type { BookingIntakeData } from '../../../../../lib/booking-intake/types';

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function parseQueryOptionIds(url: URL): { optionIds: string[] } | { error: string } {
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

async function loadSlots(
  siteSlug: string,
  serviceSlug: string,
  optionIds: string[],
  intakeData: BookingIntakeData,
): Promise<Response> {
  if (!isSupabaseConfigured()) {
    return jsonResponse(
      { error: 'service_unavailable', message: 'Booking service is not configured' },
      503,
    );
  }

  try {
    const service = await getBookingServiceContext(siteSlug, serviceSlug);

    if (!service.publicBookingEnabled) {
      return jsonResponse(
        { error: 'service_unavailable', message: 'Booking service is not configured' },
        503,
      );
    }

    let quote;
    try {
      quote = await calculateQuoteForService(
        service,
        optionIds,
        intakeData,
        {},
        'complete',
      );
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
        { success: false, error: 'service_unavailable', message: 'Failed to load available slots' },
        503,
      );
    }

    const effectiveService = {
      ...service,
      durationMinutes: quote.durationMaxMinutes,
      maxDurationMinutes: null,
    };

    const provider = await resolveGenericAvailabilityProvider(
      service.siteId,
      service.siteSlug,
    );
    const slots = await generateAvailableSlots(
      effectiveService,
      bindGetFreeBusy(provider),
    );

    return jsonResponse({ slots }, 200, { 'Cache-Control': 'no-cache' });
  } catch (err) {
    console.error('generic available-slots error: unexpected failure');
    return jsonResponse(
      { error: 'service_unavailable', message: 'Failed to load available slots' },
      503,
    );
  }
}

export const GET: APIRoute = async ({ params, request }) => {
  const siteSlug = typeof params.siteSlug === 'string' ? params.siteSlug : '';
  const serviceSlug =
    typeof params.serviceSlug === 'string' ? params.serviceSlug : '';

  const optionIdResult = parseQueryOptionIds(new URL(request.url));
  if ('error' in optionIdResult) {
    return jsonResponse(
      { success: false, error: 'validation', message: optionIdResult.error },
      400,
    );
  }

  return loadSlots(siteSlug, serviceSlug, optionIdResult.optionIds, {});
};

export const POST: APIRoute = async ({ params, request }) => {
  const siteSlug = typeof params.siteSlug === 'string' ? params.siteSlug : '';
  const serviceSlug =
    typeof params.serviceSlug === 'string' ? params.serviceSlug : '';

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { success: false, error: 'invalid_request', message: 'Invalid JSON body' },
      400,
    );
  }

  const parsed = quoteRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      { success: false, error: 'invalid_request', message: 'Invalid request body' },
      400,
    );
  }

  return loadSlots(
    siteSlug,
    serviceSlug,
    parsed.data.optionIds,
    parsed.data.intakeData as BookingIntakeData,
  );
};
