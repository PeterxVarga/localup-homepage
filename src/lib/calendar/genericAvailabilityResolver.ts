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

import type {
  CreateEventParams,
  CreateEventResult,
  DeleteEventResult,
  PatchEventParams,
  PatchEventResult,
} from './types';

export interface GenericAvailabilityProvider {
  getFreeBusy(
    timeMin: string,
    timeMax: string,
  ): Promise<Array<{ start: string; end: string }>>;
}

/**
 * Full tenant-isolated calendar provider.
 * Extends the availability-only provider with event CRUD operations.
 */
export interface GenericCalendarProvider extends GenericAvailabilityProvider {
  createEvent(params: CreateEventParams): Promise<CreateEventResult>;
  patchEvent(
    eventId: string,
    params: PatchEventParams,
  ): Promise<PatchEventResult>;
  deleteEvent(eventId: string): Promise<DeleteEventResult>;
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
  buildProvider(config: CalendarConfig): Promise<GenericCalendarProvider>;
}

/**
 * Resolve the calendar provider for a generic (non-audit) booking site.
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
): Promise<GenericCalendarProvider> {
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
 * Validate a calendar event time range.
 *
 * Fail-closed: rejects invalid ISO timestamps and non-positive intervals.
 */
export function validateEventInterval(
  start: string,
  end: string,
): { startMs: number; endMs: number } {
  if (typeof start !== 'string' || start.trim() === '') {
    throw new GenericAvailabilityProviderError(
      'Event start time is required',
      'provider_input_invalid',
    );
  }

  if (typeof end !== 'string' || end.trim() === '') {
    throw new GenericAvailabilityProviderError(
      'Event end time is required',
      'provider_input_invalid',
    );
  }

  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();

  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new GenericAvailabilityProviderError(
      'Event start or end time is not a valid timestamp',
      'provider_input_invalid',
    );
  }

  if (endMs <= startMs) {
    throw new GenericAvailabilityProviderError(
      'Event end time must be after start time',
      'provider_input_invalid',
    );
  }

  return { startMs, endMs };
}

/**
 * Validate that a timezone string is a known IANA timezone.
 */
export function validateTimeZone(timeZone: string): void {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') {
    throw new GenericAvailabilityProviderError(
      'Event timezone is required',
      'provider_input_invalid',
    );
  }

  try {
    Intl.DateTimeFormat(undefined, { timeZone }).format(new Date());
  } catch {
    throw new GenericAvailabilityProviderError(
      'Event timezone is not a valid IANA timezone',
      'provider_input_invalid',
    );
  }
}

/**
 * Validate create event input.
 *
 * Enforces the minimum required contract: non-empty summary, valid IANA
 * timezone and a valid, positive time interval. The provider may layer
 * additional checks on top.
 */
export function validateCreateEventParams(
  params: CreateEventParams,
): void {
  if (!params || typeof params !== 'object') {
    throw new GenericAvailabilityProviderError(
      'Event parameters are required',
      'provider_input_invalid',
    );
  }

  if (
    typeof params.summary !== 'string' ||
    params.summary.trim() === ''
  ) {
    throw new GenericAvailabilityProviderError(
      'Event summary is required',
      'provider_input_invalid',
    );
  }

  validateTimeZone(params.timeZone);
  validateEventInterval(params.start, params.end);
}

/**
 * Validate that a provider event ID is explicit and non-empty.
 */
export function validateEventId(eventId: string): void {
  if (typeof eventId !== 'string' || eventId.trim() === '') {
    throw new GenericAvailabilityProviderError(
      'Event ID is required',
      'provider_input_invalid',
    );
  }
}

/**
 * Validate a Google Calendar events.insert / events.patch response.
 *
 * Fail-closed: the operation is only considered successful when the
 * response contains a non-empty event ID. No credential or raw API detail
 * is included in the error.
 */
export function validateCalendarEventResponse(
  data: unknown,
): { id: string; htmlLink?: string; hangoutLink?: string } {
  if (!data || typeof data !== 'object') {
    throw new GenericAvailabilityProviderError(
      'Calendar provider returned an empty event response',
      'provider_invalid_response',
    );
  }

  const event = data as { id?: unknown; htmlLink?: unknown; hangoutLink?: unknown };

  if (typeof event.id !== 'string' || event.id.trim() === '') {
    throw new GenericAvailabilityProviderError(
      'Calendar provider returned an event without a valid ID',
      'provider_invalid_response',
    );
  }

  return {
    id: event.id,
    htmlLink: typeof event.htmlLink === 'string' ? event.htmlLink : undefined,
    hangoutLink:
      typeof event.hangoutLink === 'string' ? event.hangoutLink : undefined,
  };
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
