// ============================================================
// Event tracking — framework-neutral
// Stores booking funnel events in the booking_events table
// ============================================================

import { getSupabase } from '../supabase';

export type AuditEventName =
  | 'audit_cta_clicked'
  | 'audit_flow_started'
  | 'audit_step_1_completed'
  | 'audit_step_2_completed'
  | 'audit_slot_selected'
  | 'audit_booking_submitted'
  | 'audit_booking_confirmed'
  | 'audit_booking_failed'
  | 'booking_cancelled'
  | 'booking_cancel_failed'
  | 'cancellation_email_failed'
  | 'booking_reschedule_requested'
  | 'booking_rescheduled'
  | 'booking_reschedule_failed'
  | 'reschedule_email_failed'
  | 'reminder_permanently_failed'
  | 'reminder_cancelled'
  | 'reminder_scheduled'
  | 'reminder_scheduling_failed';

interface TrackEventParams {
  eventName: AuditEventName;
  sessionId: string;
  bookingId?: string;
  metadata?: Record<string, unknown>;
  ctaLocation?: string;
  sourceUrl?: string;
}

/**
 * Track a funnel event. In V1 this writes to Supabase booking_events.
 */
export async function trackEvent(params: TrackEventParams): Promise<void> {
  const { eventName, sessionId, bookingId, metadata, sourceUrl } = params;

  // Extract UTM params from sourceUrl
  let utmParams: Record<string, string | null> = {};
  if (sourceUrl) {
    try {
      const parsed = new URL(sourceUrl);
      utmParams = {
        utm_source: parsed.searchParams.get('utm_source'),
        utm_medium: parsed.searchParams.get('utm_medium'),
        utm_campaign: parsed.searchParams.get('utm_campaign'),
        utm_content: parsed.searchParams.get('utm_content'),
        utm_term: parsed.searchParams.get('utm_term'),
      };
    } catch {
      // Invalid URL, ignore UTM extraction
    }
  }

  try {
    await getSupabase().from('booking_events').insert({
      session_id: sessionId,
      booking_id: bookingId || null,
      event_name: eventName,
      metadata: {
        ...metadata,
        ...utmParams,
      },
    });
  } catch (err) {
    // Don't let tracking failures block the user flow
    console.error('Tracking event failed:', eventName, err);
  }
}
