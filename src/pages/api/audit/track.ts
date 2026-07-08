// ============================================================
// POST /api/audit/track
// Dedicated endpoint for funnel/ analytics events.
// Looser rate limit than booking: 30 requests / min / IP.
// ============================================================

import type { APIRoute } from 'astro';
import { isSupabaseConfigured } from '../../../lib/supabase';
import { trackEvent } from '../../../lib/booking/trackEvent';
import { isRateLimited, recordRequest, getRetryAfterSeconds } from '../../../lib/rateLimit';

const TRACK_LIMIT = { namespace: 'track', max: 30, windowMs: 60_000 };

function jsonResponse(body: unknown, status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export const POST: APIRoute = async ({ request }) => {
  if (isRateLimited(request, TRACK_LIMIT)) {
    const retryAfter = getRetryAfterSeconds(request, TRACK_LIMIT);
    return jsonResponse(
      {
        success: false,
        error: 'rate_limited',
        message: 'Túl sok kérés. Kérlek várj egy kicsit, majd próbáld újra.',
      },
      429,
      { 'Retry-After': String(retryAfter) },
    );
  }

  recordRequest(request, TRACK_LIMIT);

  // Tracking requires Supabase because that's where events are stored.
  if (!isSupabaseConfigured()) {
    return jsonResponse(
      { success: false, error: 'service_unavailable', message: 'Tracking service is not configured' },
      503,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: 'invalid_json', message: 'Invalid request' }, 400);
  }

  const bodyRecord = body as Record<string, unknown>;

  const sessionId = typeof bodyRecord.sessionId === 'string' && bodyRecord.sessionId
    ? bodyRecord.sessionId
    : crypto.randomUUID();

  const eventName = typeof bodyRecord.eventName === 'string' && bodyRecord.eventName
    ? bodyRecord.eventName
    : 'audit_unknown_event';

  const metadata = typeof bodyRecord.metadata === 'object' && bodyRecord.metadata !== null
    ? (bodyRecord.metadata as Record<string, unknown>)
    : {};

  await trackEvent({
    eventName: eventName as import('../../../lib/booking/trackEvent').AuditEventName,
    sessionId,
    ctaLocation: typeof bodyRecord.ctaLocation === 'string' ? bodyRecord.ctaLocation : undefined,
    sourceUrl: typeof bodyRecord.sourceUrl === 'string' ? bodyRecord.sourceUrl : undefined,
    metadata,
  });

  return jsonResponse({ success: true, tracked: true }, 200);
};
