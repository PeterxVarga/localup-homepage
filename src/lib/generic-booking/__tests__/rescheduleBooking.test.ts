// ============================================================
// Generic booking reschedule — unit tests
//
// Domain dependencies are injected so the tests never need a live database,
// tenant calendar, or the extensionless TypeScript imports used by
// production wiring.
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateManagementToken,
  hashManagementToken,
  encryptManagementToken,
} from '../../tokens/crypto';
import {
  rescheduleGenericBooking,
  type RescheduleGenericBookingOutcome,
} from '../rescheduleBooking';
import type { BookingServiceContext } from '../../booking-service/types';
import type { GenericAvailabilityProvider } from '../../calendar/genericAvailabilityResolver';

const serviceContext: BookingServiceContext = {
  siteId: '11111111-1111-1111-1111-111111111111',
  siteSlug: 'demo',
  timezone: 'Europe/Budapest',
  serviceId: '22222222-2222-2222-2222-222222222222',
  serviceSlug: 'cosmetic-treatment',
  scheduleId: '33333333-3333-3333-3333-333333333333',
  durationMinutes: 75,
  slotIntervalMinutes: 30,
  minimumNoticeMinutes: 0,
  bookingWindowDays: 14,
  bufferBeforeMinutes: 15,
  bufferAfterMinutes: 15,
  cancelCutoffHours: 12,
  rescheduleCutoffHours: 12,
  maxReschedules: 2,
  publicBookingEnabled: true,
};

const currentSlotStart = '2025-09-01T10:00:00.000Z';
const currentSlotEnd = '2025-09-01T11:15:00.000Z';
const newSlotStart = '2025-09-02T10:00:00.000Z';
const newSlotEnd = '2025-09-02T11:15:00.000Z';

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    booking: {
      id: 'b1111111-1111-1111-1111-111111111111',
      site_id: serviceContext.siteId,
      service_id: serviceContext.serviceId,
      slot_start: currentSlotStart,
      slot_end: currentSlotEnd,
      booking_status: 'booked' as const,
      management_token_hash: 'hash-123',
      management_token_encrypted: 'enc-123',
      management_token_expires_at: '2025-12-01T00:00:00.000Z',
      google_calendar_event_id: null,
      calendar_sync_status: 'pending' as const,
      reschedule_count: 0,
      ...overrides,
    },
  };
}

function makeProvider(
  busySlots: Array<{ start: string; end: string }> = [],
): GenericAvailabilityProvider {
  return {
    async getFreeBusy(_timeMin: string, _timeMax: string) {
      return busySlots;
    },
  };
}

