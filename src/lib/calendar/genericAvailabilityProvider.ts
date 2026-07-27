// ============================================================
// Generic calendar provider resolver — tenant-isolated wiring
//
// Loads the active site-specific Calendar configuration from Supabase,
// decrypts the tenant refresh token server-side, and creates a Google
// Calendar provider scoped to that tenant's calendar_id.
//
// Supports availability (freeBusy) and event CRUD (create, patch, delete).
// The global LocalUp audit Google Calendar provider is never reused here.
// ============================================================

import { google } from 'googleapis';
import type { calendar_v3 } from 'googleapis';
import { getSupabase } from '../supabase';
import { env } from '../env';
import { decryptCredential } from '../tokens/crypto';
import {
  type CalendarConfig,
  type GenericAvailabilityProvider,
  type GenericCalendarProvider,
  GenericAvailabilityProviderError,
  parseFreeBusyResponse,
  resolveGenericAvailabilityProvider as resolveGenericAvailabilityProviderCore,
  validateCalendarEventResponse,
  validateCreateEventParams,
  validateEventId,
  validateEventInterval,
  validateTimeZone,
} from './genericAvailabilityResolver';
import type {
  BusySlot,
  CreateEventParams,
  CreateEventResult,
  DeleteEventResult,
  PatchEventParams,
  PatchEventResult,
} from './types';

export {
  GenericAvailabilityProviderError,
  bindGetFreeBusy,
} from './genericAvailabilityResolver';

export type {
  GenericAvailabilityProvider,
  GenericCalendarProvider,
} from './genericAvailabilityResolver';

interface SiteCalendarConfigRow {
  id: string;
  site_id: string;
  provider: string;
  calendar_id: string;
  encrypted_refresh_token: string;
  is_active: boolean;
}

interface GoogleApiError extends Error {
  response?: { status?: number };
  code?: number;
}

function isGoogleApiError(err: unknown): err is GoogleApiError {
  return err instanceof Error;
}

async function loadSiteCalendarConfigs(siteId: string): Promise<CalendarConfig[]> {
  const { data, error } = await getSupabase()
    .from('site_calendar_configs')
    .select(
      'id, site_id, provider, calendar_id, encrypted_refresh_token, is_active',
    )
    .eq('site_id', siteId)
    .eq('provider', 'google')
    .eq('is_active', true);

  if (error) {
    console.error('Failed to load site calendar config:', error);
    throw new GenericAvailabilityProviderError(
      'Failed to load calendar configuration',
      'provider_lookup_failed',
    );
  }

  return (data ?? []).map((row: SiteCalendarConfigRow) => ({
    id: row.id,
    siteId: row.site_id,
    provider: row.provider,
    calendarId: row.calendar_id,
    encryptedRefreshToken: row.encrypted_refresh_token,
  }));
}

/**
 * Build a tenant-scoped Google Calendar provider from an existing Calendar
 * client. Used in production after OAuth setup, and in tests with a mock
 * calendar client.
 */
