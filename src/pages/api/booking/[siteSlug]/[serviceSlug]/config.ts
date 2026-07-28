// ============================================================
// GET /api/booking/[siteSlug]/[serviceSlug]/config
//
// Returns the public pricing configuration for an active,
// publicly-bookable service. Excludes internal site/service IDs and
// inactive groups/options.
// Fail-closed: missing/inactive/non-public config returns 503 without
// details.
// ============================================================

import type { APIRoute } from 'astro';
import { isSupabaseConfigured } from '../../../../../lib/supabase';
import {
  getPublicPricingConfig,
  PublicQuoteServiceError,
} from '../../../../../lib/booking-pricing/publicQuoteService';

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

export const GET: APIRoute = async ({ params }) => {
  if (!isSupabaseConfigured()) {
    return jsonResponse(
      { error: 'service_unavailable' },
      503,
    );
  }

  const siteSlug = typeof params.siteSlug === 'string' ? params.siteSlug : '';
  const serviceSlug =
    typeof params.serviceSlug === 'string' ? params.serviceSlug : '';

  try {
    const config = await getPublicPricingConfig(siteSlug, serviceSlug);
    return jsonResponse(config, 200, {
      'Cache-Control': 'no-cache',
    });
  } catch (err) {
    if (err instanceof PublicQuoteServiceError) {
      const status =
        err.code === 'service_unavailable' ? 503 : 400;
      return jsonResponse({ error: err.code }, status);
    }

    console.error('public pricing config error:', err);
    return jsonResponse({ error: 'service_unavailable' }, 503);
  }
};