function baseDeps(
  booking: ReturnType<typeof makeBooking>['booking'],
  overrides: Record<string, unknown> = {},
  now = new Date('2025-08-31T20:00:00.000Z'),
) {
  return {
    lookupByTokenHash: async () => booking,
    loadServiceContext: async () => serviceContext,
    isSlotValidAccordingToRules: async () => true,
    resolveAvailabilityProvider: async () => makeProvider(),
    checkSiteBookingConflict: async () => false,
    updateBookingSlot: async () => ({
      ok: true as const,
      booking: {
        ...booking,
        slot_start: newSlotStart,
        slot_end: newSlotEnd,
        reschedule_count: 1,
      },
    }),
    computeBlockedRange: (
      slotStart: string,
      slotEnd: string,
      before: number,
      after: number,
    ) => ({
      blockedStart: new Date(
        new Date(slotStart).getTime() - before * 60_000,
      ).toISOString(),
      blockedEnd: new Date(
        new Date(slotEnd).getTime() + after * 60_000,
      ).toISOString(),
    }),
    getExpectedSlotEnd: (start: string, service: BookingServiceContext) =>
      new Date(
        new Date(start).getTime() + service.durationMinutes * 60_000,
      ).toISOString(),
    getTokenExpiresAt: (slotEnd: string) =>
      new Date(
        new Date(slotEnd).getTime() + 30 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    hashToken: () => 'hash-123',
    verifyToken: () => true,
    now: () => now,
    ...overrides,
  };
}

function assertError(
  outcome: RescheduleGenericBookingOutcome,
  code: import('../rescheduleBooking').RescheduleGenericBookingErrorCode,
) {
  assert.equal(outcome.success, false);
  if (outcome.success) return;
  assert.equal(outcome.error, code);
}

describe('rescheduleGenericBooking', () => {
  it('reschedules to a new valid slot', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    let updateCalled = false;
    const result = await rescheduleGenericBooking(
      { rawToken, expectedOldSlotStart: currentSlotStart, newSlotStart },
      baseDeps(booking, {
        updateBookingSlot: async (params: Record<string, unknown>) => {
          updateCalled = true;
          assert.equal(params.bookingId, booking.id);
          assert.equal(params.currentSlotStart, currentSlotStart);
          assert.equal(params.currentSlotEnd, currentSlotEnd);
          assert.equal(params.currentStatus, 'booked');
          assert.equal(params.currentRescheduleCount, 0);
          assert.equal(params.newSlotStart, newSlotStart);
          assert.equal(params.newSlotEnd, newSlotEnd);
          assert.equal(params.newRescheduleCount, 1);
          assert.ok(typeof params.rescheduledAt === 'string');
          assert.equal(
            params.tokenExpiresAt,
            new Date(
              new Date(newSlotEnd).getTime() +
                30 * 24 * 60 * 60 * 1000,
            ).toISOString(),
          );
          return {
            ok: true as const,
            booking: {
              ...booking,
              slot_start: newSlotStart,
              slot_end: newSlotEnd,
              reschedule_count: 1,
            },
          };
        },
      }),
    );

    assert.equal(result.success, true);
    if (!result.success) return;
    assert.equal(result.bookingId, booking.id);
    assert.equal(result.oldSlotStart, currentSlotStart);
    assert.equal(result.oldSlotEnd, currentSlotEnd);
    assert.equal(result.newSlotStart, newSlotStart);
    assert.equal(result.newSlotEnd, newSlotEnd);
    assert.equal(result.rescheduleCount, 1);
    assert.equal(updateCalled, true);
  });

  it('accepts expectedOldSlotStart in an equivalent timezone', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    const result = await rescheduleGenericBooking(
      {
        rawToken,
        // 12:00+02:00 is the same instant as 10:00Z.
        expectedOldSlotStart: '2025-09-01T12:00:00+02:00',
        newSlotStart,
      },
      baseDeps(booking),
    );

    assert.equal(result.success, true);
  });

  it('returns not_found for a malformed token', async () => {
    const result = await rescheduleGenericBooking(
      {
        rawToken: 'not-a-token',
        expectedOldSlotStart: currentSlotStart,
        newSlotStart,
      },
      {
        lookupByTokenHash: async () => {
          throw new Error('lookup should not be called for malformed token');
        },
        loadServiceContext: async () => serviceContext,
        isSlotValidAccordingToRules: async () => true,
        resolveAvailabilityProvider: async () => makeProvider(),
        checkSiteBookingConflict: async () => false,
        updateBookingSlot: async () => {
          throw new Error('db should not be called for malformed token');
        },
        computeBlockedRange: baseDeps(makeBooking().booking).computeBlockedRange,
        getExpectedSlotEnd: baseDeps(makeBooking().booking).getExpectedSlotEnd,
        getTokenExpiresAt: baseDeps(makeBooking().booking).getTokenExpiresAt,
        hashToken: () => 'hash-123',
        verifyToken: () => true,
        now: () => new Date('2025-08-31T20:00:00.000Z'),
      },
    );

    assertError(result, 'not_found');
  });

  it('returns not_found for an invalid token', async () => {
    const { booking } = makeBooking();
    const result = await rescheduleGenericBooking(
      { rawToken: 'a'.repeat(64), expectedOldSlotStart: currentSlotStart, newSlotStart },
      baseDeps(booking, { verifyToken: () => false }),
    );

    assertError(result, 'not_found');
  });

  it('returns not_found for an expired token', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    const result = await rescheduleGenericBooking(
      { rawToken, expectedOldSlotStart: currentSlotStart, newSlotStart },
      baseDeps(booking, {}, new Date('2026-01-01T00:00:00.000Z')),
    );

    assertError(result, 'not_found');
  });

  it('returns invalid_state for a cancelled booking', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      booking_status: 'cancelled',
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    let updateCalled = false;
    const result = await rescheduleGenericBooking(
      { rawToken, expectedOldSlotStart: currentSlotStart, newSlotStart },
      baseDeps(booking, {
        updateBookingSlot: async () => {
          updateCalled = true;
          return { ok: true as const, booking };
        },
      }),
    );

    assertError(result, 'invalid_state');
    assert.equal(updateCalled, false);
  });

  it('returns booking_changed when expectedOldSlotStart does not match', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    const result = await rescheduleGenericBooking(
      {
        rawToken,
        expectedOldSlotStart: '2025-09-01T12:00:00.000Z',
        newSlotStart,
      },
      baseDeps(booking),
    );

    assertError(result, 'booking_changed');
  });

  it('returns invalid_slot when the new slot violates availability rules', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    const result = await rescheduleGenericBooking(
      { rawToken, expectedOldSlotStart: currentSlotStart, newSlotStart },
      baseDeps(booking, {
        isSlotValidAccordingToRules: async () => false,
      }),
    );

    assertError(result, 'invalid_slot');
  });

  it('returns cutoff_passed when the reschedule cutoff has passed', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    const result = await rescheduleGenericBooking(
      { rawToken, expectedOldSlotStart: currentSlotStart, newSlotStart },
      baseDeps(booking, {}, new Date('2025-09-01T10:00:00.000Z')),
    );

    assertError(result, 'cutoff_passed');
  });

  it('returns max_reschedules_reached when the limit is hit', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      reschedule_count: 2,
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    const result = await rescheduleGenericBooking(
      { rawToken, expectedOldSlotStart: currentSlotStart, newSlotStart },
      baseDeps(booking),
    );

    assertError(result, 'max_reschedules_reached');
  });

  it('excludes the current booking from the site conflict check', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    let called = false;
    const result = await rescheduleGenericBooking(
      { rawToken, expectedOldSlotStart: currentSlotStart, newSlotStart },
      baseDeps(booking, {
        checkSiteBookingConflict: async (
          siteId: string,
          blockedStart: string,
          blockedEnd: string,
          excludeBookingId: string,
        ) => {
          called = true;
          assert.equal(siteId, booking.site_id);
          assert.equal(excludeBookingId, booking.id);
          return false;
        },
      }),
    );

    assert.equal(result.success, true);
    assert.equal(called, true);
  });

  it('returns slot_taken when there is a site-level booking conflict', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    const result = await rescheduleGenericBooking(
      { rawToken, expectedOldSlotStart: currentSlotStart, newSlotStart },
      baseDeps(booking, {
        checkSiteBookingConflict: async () => true,
      }),
    );

    assertError(result, 'slot_taken');
  });

  it('returns slot_taken when the tenant Calendar is busy', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    const result = await rescheduleGenericBooking(
      { rawToken, expectedOldSlotStart: currentSlotStart, newSlotStart },
      baseDeps(booking, {
        resolveAvailabilityProvider: async () =>
          makeProvider([{ start: newSlotStart, end: newSlotEnd }]),
      }),
    );

    assertError(result, 'slot_taken');
  });

  it('returns slot_taken on a 23P01 exclusion violation', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    let updateCalled = false;
    const result = await rescheduleGenericBooking(
      { rawToken, expectedOldSlotStart: currentSlotStart, newSlotStart },
      baseDeps(booking, {
        updateBookingSlot: async () => {
          updateCalled = true;
          return {
            ok: false as const,
            errorCode: '23P01',
            errorMessage: 'exclusion violation',
          };
        },
      }),
    );

    assertError(result, 'slot_taken');
    assert.equal(updateCalled, true);
  });

  it('returns service_unavailable when the booking already has a calendar event', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      google_calendar_event_id: 'evt_123',
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    let updateCalled = false;
    const result = await rescheduleGenericBooking(
      { rawToken, expectedOldSlotStart: currentSlotStart, newSlotStart },
      baseDeps(booking, {
        updateBookingSlot: async () => {
          updateCalled = true;
          return { ok: true as const, booking };
        },
      }),
    );

    assertError(result, 'service_unavailable');
    assert.equal(updateCalled, false);
  });

  it('returns service_unavailable when calendar_sync_status is synced', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      calendar_sync_status: 'synced',
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    let updateCalled = false;
    const result = await rescheduleGenericBooking(
      { rawToken, expectedOldSlotStart: currentSlotStart, newSlotStart },
      baseDeps(booking, {
        updateBookingSlot: async () => {
          updateCalled = true;
          return { ok: true as const, booking };
        },
      }),
    );

    assertError(result, 'service_unavailable');
    assert.equal(updateCalled, false);
  });

  it('returns service_unavailable for an inactive service', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    const result = await rescheduleGenericBooking(
      { rawToken, expectedOldSlotStart: currentSlotStart, newSlotStart },
      baseDeps(booking, {
        loadServiceContext: async () => {
          throw new Error('service_inactive');
        },
      }),
    );

    assertError(result, 'service_unavailable');
  });

  it('returns service_unavailable when the availability provider cannot be resolved', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    const result = await rescheduleGenericBooking(
      { rawToken, expectedOldSlotStart: currentSlotStart, newSlotStart },
      baseDeps(booking, {
        resolveAvailabilityProvider: async () => {
          throw new Error('provider unconfigured');
        },
      }),
    );

    assertError(result, 'service_unavailable');
  });

  it('returns db_error when the atomic update reports an unexpected error', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    const result = await rescheduleGenericBooking(
      { rawToken, expectedOldSlotStart: currentSlotStart, newSlotStart },
      baseDeps(booking, {
        updateBookingSlot: async () => ({
          ok: false as const,
          errorCode: 'UNKNOWN',
          errorMessage: 'boom',
        }),
      }),
    );

    assertError(result, 'db_error');
  });

  it('returns booking_changed when the optimistic update finds no rows', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    const result = await rescheduleGenericBooking(
      { rawToken, expectedOldSlotStart: currentSlotStart, newSlotStart },
      baseDeps(booking, {
        updateBookingSlot: async () => ({
          ok: false as const,
          errorCode: 'NO_ROWS',
          errorMessage: 'No rows updated',
        }),
      }),
    );

    assertError(result, 'booking_changed');
  });

  it('is idempotent when the same slot is requested', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    let updateCalled = false;
    const result = await rescheduleGenericBooking(
      {
        rawToken,
        expectedOldSlotStart: currentSlotStart,
        newSlotStart: currentSlotStart,
      },
      baseDeps(booking, {
        updateBookingSlot: async () => {
          updateCalled = true;
          return { ok: true as const, booking };
        },
      }),
    );

    assert.equal(result.success, true);
    if (!result.success) return;
    assert.equal(result.idempotent, true);
    assert.equal(result.rescheduleCount, 0);
    assert.equal(updateCalled, false);
  });
});
