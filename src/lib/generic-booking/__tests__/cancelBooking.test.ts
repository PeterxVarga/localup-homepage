// ============================================================
// Generic booking cancel — unit tests
//
// Domain dependencies are injected so the tests never need a live database.
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateManagementToken,
  hashManagementToken,
  encryptManagementToken,
} from '../../tokens/crypto';
import {
  cancelGenericBooking,
  type CancelGenericBookingOutcome,
} from '../cancelBooking';
import type { BookingServiceContext } from '../../booking-service/types';

const serviceContext: BookingServiceContext = {
  siteId: '11111111-1111-1111-1111-111111111111',
  siteSlug: 'demo',
  siteName: 'Demo Site',
  timezone: 'Europe/Budapest',
  serviceId: '22222222-2222-2222-2222-222222222222',
  serviceSlug: 'cosmetic-treatment',
  serviceName: 'Cosmetic Treatment',
  scheduleId: '33333333-3333-3333-3333-333333333333',
  durationMinutes: 75,
  maxDurationMinutes: null,
  slotIntervalMinutes: 30,
  minimumNoticeMinutes: 0,
  bookingWindowDays: 14,
  bufferBeforeMinutes: 15,
  bufferAfterMinutes: 15,
  cancelCutoffHours: 12,
  rescheduleCutoffHours: 12,
  maxReschedules: 2,
  publicBookingEnabled: true,
  pricingMode: 'fixed',
  basePriceMinor: null,
  basePriceMaxMinor: null,
  currency: 'HUF',
};

