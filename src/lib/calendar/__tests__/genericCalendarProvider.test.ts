// ============================================================
// Generic tenant-aware Google Calendar CRUD provider — unit tests
//
// Run with:
//   node --experimental-strip-types --test src/lib/calendar/__tests__/genericCalendarProvider.test.ts
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { calendar_v3 } from 'googleapis';
import {
  buildGoogleCalendarProvider,
} from '../genericAvailabilityProvider.ts';
import {
  GenericAvailabilityProviderError,
  resolveGenericAvailabilityProvider,
} from '../genericAvailabilityResolver.ts';
import type {
  CalendarConfig,
  GenericCalendarProvider,
  ResolverDependencies,
} from '../genericAvailabilityResolver.ts';
import type { CreateEventParams, PatchEventParams } from '../types.ts';

const demoConfig: CalendarConfig = {
  id: 'd1111111-1111-1111-1111-111111111111',
  siteId: 'a1111111-1111-1111-1111-111111111111',
  provider: 'google',
  calendarId: 'tenant-calendar@example.com',
  encryptedRefreshToken: 'encrypted-token',
};

const baseEvent = {
  summary: 'Demo booking',
  start: '2026-01-01T10:00:00Z',
  end: '2026-01-01T11:00:00Z',
  timeZone: 'Europe/Budapest',
} satisfies CreateEventParams;

function makeMockCalendar(
  overrides: Partial<calendar_v3.Calendar> = {},
): calendar_v3.Calendar {
  return overrides as unknown as calendar_v3.Calendar;
}

function calendarWithInsert(
  insert: calendar_v3.Calendar['events']['insert'],
): calendar_v3.Calendar {
  return makeMockCalendar({
    events: { insert },
    freebusy: {
      query: async () => ({ data: { calendars: {} } }),
    },
  });
}

function calendarWithPatch(
  patch: calendar_v3.Calendar['events']['patch'],
): calendar_v3.Calendar {
  return makeMockCalendar({
    events: { patch },
    freebusy: {
      query: async () => ({ data: { calendars: {} } }),
    },
  });
}

function calendarWithDelete(
  del: calendar_v3.Calendar['events']['delete'],
): calendar_v3.Calendar {
  return makeMockCalendar({
    events: { delete: del },
    freebusy: {
      query: async () => ({ data: { calendars: {} } }),
    },
  });
}

