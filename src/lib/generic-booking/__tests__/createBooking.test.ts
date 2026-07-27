// ============================================================
// Generic booking create — unit tests
//
// Domain dependencies are injected so the tests never need a live database
// or tenant calendar.
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGenericBooking,
  type CreateBookingDeps,
  type GenericBookingInput,
} from '../createBooking';
import type { BookingServiceContext } from '../../booking-service/types';
import type { GenericCalendarProvider } from '../../calendar/genericAvailabilityResolver';
import type { CreateEventResult } from '../../calendar/types';

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

const slotStart = '2025-09-01T10:00:00.000Z';
const slotEnd = '2025-09-01T11:15:00.000Z';

const baseInput: GenericBookingInput = {
  name: 'Teszt Elek',
  email: 'teszt@example.com',
  phone: '+36 30 123 4567',
  notes: 'Megjegyzés',
  slotStart,
  slotEnd,
  locale: 'hu',
};

function makeProvider(): GenericCalendarProvider {
  return {
    async getFreeBusy() {
      return [];
    },
    async createEvent() {
      return {
        ok: true,
        provider: 'mock',
        eventId: 'evt_123',
        htmlLink: 'https://calendar.example.com/evt_123',
      };
    },
    async patchEvent() {
      return { ok: true, provider: 'mock', eventId: '' };
    },
    async deleteEvent() {
      return { ok: true, provider: 'mock', eventId: '' };
    },
  };
}

function baseDeps(overrides: Partial<CreateBookingDeps> = {}): Required<CreateBookingDeps> {
  return {
    async isSlotValidAccordingToRules() {
      return true;
    },
    async resolveCalendarProvider() {
      return makeProvider();
    },
    async insertBooking() {
      return {
        ok: true,
        booking: {
          id: 'test-booking-id',
          slot_start: slotStart,
          slot_end: slotEnd,
        },
      };
    },
    async createCalendarEvent(provider, params) {
      return provider.createEvent(params);
    },
    async updateBookingCalendarSync() {
      return true;
    },
    async cancelBookingById() {
      return true;
    },
    ...overrides,
  };
}

describe('createGenericBooking', () => {
  it('creates a fully synced booking', async () => {
    let inserted = false;
    let createParams: Parameters<CreateBookingDeps['createCalendarEvent']>[1] | null = null;
    let syncedEventId: string | null = null;

    const result = await createGenericBooking(
      baseInput,
      serviceContext,
      baseDeps({
        createCalendarEvent: async (_provider, params) => {
          createParams = params;
          return {
            ok: true,
            provider: 'mock',
            eventId: 'evt_123',
          } as CreateEventResult;
        },
        updateBookingCalendarSync: async ({ googleCalendarEventId }) => {
          syncedEventId = googleCalendarEventId;
          return true;
        },
      }),
    );

    assert.equal(result.success, true);
    assert.ok(createParams);
    if (!createParams) return;
    assert.equal(createParams.summary, 'Demo Site — Cosmetic Treatment');
    assert.equal(createParams.start, slotStart);
    assert.equal(createParams.end, slotEnd);
    assert.equal(createParams.timeZone, 'Europe/Budapest');
    assert.equal(createParams.attendeeEmail, baseInput.email);
    assert.ok(createParams.description?.includes(baseInput.name));
    assert.ok(createParams.description?.includes(baseInput.email));
    assert.equal(syncedEventId, 'evt_123');
  });

  it('does not create a booking when the calendar provider cannot be resolved', async () => {
    let insertCalled = false;
    const result = await createGenericBooking(
      baseInput,
      serviceContext,
      baseDeps({
        resolveCalendarProvider: async () => {
          throw new Error('provider unconfigured');
        },
        insertBooking: async () => {
          insertCalled = true;
          return {
            ok: true,
            booking: { id: 'should-not-happen', slot_start: slotStart, slot_end: slotEnd },
          };
        },
      }),
    );

    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error, 'service_unavailable');
    assert.equal(insertCalled, false);
  });

  it('cancels the booking when calendar creation fails so the slot is unblocked', async () => {
    let cancelledBookingId: string | null = null;
    const result = await createGenericBooking(
      baseInput,
      serviceContext,
      baseDeps({
        createCalendarEvent: async () => ({
          ok: false,
          provider: 'mock',
          error: 'provider error',
        }),
        cancelBookingById: async (bookingId) => {
          cancelledBookingId = bookingId;
          return true;
        },
      }),
    );

    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error, 'service_unavailable');
    assert.equal(cancelledBookingId, 'test-booking-id');
  });

  it('deletes the orphan calendar event and cancels the booking when DB finalize fails', async () => {
    let deletedEventId: string | null = null;
    let cancelledBookingId: string | null = null;

    function makeTrackingProvider(): GenericCalendarProvider {
      return {
        ...makeProvider(),
        async deleteEvent(eventId: string) {
          deletedEventId = eventId;
          return { ok: true, provider: 'mock', eventId };
        },
      };
    }

    const result = await createGenericBooking(
      baseInput,
      serviceContext,
      baseDeps({
        resolveCalendarProvider: async () => makeTrackingProvider(),
        createCalendarEvent: async () => ({
          ok: true,
          provider: 'mock',
          eventId: 'evt_123',
        }),
        updateBookingCalendarSync: async () => false,
        cancelBookingById: async (bookingId) => {
          cancelledBookingId = bookingId;
          return true;
        },
      }),
    );

    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error, 'db_error');
    assert.equal(deletedEventId, 'evt_123');
    assert.equal(cancelledBookingId, 'test-booking-id');
  });

  it('returns invalid_slot when the duration does not match the service', async () => {
    const result = await createGenericBooking(
      { ...baseInput, slotEnd: '2025-09-01T11:00:00.000Z' },
      serviceContext,
      baseDeps(),
    );

    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error, 'invalid_slot');
  });
});
