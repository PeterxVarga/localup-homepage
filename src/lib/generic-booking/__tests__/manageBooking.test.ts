// ============================================================
// Generic booking management lookup — unit tests
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
  getManageBookingDetails,
  type GenericManageBookingDetails,
} from '../manageBooking';
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

function makeBookingRow(overrides: Record<string, unknown> = {}) {
  const slotStart = '2025-09-01T10:00:00.000Z';
  const slotEnd = '2025-09-01T11:15:00.000Z';

  return {
    booking: {
      id: 'b1111111-1111-1111-1111-111111111111',
      site_id: serviceContext.siteId,
      service_id: serviceContext.serviceId,
      customer_name: 'Teszt Elek',
      customer_email: 'teszt@example.com',
      slot_start: slotStart,
      slot_end: slotEnd,
      booking_status: 'booked' as const,
      management_token_hash: 'hash-123',
      management_token_encrypted: 'enc-123',
      management_token_expires_at: '2025-12-01T00:00:00.000Z',
      reschedule_count: 0,
      ...overrides,
    },
  };
}

function baseDeps(
  booking: ReturnType<typeof makeBookingRow>['booking'],
  overrides: Record<string, unknown> = {},
  now = new Date('2025-08-31T20:00:00.000Z'),
) {
  return {
    lookupByTokenHash: async () => booking,
    loadServiceContext: async () => serviceContext,
    hashToken: () => 'hash-123',
    verifyToken: () => true,
    now: () => now,
    ...overrides,
  };
}

describe('getManageBookingDetails', () => {
  it('returns details for a valid token', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBookingRow({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    const result = await getManageBookingDetails(rawToken, baseDeps(booking));

    assert.equal(result.status, 'found');
    if (result.status !== 'found') return;

    const d: GenericManageBookingDetails = result.details;
    assert.equal(d.bookingId, booking.id);
    assert.equal(d.name, booking.customer_name);
    assert.equal(d.email, booking.customer_email);
    assert.equal(d.slotStart, booking.slot_start);
    assert.equal(d.slotEnd, booking.slot_end);
    assert.equal(d.siteSlug, serviceContext.siteSlug);
    assert.equal(d.serviceSlug, serviceContext.serviceSlug);
    assert.equal(d.isCancelled, false);
    assert.equal(d.rescheduleCount, 0);
    assert.equal(d.maxReschedules, serviceContext.maxReschedules);
    // Internal UUIDs and isExpired are not exposed.
    assert.equal(
      'siteId' in d || 'serviceId' in d || 'isExpired' in d,
      false,
    );
  });

  it('returns not_found for a malformed token', async () => {
    const result = await getManageBookingDetails('not-a-token', {
      lookupByTokenHash: async () => {
        throw new Error('lookup should not be called for malformed token');
      },
      loadServiceContext: async () => serviceContext,
      hashToken: () => 'hash-123',
      verifyToken: () => true,
      now: () => new Date('2025-08-31T20:00:00.000Z'),
    });

    assert.equal(result.status, 'not_found');
  });

  it('returns not_found for a mismatched raw token', async () => {
    const { booking } = makeBookingRow();
    const result = await getManageBookingDetails(
      'a'.repeat(64),
      baseDeps(booking, { verifyToken: () => false }),
    );

    assert.equal(result.status, 'not_found');
  });

  it('returns not_found for an expired token', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBookingRow({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    const result = await getManageBookingDetails(
      rawToken,
      baseDeps(booking, {}, new Date('2026-01-01T00:00:00.000Z')),
    );

    assert.equal(result.status, 'not_found');
  });

  it('returns not_found when the hash lookup returns nothing', async () => {
    const result = await getManageBookingDetails(generateManagementToken(), {
      lookupByTokenHash: async () => null,
      loadServiceContext: async () => serviceContext,
      hashToken: () => 'hash-123',
      verifyToken: () => true,
      now: () => new Date('2025-08-31T20:00:00.000Z'),
    });

    assert.equal(result.status, 'not_found');
  });

  it('returns service_unavailable when the service context cannot load', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBookingRow({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    const result = await getManageBookingDetails(rawToken, {
      ...baseDeps(booking),
      loadServiceContext: async () => {
        throw new Error('service gone');
      },
    });

    assert.equal(result.status, 'service_unavailable');
  });

  it('works even if the service is inactive', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBookingRow({
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    const result = await getManageBookingDetails(rawToken, {
      ...baseDeps(booking),
      loadServiceContext: async () =>
        ({ ...serviceContext, publicBookingEnabled: false } as BookingServiceContext),
    });

    assert.equal(result.status, 'found');
  });

  it('reports cancelled state and passed cutoffs correctly', async () => {
    const rawToken = generateManagementToken();
    const { booking } = makeBookingRow({
      booking_status: 'cancelled',
      management_token_hash: hashManagementToken(rawToken),
      management_token_encrypted: encryptManagementToken(rawToken),
    });
    const result = await getManageBookingDetails(
      rawToken,
      baseDeps(booking, {}, new Date('2025-09-01T08:00:00.000Z')),
    );

    assert.equal(result.status, 'found');
    if (result.status !== 'found') return;

    assert.equal(result.details.isCancelled, true);
    assert.equal(result.details.cancelCutoffPassed, true);
    assert.equal(result.details.rescheduleCutoffPassed, true);
  });
});