describe('buildGoogleCalendarProvider', () => {
  describe('createEvent', () => {
    it('creates an event using the tenant calendarId and returns the eventId', async () => {
      let capturedCalendarId: string | undefined;
      let capturedRequestBody: unknown;

      const insert = async (args: {
        calendarId: string;
        requestBody?: unknown;
      }) => {
        capturedCalendarId = args.calendarId;
        capturedRequestBody = args.requestBody;
        return {
          data: {
            id: 'google-event-123',
            htmlLink: 'https://calendar.google.com/event?eid=123',
            hangoutLink: 'https://meet.google.com/abc-defg-hij',
          },
        };
      };

      const provider = buildGoogleCalendarProvider(
        demoConfig,
        calendarWithInsert(insert as unknown as calendar_v3.Calendar['events']['insert']),
      );

      const result = await provider.createEvent({
        ...baseEvent,
        description: 'Test description',
        attendeeEmail: 'attendee@example.com',
      });

      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.eventId, 'google-event-123');
      assert.equal(result.htmlLink, 'https://calendar.google.com/event?eid=123');
      assert.equal(result.meetLink, 'https://meet.google.com/abc-defg-hij');
      assert.equal(capturedCalendarId, demoConfig.calendarId);

      const body = capturedRequestBody as {
        summary: string;
        description?: string;
        start: { dateTime: string; timeZone: string };
        end: { dateTime: string; timeZone: string };
        attendees?: Array<{ email: string }>;
      };
      assert.equal(body.summary, 'Demo booking');
      assert.equal(body.description, 'Test description');
      assert.equal(body.start.dateTime, baseEvent.start);
      assert.equal(body.end.dateTime, baseEvent.end);
      assert.equal(body.start.timeZone, baseEvent.timeZone);
      assert.equal(body.attendees?.[0].email, 'attendee@example.com');
    });

    it('rejects a Google response without an event ID', async () => {
      const insert = async () => ({ data: {} });

      const provider = buildGoogleCalendarProvider(
        demoConfig,
        calendarWithInsert(insert as unknown as calendar_v3.Calendar['events']['insert']),
      );

      await assert.rejects(
        provider.createEvent(baseEvent),
        (err: unknown) =>
          err instanceof GenericAvailabilityProviderError &&
          err.code === 'provider_invalid_response',
      );
    });

    it('rejects an empty Google event ID', async () => {
      const insert = async () => ({ data: { id: '   ' } });

      const provider = buildGoogleCalendarProvider(
        demoConfig,
        calendarWithInsert(insert as unknown as calendar_v3.Calendar['events']['insert']),
      );

      await assert.rejects(
        provider.createEvent(baseEvent),
        (err: unknown) =>
          err instanceof GenericAvailabilityProviderError &&
          err.code === 'provider_invalid_response',
      );
    });

    it('rejects a missing summary', async () => {
      const provider = buildGoogleCalendarProvider(
        demoConfig,
        calendarWithInsert(async () => ({ data: {} })),
      );

      await assert.rejects(
        provider.createEvent({
          ...baseEvent,
          summary: '   ',
        }),
        (err: unknown) =>
          err instanceof GenericAvailabilityProviderError &&
          err.code === 'provider_input_invalid',
      );
    });

    it('rejects a missing timezone', async () => {
      const provider = buildGoogleCalendarProvider(
        demoConfig,
        calendarWithInsert(async () => ({ data: {} })),
      );

      await assert.rejects(
        provider.createEvent({
          summary: 'Demo booking',
          start: baseEvent.start,
          end: baseEvent.end,
          timeZone: '',
        } as CreateEventParams),
        (err: unknown) =>
          err instanceof GenericAvailabilityProviderError &&
          err.code === 'provider_input_invalid',
      );
    });

    it('rejects an invalid IANA timezone', async () => {
      const provider = buildGoogleCalendarProvider(
        demoConfig,
        calendarWithInsert(async () => ({ data: {} })),
      );

      await assert.rejects(
        provider.createEvent({
          summary: 'Demo booking',
          start: baseEvent.start,
          end: baseEvent.end,
          timeZone: 'Mars/Phobos',
        }),
        (err: unknown) =>
          err instanceof GenericAvailabilityProviderError &&
          err.code === 'provider_input_invalid',
      );
    });

    it('rejects invalid start timestamp', async () => {
      const provider = buildGoogleCalendarProvider(
        demoConfig,
        calendarWithInsert(async () => ({ data: {} })),
      );

      await assert.rejects(
        provider.createEvent({
          ...baseEvent,
          start: 'not-a-date',
        }),
        (err: unknown) =>
          err instanceof GenericAvailabilityProviderError &&
          err.code === 'provider_input_invalid',
      );
    });

    it('rejects end <= start', async () => {
      const provider = buildGoogleCalendarProvider(
        demoConfig,
        calendarWithInsert(async () => ({ data: {} })),
      );

      await assert.rejects(
        provider.createEvent({
          ...baseEvent,
          end: baseEvent.start,
        }),
        (err: unknown) =>
          err instanceof GenericAvailabilityProviderError &&
          err.code === 'provider_input_invalid',
      );
    });

    it('does not leak Google API error details to callers', async () => {
      const insert = async () => {
        const err = new Error('refresh_token_expired: super-secret-token');
        (err as Error & { response?: unknown }).response = {
          status: 401,
          data: { error_description: 'client_secret_leak' },
        };
        throw err;
      };

      const provider = buildGoogleCalendarProvider(
        demoConfig,
        calendarWithInsert(insert as unknown as calendar_v3.Calendar['events']['insert']),
      );

      await assert.rejects(
        provider.createEvent(baseEvent),
        (err: unknown) => {
          if (!(err instanceof GenericAvailabilityProviderError)) return false;
          assert.equal(err.code, 'provider_calendar_error');
          assert.ok(!err.message.includes('super-secret-token'));
          assert.ok(!err.message.includes('client_secret_leak'));
          assert.ok(!err.message.includes('refresh_token'));
          return true;
        },
      );
    });
  });

  describe('patchEvent', () => {
    it('patches an event using the tenant calendarId and explicit eventId', async () => {
      let capturedCalendarId: string | undefined;
      let capturedEventId: string | undefined;
      let capturedRequestBody: unknown;

      const patch = async (args: {
        calendarId: string;
        eventId: string;
        requestBody?: unknown;
      }) => {
        capturedCalendarId = args.calendarId;
        capturedEventId = args.eventId;
        capturedRequestBody = args.requestBody;
        return {
          data: {
            id: args.eventId,
            htmlLink: 'https://calendar.google.com/event?eid=patched',
          },
        };
      };

      const provider = buildGoogleCalendarProvider(
        demoConfig,
        calendarWithPatch(patch as unknown as calendar_v3.Calendar['events']['patch']),
      );

      const result = await provider.patchEvent('event-456', {
        start: '2026-01-02T10:00:00Z',
        end: '2026-01-02T11:00:00Z',
        timeZone: 'Europe/Budapest',
      });

      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.eventId, 'event-456');
      assert.equal(result.htmlLink, 'https://calendar.google.com/event?eid=patched');
      assert.equal(capturedCalendarId, demoConfig.calendarId);
      assert.equal(capturedEventId, 'event-456');

      const body = capturedRequestBody as {
        start: { dateTime: string; timeZone: string };
        end: { dateTime: string; timeZone: string };
      };
      assert.equal(body.start.dateTime, '2026-01-02T10:00:00Z');
      assert.equal(body.end.dateTime, '2026-01-02T11:00:00Z');
      assert.equal(body.start.timeZone, 'Europe/Budapest');
    });

    it('rejects an empty eventId', async () => {
      const provider = buildGoogleCalendarProvider(
        demoConfig,
        calendarWithPatch(async () => ({ data: {} })),
      );

      await assert.rejects(
        provider.patchEvent('', {
          start: '2026-01-01T10:00:00Z',
          end: '2026-01-01T11:00:00Z',
          timeZone: 'Europe/Budapest',
        }),
        (err: unknown) =>
          err instanceof GenericAvailabilityProviderError &&
          err.code === 'provider_input_invalid',
      );
    });

    it('rejects end <= start', async () => {
      const provider = buildGoogleCalendarProvider(
        demoConfig,
        calendarWithPatch(async () => ({ data: {} })),
      );

      await assert.rejects(
        provider.patchEvent('event-456', {
          start: '2026-01-01T11:00:00Z',
          end: '2026-01-01T10:00:00Z',
          timeZone: 'Europe/Budapest',
        }),
        (err: unknown) =>
          err instanceof GenericAvailabilityProviderError &&
          err.code === 'provider_input_invalid',
      );
    });

    it('rejects an invalid IANA timezone', async () => {
      const provider = buildGoogleCalendarProvider(
        demoConfig,
        calendarWithPatch(async () => ({ data: {} })),
      );

      await assert.rejects(
        provider.patchEvent('event-456', {
          start: '2026-01-01T10:00:00Z',
          end: '2026-01-01T11:00:00Z',
          timeZone: 'Mars/Phobos',
        }),
        (err: unknown) =>
          err instanceof GenericAvailabilityProviderError &&
          err.code === 'provider_input_invalid',
      );
    });

    it('rejects an invalid Google response', async () => {
      const patch = async () => ({ data: { id: '' } });

      const provider = buildGoogleCalendarProvider(
        demoConfig,
        calendarWithPatch(patch as unknown as calendar_v3.Calendar['events']['patch']),
      );

      await assert.rejects(
        provider.patchEvent('event-456', {
          start: '2026-01-01T10:00:00Z',
          end: '2026-01-01T11:00:00Z',
          timeZone: 'Europe/Budapest',
        }),
        (err: unknown) =>
          err instanceof GenericAvailabilityProviderError &&
          err.code === 'provider_invalid_response',
      );
    });
  });

  describe('deleteEvent', () => {
    it('deletes an event using the tenant calendarId and explicit eventId', async () => {
      let capturedCalendarId: string | undefined;
      let capturedEventId: string | undefined;

      const del = async (args: { calendarId: string; eventId: string }) => {
        capturedCalendarId = args.calendarId;
        capturedEventId = args.eventId;
        return { data: '' };
      };

      const provider = buildGoogleCalendarProvider(
        demoConfig,
        calendarWithDelete(del as unknown as calendar_v3.Calendar['events']['delete']),
      );

      const result = await provider.deleteEvent('event-789');

      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.eventId, 'event-789');
      assert.equal(capturedCalendarId, demoConfig.calendarId);
      assert.equal(capturedEventId, 'event-789');
    });

    it('rejects an empty eventId', async () => {
      const provider = buildGoogleCalendarProvider(
        demoConfig,
        calendarWithDelete(async () => ({ data: '' })),
      );

      await assert.rejects(
        provider.deleteEvent(''),
        (err: unknown) =>
          err instanceof GenericAvailabilityProviderError &&
          err.code === 'provider_input_invalid',
      );
    });

    it('treats a 404 delete as successful idempotent deletion', async () => {
      const del = async () => {
        const err = new Error('Resource has been deleted');
        (err as Error & { response?: { status: number } }).response = {
          status: 404,
        };
        throw err;
      };

      const provider = buildGoogleCalendarProvider(
        demoConfig,
        calendarWithDelete(del as unknown as calendar_v3.Calendar['events']['delete']),
      );

      const result = await provider.deleteEvent('already-deleted');

      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.eventId, 'already-deleted');
    });

    it('fails closed on non-404 Google delete errors', async () => {
      const del = async () => {
        const err = new Error('forbidden: sensitive-credential-hint');
        (err as Error & { response?: { status: number } }).response = {
          status: 403,
        };
        throw err;
      };

      const provider = buildGoogleCalendarProvider(
        demoConfig,
        calendarWithDelete(del as unknown as calendar_v3.Calendar['events']['delete']),
      );

      await assert.rejects(
        provider.deleteEvent('event-789'),
        (err: unknown) => {
          if (!(err instanceof GenericAvailabilityProviderError)) return false;
          assert.equal(err.code, 'provider_calendar_error');
          assert.ok(!err.message.includes('sensitive-credential-hint'));
          return true;
        },
      );
    });
  });
});

