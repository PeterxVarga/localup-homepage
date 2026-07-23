// ============================================================
// Generic availability provider resolver — tenant-isolated wiring
//
// Loads the active site-specific Calendar configuration from Supabase,
// decrypts the tenant refresh token server-side, and creates a Google
// Calendar freeBusy provider scoped to that tenant's calendar_id.
//
// The global LocalUp audit Google Calendar provider is never reused here.
// ============================================================

import { google } from 'googleapis';
import { getSupabase } from '../supabase';
import { env } from '../env';
import { decryptCredential } from '../tokens/crypto';
import {
  type CalendarConfig,
  type GenericAvailabilityProvider,
  GenericAvailabilityProviderError,
  resolveGenericAvailabilityProvider as resolveGenericAvailabilityProviderCore,
} from './genericAvailabilityResolver';
import type { BusySlot } from './types';

export {
  GenericAvailabilityProviderError,
  bindGetFreeBusy,
} from './genericAvailabilityResolver';

export type { GenericAvailabilityProvider } from './genericAvailabilityResolver';

interface SiteCalendarConfigRow {
  id: string;
  site_id: string;
  provider: string;
  calendar_id: string;
  encrypted_refresh_token: string;
  is_active: boolean;
}

async function loadSiteCalendarConfigs(siteId: string): Promise<CalendarConfig[]> {
  const { data, error } = await getSupabase()
    .from('site_calendar_configs')
    .select(
      'id, site_id, provider, calendar_id, encrypted_refresh_token, is_active',
    )
    .eq('site_id', siteId)
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

async function buildGoogleProvider(
  config: CalendarConfig,
): Promise<GenericAvailabilityProvider> {
  if (!env.googleClientId || !env.googleClientSecret) {
    throw new GenericAvailabilityProviderError(
      'Google OAuth client credentials are not configured',
      'provider_credentials_missing',
    );
  }

  let refreshToken: string;
  try {
    refreshToken = decryptCredential(config.encryptedRefreshToken);
  } catch (err) {
    console.error('Failed to decrypt tenant refresh token:', err);
    throw new GenericAvailabilityProviderError(
      'Failed to decrypt calendar credentials',
      'provider_decrypt_failed',
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    env.googleClientId,
    env.googleClientSecret,
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  return {
    async getFreeBusy(timeMin: string, timeMax: string): Promise<BusySlot[]> {
      const res = await calendar.freebusy.query({
        requestBody: {
          timeMin,
          timeMax,
          items: [{ id: config.calendarId }],
        },
      });

      return (res.data.calendars?.[config.calendarId]?.busy ?? []).map(
        (busy) => {
          if (!busy.start || !busy.end) {
            throw new GenericAvailabilityProviderError(
              'Calendar provider returned an invalid busy interval',
              'provider_invalid_response',
            );
          }
          return { start: busy.start, end: busy.end };
        },
      );
    },
  };
}

async function buildProvider(
  config: CalendarConfig,
): Promise<GenericAvailabilityProvider> {
  if (config.provider === 'google') {
    return buildGoogleProvider(config);
  }

  throw new GenericAvailabilityProviderError(
    `Unsupported calendar provider: ${config.provider}`,
    'provider_unsupported',
  );
}

/**
 * Resolve the availability provider for a generic (non-audit) booking site.
 *
 * Fail-closed: until the site has a single active calendar configuration,
 * every request is rejected. The generic API is also gated by
 * `public_booking_enabled` on the booking service, so in normal operation
 * this code path is never reached.
 */
export async function resolveGenericAvailabilityProvider(
  siteId: string,
  siteSlug: string,
): Promise<GenericAvailabilityProvider> {
  return resolveGenericAvailabilityProviderCore(siteId, siteSlug, {
    loadConfigs: loadSiteCalendarConfigs,
    buildProvider,
  });
}