export function buildGoogleCalendarProvider(
  config: CalendarConfig,
  calendar: calendar_v3.Calendar,
): GenericCalendarProvider {
  return {
    async getFreeBusy(timeMin: string, timeMax: string): Promise<BusySlot[]> {
      const res = await calendar.freebusy.query({
        requestBody: {
          timeMin,
          timeMax,
          items: [{ id: config.calendarId }],
        },
      });

      return parseFreeBusyResponse(
        res.data as { calendars?: Record<string, { busy?: Array<{ start?: string; end?: string }>; errors?: Array<{ reason?: string; message?: string }> }> },
        config.calendarId,
      );
    },

    async createEvent(params: CreateEventParams): Promise<CreateEventResult> {
      validateCreateEventParams(params);

      try {
        const res = await calendar.events.insert({
          calendarId: config.calendarId,
          conferenceDataVersion: 1,
          requestBody: {
            summary: params.summary,
            description: params.description,
            start: { dateTime: params.start, timeZone: params.timeZone },
            end: { dateTime: params.end, timeZone: params.timeZone },
            attendees: params.attendeeEmail
              ? [{ email: params.attendeeEmail }]
              : undefined,
            conferenceData: {
              createRequest: {
                requestId: crypto.randomUUID(),
                conferenceSolutionKey: { type: 'hangoutsMeet' },
              },
            },
            reminders: {
              useDefault: false,
              overrides: [
                { method: 'email', minutes: 24 * 60 },
                { method: 'popup', minutes: 30 },
              ],
            },
          },
        });

        const validated = validateCalendarEventResponse(res.data);

        return {
          ok: true,
          provider: 'google',
          eventId: validated.id,
          htmlLink: validated.htmlLink,
          meetLink: validated.hangoutLink,
        };
      } catch (err) {
        if (err instanceof GenericAvailabilityProviderError) {
          throw err;
        }

        console.error('Google Calendar event creation failed');
        throw new GenericAvailabilityProviderError(
          'Calendar provider failed to create the event',
          'provider_calendar_error',
        );
      }
    },

    async patchEvent(
      eventId: string,
      params: PatchEventParams,
    ): Promise<PatchEventResult> {
      validateEventId(eventId);
      validateTimeZone(params.timeZone);
      validateEventInterval(params.start, params.end);

      try {
        const res = await calendar.events.patch({
          calendarId: config.calendarId,
          eventId,
          sendUpdates: 'none',
          requestBody: {
            start: { dateTime: params.start, timeZone: params.timeZone },
            end: { dateTime: params.end, timeZone: params.timeZone },
          },
        });

        const validated = validateCalendarEventResponse(res.data);

        return {
          ok: true,
          provider: 'google',
          eventId: validated.id,
          htmlLink: validated.htmlLink,
          meetLink: validated.hangoutLink,
        };
      } catch (err) {
        if (err instanceof GenericAvailabilityProviderError) {
          throw err;
        }

        console.error('Google Calendar event patch failed');
        throw new GenericAvailabilityProviderError(
          'Calendar provider failed to update the event',
          'provider_calendar_error',
        );
      }
    },

    async deleteEvent(eventId: string): Promise<DeleteEventResult> {
      validateEventId(eventId);

      try {
        await calendar.events.delete({
          calendarId: config.calendarId,
          eventId,
        });

        return {
          ok: true,
          provider: 'google',
          eventId,
        };
      } catch (err) {
        if (err instanceof GenericAvailabilityProviderError) {
          throw err;
        }

        // Idempotent delete: a 404 from Google means the event is already
        // gone, so treat it as a successful deletion.
        if (
          isGoogleApiError(err) &&
          (err.response?.status === 404 || err.code === 404)
        ) {
          return {
            ok: true,
            provider: 'google',
            eventId,
          };
        }

        console.error('Google Calendar event deletion failed');
        throw new GenericAvailabilityProviderError(
          'Calendar provider failed to delete the event',
          'provider_calendar_error',
        );
      }
    },
  };
}

async function buildGoogleProvider(
  config: CalendarConfig,
): Promise<GenericCalendarProvider> {
  if (!env.googleClientId || !env.googleClientSecret) {
    throw new GenericAvailabilityProviderError(
      'Google OAuth client credentials are not configured',
      'provider_credentials_missing',
    );
  }

  let refreshToken: string;
  try {
    refreshToken = decryptCredential(config.encryptedRefreshToken).trim();
  } catch {
    console.error('Failed to decrypt tenant refresh token');
    throw new GenericAvailabilityProviderError(
      'Failed to decrypt calendar credentials',
      'provider_credentials_missing',
    );
  }

  if (refreshToken === '') {
    throw new GenericAvailabilityProviderError(
      'Calendar credentials are missing after decryption',
      'provider_credentials_missing',
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    env.googleClientId,
    env.googleClientSecret,
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  return buildGoogleCalendarProvider(config, calendar);
}

async function buildProvider(
  config: CalendarConfig,
): Promise<GenericCalendarProvider> {
  if (config.provider === 'google') {
    return buildGoogleProvider(config);
  }

  throw new GenericAvailabilityProviderError(
    `Unsupported calendar provider: ${config.provider}`,
    'provider_unsupported',
  );
}

/**
 * Resolve the calendar provider for a generic (non-audit) booking site.
 *
 * Fail-closed: until the site has a single active calendar configuration,
 * every request is rejected. The generic API is also gated by
 * `public_booking_enabled` on the booking service, so in normal operation
 * this code path is never reached.
 */
export async function resolveGenericAvailabilityProvider(
  siteId: string,
  siteSlug: string,
): Promise<GenericCalendarProvider> {
  return resolveGenericAvailabilityProviderCore(siteId, siteSlug, {
    loadConfigs: loadSiteCalendarConfigs,
    buildProvider,
  });
}
