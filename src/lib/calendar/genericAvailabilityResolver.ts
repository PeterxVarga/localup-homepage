// ============================================================
// Generic availability resolver — pure tenant-isolated logic
//
// The wiring with Supabase, Google and crypto lives in
// genericAvailabilityProvider.ts.
// ============================================================



export interface CalendarConfig {
  id: string;
  siteId: string;
  provider: string;
  calendarId: string;
  encryptedRefreshToken: string;
}

export interface GenericAvailabilityProvider {
  getFreeBusy(
    timeMin: string,
    timeMax: string,
  ): Promise<Array<{ start: string; end: string }>>;
}

export class GenericAvailabilityProviderError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'GenericAvailabilityProviderError';
    this.code = code;
  }
}

export interface ResolverDependencies {
  loadConfigs(siteId: string): Promise<CalendarConfig[]>;
  buildProvider(config: CalendarConfig): Promise<GenericAvailabilityProvider>;
}

/**
 * Resolve the availability provider for a generic (non-audit) booking site.
 *
 * Fail-closed:
 *   - no active config            -> provider_unconfigured
 *   - ambiguous active config     -> provider_ambiguous
 *   - buildProvider throws        -> propagated as-is
 */
export async function resolveGenericAvailabilityProvider(
  siteId: string,
  siteSlug: string,
  deps: ResolverDependencies,
): Promise<GenericAvailabilityProvider> {
  const configs = await deps.loadConfigs(siteId);

  if (configs.length === 0) {
    throw new GenericAvailabilityProviderError(
      `Generic availability provider is not configured for site ${siteSlug}`,
      'provider_unconfigured',
    );
  }

  if (configs.length > 1) {
    throw new GenericAvailabilityProviderError(
      `Multiple active availability providers found for site ${siteSlug}`,
      'provider_ambiguous',
    );
  }

  return deps.buildProvider(configs[0]);
}

export interface FreeBusyCalendarEntry {
  busy?: Array<{ start?: string; end?: string }>;
  errors?: Array<{ reason?: string; message?: string }>;
}

export interface FreeBusyResponse {
  calendars?: Record<string, FreeBusyCalendarEntry>;
}

/**
 * Parse a Google Calendar freeBusy response into validated busy slots.
 *
 * Fail-closed on any missing/invalid calendar data or malformed busy
 * intervals. No credential or raw Google error detail is leaked.
 */
export function parseFreeBusyResponse(
  response: FreeBusyResponse,
  calendarId: string,
): Array<{ start: string; end: string }> {
  if (!response.calendars || typeof response.calendars !== 'object') {
    throw new GenericAvailabilityProviderError(
      'Calendar provider returned no calendars data',
      'provider_invalid_response',
    );
  }

  const calendar = response.calendars[calendarId];
  if (!calendar || typeof calendar !== 'object') {
    throw new GenericAvailabilityProviderError(
      'Calendar provider did not return data for the configured calendar',
      'provider_invalid_response',
    );
  }

  if (calendar.errors !== undefined) {
    if (!Array.isArray(calendar.errors)) {
      throw new GenericAvailabilityProviderError(
        'Calendar provider returned invalid errors data',
        'provider_invalid_response',
      );
    }

    if (calendar.errors.length > 0) {
      throw new GenericAvailabilityProviderError(
        'Calendar provider returned calendar-level errors',
        'provider_calendar_error',
      );
    }
  }

  if (!Array.isArray(calendar.busy)) {
    throw new GenericAvailabilityProviderError(
      'Calendar provider returned invalid busy data',
      'provider_invalid_response',
    );
  }

  return calendar.busy.map((busy, index) => {
    if (!busy || typeof busy !== 'object') {
      throw new GenericAvailabilityProviderError(
        `Calendar provider returned an invalid busy interval at index ${index}`,
        'provider_invalid_response',
      );
    }

    if (
      typeof busy.start !== 'string' ||
      typeof busy.end !== 'string' ||
      busy.start.trim() === '' ||
      busy.end.trim() === ''
    ) {
      throw new GenericAvailabilityProviderError(
        `Calendar provider returned a busy interval without start/end at index ${index}`,
        'provider_invalid_response',
      );
    }

    const startMs = new Date(busy.start).getTime();
    const endMs = new Date(busy.end).getTime();
    if (
      Number.isNaN(startMs) ||
      Number.isNaN(endMs) ||
      endMs <= startMs
    ) {
      throw new GenericAvailabilityProviderError(
        `Calendar provider returned an invalid busy interval at index ${index}`,
        'provider_invalid_response',
      );
    }

    return { start: busy.start, end: busy.end };
  });
}

/**
 * Bind a provider's getFreeBusy method to a callback that preserves `this`.
 * Avoids passing `provider.getFreeBusy` directly as a higher-order function.
 */
export function bindGetFreeBusy(
  provider: GenericAvailabilityProvider,
): (timeMin: string, timeMax: string) => Promise<Array<{ start: string; end: string }>> {
  return (timeMin, timeMax) => provider.getFreeBusy(timeMin, timeMax);
}
