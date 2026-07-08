// ============================================================
// Calendar sync orchestrator — provider-agnostic
// Syncs a booking to all configured calendar providers.
// Supabase is the source of truth. Calendar is a sync target.
// ============================================================

import type {
  CalendarProvider,
  CalendarSyncOutcome,
  ProviderSyncResult,
} from './types';
import { googleCalendarProvider } from './provider/google';

/**
 * Providers that contribute to availability/freeBusy checks.
 * These determine which slots are shown as available.
 */
const availabilityProviders: CalendarProvider[] = [
  googleCalendarProvider,
].filter((p) => p.supportsAvailability);

/**
 * Providers that receive booking sync/event creation.
 * These are the calendars where the event appears.
 */
const syncProviders: CalendarProvider[] = [googleCalendarProvider].filter(
  (p) => p.supportsSync,
);

/**
 * Create the event description text for calendar providers.
 */
function buildEventDescription(params: {
  name: string;
  email: string;
  businessName: string;
  websiteUrl?: string;
  city: string;
  businessType: string;
  goals: string[];
  notes?: string;
  ctaLocation?: string;
}): string {
  return [
    `Name: ${params.name}`,
    `Email: ${params.email}`,
    `Business: ${params.businessName}`,
    `Website: ${params.websiteUrl || '—'}`,
    `City: ${params.city}`,
    `Business type: ${params.businessType}`,
    `Goals: ${params.goals.join(', ')}`,
    `Notes: ${params.notes || '—'}`,
    `CTA location: ${params.ctaLocation || '—'}`,
  ].join('\n');
}

/**
 * Sync a booking to all configured sync providers.
 * Handles partial failures gracefully — a single provider failure
 * does not block other providers from syncing.
 */
export async function syncBookingToCalendar(params: {
  businessName: string;
  name: string;
  email: string;
  phone?: string;
  websiteUrl?: string;
  city: string;
  businessType: string;
  goals: string[];
  notes?: string;
  ctaLocation?: string;
  slotStart: string;
  slotEnd: string;
}): Promise<CalendarSyncOutcome> {
  const description = buildEventDescription(params);

  const results: ProviderSyncResult[] = [];

  for (const provider of syncProviders) {
    if (!provider.createEvent) continue;

    try {
      const event = await provider.createEvent({
        summary: `LocalUp Audit Call — ${params.businessName}`,
        description,
        start: params.slotStart,
        end: params.slotEnd,
        attendeeEmail: params.email,
      });

      if (event.ok) {
        results.push({
          provider: provider.id,
          status: 'synced',
          providerEventId: event.eventId,
        });
      } else {
        results.push({
          provider: provider.id,
          status: 'failed',
          error: event.error,
        });
      }
    } catch (err) {
      console.error(`Calendar sync failed for ${provider.id}:`, err);
      results.push({
        provider: provider.id,
        status: 'failed',
        error: 'unexpected_error',
      });
    }
  }

  const successful = results.filter((r) => r.status === 'synced');
  const failed = results.filter((r) => r.status === 'failed');

  let overallStatus: CalendarSyncOutcome['overallStatus'];
  if (results.length === 0) {
    overallStatus = 'not_configured';
  } else if (failed.length === 0) {
    overallStatus = 'synced';
  } else if (successful.length > 0) {
    overallStatus = 'partially_synced';
  } else {
    overallStatus = 'failed';
  }

  return {
    results,
    primaryEventId: successful[0]?.providerEventId ?? null,
    overallStatus,
  };
}

/**
 * Get free/busy from all availability providers and merge the results.
 * Used by the slot generation endpoint.
 */
export async function getAggregatedFreeBusy(
  timeMin: string,
  timeMax: string,
): Promise<{ start: string; end: string }[]> {
  const allBusy = await Promise.all(
    availabilityProviders.map((p) => {
      if (!p.getFreeBusy) return Promise.resolve([]);
      return p.getFreeBusy(timeMin, timeMax).catch(() => []);
    }),
  );
  return allBusy.flat();
}

/**
 * Check if a specific time range conflicts with any availability provider's busy slots.
 */
export async function isSlotAvailable(
  slotStart: string,
  slotEnd: string,
): Promise<boolean> {
  const busyIntervals = await getAggregatedFreeBusy(slotStart, slotEnd);
  return !busyIntervals.some((b) => slotStart < b.end && slotEnd > b.start);
}
