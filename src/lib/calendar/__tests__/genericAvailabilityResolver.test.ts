// ============================================================
// Generic availability resolver — unit tests
//
// Run with:
//   node --experimental-strip-types --test src/lib/calendar/__tests__/genericAvailabilityResolver.test.ts
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bindGetFreeBusy,
  GenericAvailabilityProviderError,
  parseFreeBusyResponse,
  resolveGenericAvailabilityProvider,
} from '../genericAvailabilityResolver.ts';
import type {
  CalendarConfig,
  FreeBusyResponse,
  GenericAvailabilityProvider,
  ResolverDependencies,
} from '../genericAvailabilityResolver.ts';

const demoConfig: CalendarConfig = {
  id: 'd1111111-1111-1111-1111-111111111111',
  siteId: 'a1111111-1111-1111-1111-111111111111',
  provider: 'google',
  calendarId: 'tenant-calendar@example.com',
  encryptedRefreshToken: 'encrypted-token',
};

const mockProvider: GenericAvailabilityProvider = {
  async getFreeBusy(timeMin: string, timeMax: string) {
    return [
      { start: timeMin, end: timeMax },
    ];
  },
};

function makeDeps(
  configs: CalendarConfig[] | 'error',
  providerResult: GenericAvailabilityProvider | Error = mockProvider,
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

describe('resolveGenericAvailabilityProvider', () => {
  it('resolves the correct config for a tenant', async () => {
    const provider = await resolveGenericAvailabilityProvider(
      demoConfig.siteId,
      'szepbor-kozmetika',
      makeDeps([demoConfig]),
    );

    const result = await provider.getFreeBusy('2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z');
    assert.equal(result.length, 1);
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

  it('rejects when the config is inactive (filtered out)', async () => {
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
        makeDeps([demoConfig, { ...demoConfig, id: 'd2222222-2222-2222-2222-222222222222' }]),
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

  it('propagates buildProvider errors fail-closed', async () => {
    await assert.rejects(
      resolveGenericAvailabilityProvider(
        demoConfig.siteId,
        'szepbor-kozmetika',
        makeDeps([demoConfig], new GenericAvailabilityProviderError(
          'decrypt failed',
          'provider_decrypt_failed',
        )),
      ),
      (err: unknown) =>
        err instanceof GenericAvailabilityProviderError &&
        err.code === 'provider_decrypt_failed',
    );
  });
});

describe('parseFreeBusyResponse', () => {
  const calendarId = 'tenant-calendar@example.com';

  it('returns an empty array for a valid empty busy response', () => {
    const response: FreeBusyResponse = {
      calendars: {
        [calendarId]: { busy: [] },
      },
    };
    const result = parseFreeBusyResponse(response, calendarId);
    assert.equal(result.length, 0);
  });

  it('returns valid busy intervals', () => {
    const response: FreeBusyResponse = {
      calendars: {
        [calendarId]: {
          busy: [
            { start: '2026-01-01T10:00:00Z', end: '2026-01-01T11:00:00Z' },
          ],
        },
      },
    };
    const result = parseFreeBusyResponse(response, calendarId);
    assert.equal(result.length, 1);
    assert.equal(result[0].start, '2026-01-01T10:00:00Z');
    assert.equal(result[0].end, '2026-01-01T11:00:00Z');
  });

  it('rejects missing calendars data', () => {
    assert.throws(
      () => parseFreeBusyResponse({}, calendarId),
      (err: unknown) =>
        err instanceof GenericAvailabilityProviderError &&
        err.code === 'provider_invalid_response',
    );
  });

  it('rejects missing calendar ID entry', () => {
    const response: FreeBusyResponse = {
      calendars: {
        'other-calendar@example.com': { busy: [] },
      },
    };
    assert.throws(
      () => parseFreeBusyResponse(response, calendarId),
      (err: unknown) =>
        err instanceof GenericAvailabilityProviderError &&
        err.code === 'provider_invalid_response',
    );
  });

  it('rejects per-calendar errors', () => {
    const response: FreeBusyResponse = {
      calendars: {
        [calendarId]: {
          busy: [],
          errors: [{ reason: 'notFound' }],
        },
      },
    };
    assert.throws(
      () => parseFreeBusyResponse(response, calendarId),
      (err: unknown) =>
        err instanceof GenericAvailabilityProviderError &&
        err.code === 'provider_calendar_error',
    );
  });

  it('rejects busy entries missing start or end', () => {
    const response: FreeBusyResponse = {
      calendars: {
        [calendarId]: {
          busy: [{ start: '2026-01-01T10:00:00Z' }],
        },
      },
    };
    assert.throws(
      () => parseFreeBusyResponse(response, calendarId),
      (err: unknown) =>
        err instanceof GenericAvailabilityProviderError &&
        err.code === 'provider_invalid_response',
    );
  });

  it('rejects invalid timestamp strings', () => {
    const response: FreeBusyResponse = {
      calendars: {
        [calendarId]: {
          busy: [{ start: 'not-a-date', end: '2026-01-01T11:00:00Z' }],
        },
      },
    };
    assert.throws(
      () => parseFreeBusyResponse(response, calendarId),
      (err: unknown) =>
        err instanceof GenericAvailabilityProviderError &&
        err.code === 'provider_invalid_response',
    );
  });

  it('rejects zero-length busy intervals', () => {
    const response: FreeBusyResponse = {
      calendars: {
        [calendarId]: {
          busy: [{ start: '2026-01-01T10:00:00Z', end: '2026-01-01T10:00:00Z' }],
        },
      },
    };
    assert.throws(
      () => parseFreeBusyResponse(response, calendarId),
      (err: unknown) =>
        err instanceof GenericAvailabilityProviderError &&
        err.code === 'provider_invalid_response',
    );
  });

  it('rejects inverted busy intervals', () => {
    const response: FreeBusyResponse = {
      calendars: {
        [calendarId]: {
          busy: [{ start: '2026-01-01T11:00:00Z', end: '2026-01-01T10:00:00Z' }],
        },
      },
    };
    assert.throws(
      () => parseFreeBusyResponse(response, calendarId),
      (err: unknown) =>
        err instanceof GenericAvailabilityProviderError &&
        err.code === 'provider_invalid_response',
    );
  });
});

describe('bindGetFreeBusy', () => {
  it('preserves binding when the method is passed as a callback', async () => {
    const provider: GenericAvailabilityProvider = {
      async getFreeBusy(timeMin: string, timeMax: string) {
        return [{ start: timeMin, end: timeMax }];
      },
    };

    const callback = bindGetFreeBusy(provider);
    const result = await callback('2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z');

    assert.equal(result.length, 1);
    assert.equal(result[0].start, '2026-01-01T10:00:00Z');
    assert.equal(result[0].end, '2026-01-01T11:00:00Z');
  });

  it('works with class-based providers that depend on this', async () => {
    class ClassProvider implements GenericAvailabilityProvider {
      calendarId: string;

      constructor(calendarId: string) {
        this.calendarId = calendarId;
      }

      async getFreeBusy(timeMin: string, timeMax: string) {
        return [{ start: timeMin, end: timeMax, calendarId: this.calendarId }];
      }
    }

    const provider = new ClassProvider('class-calendar');
    const callback = bindGetFreeBusy(provider);
    const result = await callback('2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z');

    const first = result[0] as { start: string; end: string; calendarId: string };
    assert.equal(first.calendarId, 'class-calendar');
  });
});