const currentSlotStart = '2025-09-01T10:00:00.000Z';
const currentSlotEnd = '2025-09-01T11:15:00.000Z';

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    booking: {
      id: 'b1111111-1111-1111-1111-111111111111',
      service_id: serviceContext.serviceId,
      customer_name: 'Teszt Elek',
      customer_email: 'teszt@example.com',
      customer_phone: null,
      customer_notes: null,
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

function baseDeps(
  booking: ReturnType<typeof makeBooking>['booking'],
  overrides: Record<string, unknown> = {},
  now = new Date('2025-08-31T20:00:00.000Z'),
) {
  return {
    lookupByTokenHash: async () => booking,
    loadServiceContext: async () => serviceContext,
    cancelBookingInDb: async () => booking,
    resolveCalendarProvider: async () => ({
      async getFreeBusy() { return []; },
      async createEvent() { return { ok: false, provider: 'mock', error: 'not implemented' }; },
      async patchEvent() { return { ok: false, provider: 'mock', eventId: '', error: 'not implemented' }; },
      async deleteEvent() { return { ok: true, provider: 'mock', eventId: '' }; },
    }),
    deleteCalendarEvent: async () => true,
    clearCalendarEventInDb: async () => true,
    markCalendarSyncFailed: async () => true,
    sendCancellationEmails: async () => ({ customer: true, admin: true }),
    hashToken: () => 'hash-123',
    verifyToken: () => true,
    now: () => now,
    ...overrides,
  };
}

function assertError(
  outcome: CancelGenericBookingOutcome,
  code: import('../cancelBooking').CancelGenericBookingErrorCode,
) {
  assert.equal(outcome.success, false);
  if (outcome.success) return;
  assert.equal(outcome.error, code);
}

describe('cancelGenericBooking', () => {
  it('cancels a booked booking', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    let called = false;
    const result = await cancelGenericBooking(rawToken, 'más időpont', {
      ...baseDeps(booking),
      cancelBookingInDb: (
        bookingId: string,
        reason: string | undefined,
        now: Date,
        currentStatus: 'pending' | 'booked',
      ) => {
        called = true;
        assert.equal(bookingId, booking.id);
        assert.equal(reason, 'más időpont');
        assert.equal(currentStatus, 'booked');
        assert.ok(now instanceof Date);
        return Promise.resolve(booking);
      },
    });

    assert.equal(result.success, true);
    assert.equal(called, true);
  });

  it('cancels a pending booking', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      booking_status: 'pending',
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    let called = false;
    const result = await cancelGenericBooking(rawToken, undefined, {
      ...baseDeps(booking),
      cancelBookingInDb: (
        _id: string,
        _reason: string | undefined,
        _now: Date,
        currentStatus: 'pending' | 'booked',
      ) => {
        called = true;
        assert.equal(currentStatus, 'pending');
        return Promise.resolve(booking);
      },
    });

    assert.equal(result.success, true);
    assert.equal(called, true);
  });

  it('returns not_found for a malformed token', async () => {
    const result = await cancelGenericBooking('not-a-token', undefined, {
      lookupByTokenHash: async () => {
        throw new Error('lookup should not be called for malformed token');
      },
      loadServiceContext: async () => serviceContext,
      cancelBookingInDb: async () => {
        throw new Error('db should not be called for malformed token');
      },
      hashToken: () => 'hash-123',
      verifyToken: () => true,
      now: () => new Date('2025-08-31T20:00:00.000Z'),
    });

    assertError(result, 'not_found');
  });

  it('returns not_found for an invalid token', async () => {
    const { booking } = makeBooking();
    const result = await cancelGenericBooking('a'.repeat(64), undefined, {
      ...baseDeps(booking),
      verifyToken: () => false,
    });

    assertError(result, 'not_found');
  });

  it('returns not_found for an expired token', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    const result = await cancelGenericBooking(
      rawToken,
      undefined,
      baseDeps(booking, {}, new Date('2026-01-01T00:00:00.000Z')),
    );

    assertError(result, 'not_found');
  });

  it('returns invalid_state for an already cancelled booking', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      booking_status: 'cancelled',
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    let called = false;
    const result = await cancelGenericBooking(rawToken, undefined, {
      ...baseDeps(booking),
      cancelBookingInDb: async () => {
        called = true;
        return booking;
      },
    });

    assertError(result, 'invalid_state');
    assert.equal(called, false);
  });

  it('returns cutoff_passed when the cancel cutoff has passed', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    const result = await cancelGenericBooking(
      rawToken,
      undefined,
      baseDeps(booking, {}, new Date('2025-09-01T10:00:00.000Z')),
    );

    assertError(result, 'cutoff_passed');
  });

  it('deletes the tenant Calendar event when one exists', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      google_calendar_event_id: 'evt_123',
      calendar_sync_status: 'synced',
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    let deletedEventId: string | null = null;
    let clearedBookingId: string | null = null;
    const result = await cancelGenericBooking(rawToken, undefined, {
      ...baseDeps(booking),
      deleteCalendarEvent: async (_provider, eventId) => {
        deletedEventId = eventId;
        return true;
      },
      clearCalendarEventInDb: async ({ bookingId }) => {
        clearedBookingId = bookingId;
        return true;
      },
    });

    assert.equal(result.success, true);
    assert.equal(deletedEventId, 'evt_123');
    assert.equal(clearedBookingId, booking.id);
  });

  it('returns service_unavailable when calendar deletion fails', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      google_calendar_event_id: 'evt_123',
      calendar_sync_status: 'synced',
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    let markedBookingId: string | null = null;
    const result = await cancelGenericBooking(rawToken, undefined, {
      ...baseDeps(booking),
      deleteCalendarEvent: async () => false,
      markCalendarSyncFailed: async ({ bookingId }) => {
        markedBookingId = bookingId;
        return true;
      },
    });

    assertError(result, 'service_unavailable');
    assert.equal(markedBookingId, booking.id);
  });

  it('works even if the service is inactive', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    const result = await cancelGenericBooking(rawToken, undefined, {
      ...baseDeps(booking),
      loadServiceContext: async () =>
        ({ ...serviceContext, publicBookingEnabled: false } as BookingServiceContext),
    });

    assert.equal(result.success, true);
  });

  it('returns service_unavailable when the service context cannot load', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    const result = await cancelGenericBooking(rawToken, undefined, {
      ...baseDeps(booking),
      loadServiceContext: async () => {
        throw new Error('service gone');
      },
    });

    assertError(result, 'service_unavailable');
  });

  it('returns invalid_state when the atomic update finds no rows', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    const result = await cancelGenericBooking(rawToken, undefined, {
      ...baseDeps(booking),
      cancelBookingInDb: async () => null,
    });

    assertError(result, 'invalid_state');
  });

  it('sends cancellation emails after a successful cancel', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    let emailCalled = false;
    const result = await cancelGenericBooking(rawToken, undefined, {
      ...baseDeps(booking),
      sendCancellationEmails: async (params) => {
        emailCalled = true;
        assert.equal(params.bookingId, booking.id);
        assert.equal(params.customerEmail, booking.customer_email);
        return { customer: true, admin: true };
      },
    });

    assert.equal(result.success, true);
    assert.equal(emailCalled, true);
  });

  it('does not send cancellation emails when the DB update fails', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBooking({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    let emailCalled = false;
    const result = await cancelGenericBooking(rawToken, undefined, {
      ...baseDeps(booking),
      cancelBookingInDb: async () => null,
      sendCancellationEmails: async () => {
        emailCalled = true;
        return { customer: true, admin: true };
      },
    });

    assertError(result, 'invalid_state');
    assert.equal(emailCalled, false);
  });
});