describe('resolveGenericAvailabilityProvider tenant isolation', () => {
  function makeDeps(
    configs: CalendarConfig[] | 'error',
    providerResult: GenericCalendarProvider | Error = buildGoogleCalendarProvider(
      demoConfig,
      makeMockCalendar(),
    ),
  ): ResolverDependencies {
    return {
      async loadConfigs(siteId: string) {
        if (configs === 'error') {
          throw new GenericAvailabilityProviderError(
            'db error',
            'provider_lookup_failed',
          );
        }
        return configs.filter((c) => c.siteId === siteId);
      },
      async buildProvider() {
        if (providerResult instanceof Error) {
          throw providerResult;
        }
        return providerResult;
      },
    };
  }

  it('resolves the correct config for a tenant', async () => {
    const provider = await resolveGenericAvailabilityProvider(
      demoConfig.siteId,
      'szepbor-kozmetika',
      makeDeps([demoConfig]),
    );

    assert.ok(provider.createEvent);
    assert.ok(provider.patchEvent);
    assert.ok(provider.deleteEvent);
  });

  it('rejects when no active config exists', async () => {
    await assert.rejects(
      resolveGenericAvailabilityProvider(
        demoConfig.siteId,
        'szepbor-kozmetika',
        makeDeps([]),
      ),
      (err: unknown) =>
        err instanceof GenericAvailabilityProviderError &&
        err.code === 'provider_unconfigured',
    );
  });

  it('rejects when multiple active configs exist', async () => {
    await assert.rejects(
      resolveGenericAvailabilityProvider(
        demoConfig.siteId,
        'szepbor-kozmetika',
        makeDeps([
          demoConfig,
          { ...demoConfig, id: 'd2222222-2222-2222-2222-222222222222' },
        ]),
      ),
      (err: unknown) =>
        err instanceof GenericAvailabilityProviderError &&
        err.code === 'provider_ambiguous',
    );
  });

  it('isolates tenants by siteId', async () => {
    const otherSiteConfig: CalendarConfig = {
      ...demoConfig,
      siteId: '99999999-9999-9999-9999-999999999999',
      id: 'd9999999-9999-9999-9999-999999999999',
    };

    await assert.rejects(
      resolveGenericAvailabilityProvider(
        demoConfig.siteId,
        'szepbor-kozmetika',
        makeDeps([otherSiteConfig]),
      ),
      (err: unknown) =>
        err instanceof GenericAvailabilityProviderError &&
        err.code === 'provider_unconfigured',
    );
  });

  it('propagates missing credentials as provider_credentials_missing', async () => {
    await assert.rejects(
      resolveGenericAvailabilityProvider(
        demoConfig.siteId,
        'szepbor-kozmetika',
        makeDeps(
          [demoConfig],
          new GenericAvailabilityProviderError(
            'Google OAuth client credentials are not configured',
            'provider_credentials_missing',
          ),
        ),
      ),
      (err: unknown) =>
        err instanceof GenericAvailabilityProviderError &&
        err.code === 'provider_credentials_missing',
    );
  });
});
