// ============================================================
// POST /api/booking/[siteSlug]/[serviceSlug]/quote
//
// Calculates a server-side price and duration quote from option IDs only.
// Rejects any client-supplied price, duration, currency, pricing mode,
// label, or delta.
// Fail-closed: invalid input returns 400; missing/inactive/non-public
// config returns 503 without details.
// ============================================================

import type { APIRoute } from 'astro';
import { isSupabaseConfigured } from '../../../../../lib/supabase';
import { quoteRequestSchema } from '../../../../../lib/booking-pricing/validation';
import {
  getPublicQuote,
  PublicQuoteServiceError,
} from '../../../../../lib/booking-pricing/publicQuoteService';
import {
  isRateLimited,
  recordRequest,
  getRetryAfterSeconds,
} from '../../../../../lib/rateLimit';

const QUOTE_LIMIT = {
  namespace: 'generic_quote',
  max: 10,
  windowMs: 60_000,
};

function jsonResponse(
  body: unknown,
  status: number,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export const POST: APIRoute = async ({ params, request }) => {
  if (isRateLimited(request, QUOTE_LIMIT)) {
    const retryAfter = getRetryAfterSeconds(request, QUOTE_LIMIT);
    return jsonResponse(
      { error: 'rate_limited' },
      429,
      { 'Retry-After': String(retryAfter) },
    );
  }
  recordRequest(request, QUOTE_LIMIT);

  if (!isSupabaseConfigured()) {
    return jsonResponse({ error: 'service_unavailable' }, 503);
  }

  const siteSlug = typeof params.siteSlug === 'string' ? params.siteSlug : '';
  const serviceSlug =
    typeof params.serviceSlug === 'string' ? params.serviceSlug : '';

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_request' }, 400);
  }

  const parsed = quoteRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      { error: 'invalid_request' },
      400,
    );
  }

  try {
    const quote = await getPublicQuote(
      siteSlug,
      serviceSlug,
      parsed.data.optionIds,
    );
    return jsonResponse(quote, 200, {
      'Cache-Control': 'no-cache',
    });
  } catch (err) {
    if (err instanceof PublicQuoteServiceError) {
      const status =
        err.code === 'service_unavailable' ? 503 : 400;
      return jsonResponse({ error: err.code }, status);
    }

    console.error('public quote error:', err);
    return jsonResponse({ error: 'service_unavailable' }, 503);
  }
};
