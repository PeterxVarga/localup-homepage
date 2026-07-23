// ============================================================
// Generic booking — unit tests
//
// Run with:
//   node --experimental-strip-types --test src/lib/generic-booking/__tests__/intervals.test.ts
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBlockedRange,
  intervalsOverlap,
  getExpectedSlotEnd,
} from '../../booking/intervals.ts';
import { genericBookingRequestSchema } from '../validation.ts';
import type { BookingServiceContext } from '../../booking-service/types.ts';

const service75Min: BookingServiceContext = {
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
};

describe('computeBlockedRange', () => {
  it('includes buffers around a 75-minute slot', () => {
    const slotStart = '2025-08-01T09:00:00.000Z';
    const slotEnd = '2025-08-01T10:15:00.000Z';

    const { blockedStart, blockedEnd } = computeBlockedRange(
      slotStart,
      slotEnd,
      service75Min.bufferBeforeMinutes,
      service75Min.bufferAfterMinutes,
    );

    assert.equal(blockedStart, '2025-08-01T08:45:00.000Z');
    assert.equal(blockedEnd, '2025-08-01T10:30:00.000Z');
  });

  it('works with zero buffers', () => {
    const slotStart = '2025-08-01T09:00:00.000Z';
    const slotEnd = '2025-08-01T10:00:00.000Z';

    const { blockedStart, blockedEnd } = computeBlockedRange(
      slotStart,
      slotEnd,
      0,
      0,
    );

    assert.equal(blockedStart, slotStart);
    assert.equal(blockedEnd, slotEnd);
  });
});

describe('intervalsOverlap', () => {
  it('detects overlapping intervals', () => {
    assert.equal(
      intervalsOverlap(
        '2025-08-01T09:00:00.000Z',
        '2025-08-01T10:00:00.000Z',
        '2025-08-01T09:30:00.000Z',
        '2025-08-01T10:30:00.000Z',
      ),
      true,
    );
  });

  it('treats touching [) intervals as non-overlapping', () => {
    assert.equal(
      intervalsOverlap(
        '2025-08-01T09:00:00.000Z',
        '2025-08-01T10:00:00.000Z',
        '2025-08-01T10:00:00.000Z',
        '2025-08-01T11:00:00.000Z',
      ),
      false,
    );

    assert.equal(
      intervalsOverlap(
        '2025-08-01T10:00:00.000Z',
        '2025-08-01T11:00:00.000Z',
        '2025-08-01T09:00:00.000Z',
        '2025-08-01T10:00:00.000Z',
      ),
      false,
    );
  });

  it('treats separated intervals as non-overlapping', () => {
    assert.equal(
      intervalsOverlap(
        '2025-08-01T09:00:00.000Z',
        '2025-08-01T10:00:00.000Z',
        '2025-08-01T10:15:00.000Z',
        '2025-08-01T11:00:00.000Z',
      ),
      false,
    );
  });
});

describe('genericBookingRequestSchema', () => {
  const validBody = {
    name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '+36 30 123 4567',
    notes: 'Notes',
    slotStart: '2025-08-01T09:00:00.000Z',
    slotEnd: '2025-08-01T10:15:00.000Z',
    locale: 'hu',
  };

  it('accepts a valid request body', () => {
    const result = genericBookingRequestSchema.safeParse(validBody);
    assert.equal(result.success, true);
  });

  it('rejects siteId', () => {
    const result = genericBookingRequestSchema.safeParse({
      ...validBody,
      siteId: '11111111-1111-1111-1111-111111111111',
    });
    assert.equal(result.success, false);
  });

  it('rejects serviceId', () => {
    const result = genericBookingRequestSchema.safeParse({
      ...validBody,
      serviceId: '22222222-2222-2222-2222-222222222222',
    });
    assert.equal(result.success, false);
  });

  it('rejects duration', () => {
    const result = genericBookingRequestSchema.safeParse({
      ...validBody,
      duration: 75,
    });
    assert.equal(result.success, false);
  });

  it('rejects buffer fields', () => {
    const result = genericBookingRequestSchema.safeParse({
      ...validBody,
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 15,
    });
    assert.equal(result.success, false);
  });

  it('rejects bookingStatus', () => {
    const result = genericBookingRequestSchema.safeParse({
      ...validBody,
      bookingStatus: 'booked',
    });
    assert.equal(result.success, false);
  });

  it('rejects calendarSyncStatus', () => {
    const result = genericBookingRequestSchema.safeParse({
      ...validBody,
      calendarSyncStatus: 'synced',
    });
    assert.equal(result.success, false);
  });
});

describe('getExpectedSlotEnd', () => {
  it('computes the correct end for a 75-minute service', () => {
    const start = '2025-08-01T09:00:00.000Z';
    const end = getExpectedSlotEnd(start, service75Min.durationMinutes);
    assert.equal(end, '2025-08-01T10:15:00.000Z');
  });

  it('detects a slotEnd that does not match the service duration', () => {
    const start = '2025-08-01T09:00:00.000Z';
    const expectedEnd = getExpectedSlotEnd(start, service75Min.durationMinutes);
    const wrongEnd = '2025-08-01T10:00:00.000Z';
    assert.notEqual(wrongEnd, expectedEnd);
  });
});
