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
} from '../createBooking';
import type { GenericBookingInput } from '../types';
import { validateBookingIntake } from '../../booking-intake/validateBookingIntake';
import { resolveIntakeOptions } from '../../booking-pricing/intakeOptionResolver';
import { calculateBookingQuote } from '../../booking-pricing/calculateBookingQuote';
import { PublicQuoteServiceError } from '../../booking-pricing/publicQuoteService';
import type { PublicQuoteResponse } from '../../booking-pricing/types';
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

const slotStart = '2025-09-01T10:00:00.000Z';
const slotEnd = '2025-09-01T11:15:00.000Z';

const baseInput: GenericBookingInput = {
  name: 'Teszt Elek',
  email: 'teszt@example.com',
  phone: '+36 30 123 4567',
  notes: 'Megjegyzés',
  slotStart,
  slotEnd,
  optionIds: [],
  intakeData: {},
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
    async resolveSiteEmailConfig() {
      return {
        id: 'cfg-1',
        siteId: 'site-1',
        displayName: 'Demo',
        notificationEmail: 'admin@example.com',
        replyToEmail: 'hello@example.com',
        siteUrl: 'https://demo.example.com',
        locale: 'hu',
        isActive: true,
      };
    },
    async resolveCalendarProvider() {
      return makeProvider();
    },
    async loadIntakeFields() {
      return [];
    },
    validateIntake: (raw) => {
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const data: import('../../booking-intake/types').BookingIntakeData = {};
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
          if (typeof value === 'string' || typeof value === 'number' || Array.isArray(value)) {
            data[key] = value as string | number | string[];
          }
        }
        return { data };
      }
      return { code: 'invalid_intake' as const };
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
    async calculateQuote(service) {
      return {
        priceMinMinor: service.basePriceMinor,
        priceMaxMinor: service.basePriceMinor,
        currency: service.currency,
        priceMode: service.pricingMode,
        durationMinMinutes: service.durationMinutes,
        durationMaxMinutes: service.maxDurationMinutes ?? service.durationMinutes,
        selectedOptions: [],
      };
    },
    async sendConfirmationEmails() {
      return { customer: true, admin: true };
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
    let createParams: Parameters<Required<CreateBookingDeps>['createCalendarEvent']>[1] | null = null;
    let syncedEventId: string | null = null;

    const result = await createGenericBooking(
      baseInput,
      [],
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
      [],
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

  it('does not create a booking when the tenant email config is missing', async () => {
    let insertCalled = false;
    let calendarCreated = false;
    const result = await createGenericBooking(
      baseInput,
      [],
      serviceContext,
      baseDeps({
        resolveSiteEmailConfig: async () => {
          throw new Error('email_unconfigured');
        },
        insertBooking: async () => {
          insertCalled = true;
          return {
            ok: true,
            booking: { id: 'should-not-happen', slot_start: slotStart, slot_end: slotEnd },
          };
        },
        createCalendarEvent: async () => {
          calendarCreated = true;
          return { ok: true, provider: 'mock', eventId: 'evt' };
        },
      }),
    );

    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error, 'service_unavailable');
    assert.equal(insertCalled, false);
    assert.equal(calendarCreated, false);
  });

  it('cancels the booking when calendar creation fails so the slot is unblocked', async () => {
    let cancelledBookingId: string | null = null;
    const result = await createGenericBooking(
      baseInput,
      [],
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
      [],
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
      [],
      serviceContext,
      baseDeps(),
    );

    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error, 'invalid_slot');
  });

  it('sends confirmation emails after a successful booking without rolling back on email failure', async () => {
    let emailCalled = false;
    const result = await createGenericBooking(
      baseInput,
      [],
      serviceContext,
      baseDeps({
        sendConfirmationEmails: async (params) => {
          emailCalled = true;
          assert.equal(params.bookingId, 'test-booking-id');
          assert.ok(typeof params.manageToken === 'string' && params.manageToken.length > 0);
          return { customer: false, admin: false };
        },
      }),
    );

    assert.equal(result.success, true);
    assert.equal(emailCalled, true);
  });

  it('does not send emails when the booking fails', async () => {
    let emailCalled = false;
    const result = await createGenericBooking(
      baseInput,
      [],
      serviceContext,
      baseDeps({
        insertBooking: async () => ({ ok: false, errorCode: '23P01' }),
        sendConfirmationEmails: async () => {
          emailCalled = true;
          return { customer: true, admin: true };
        },
      }),
    );

    assert.equal(result.success, false);
    assert.equal(emailCalled, false);
  });

  it('uses the server-side quote duration for slot validation and blocked range', async () => {
    const slotStart90 = '2025-09-01T10:00:00.000Z';
    const slotEnd90 = '2025-09-01T11:30:00.000Z';
    let insertParams: Parameters<Required<CreateBookingDeps>['insertBooking']>[0] | null = null;

    const result = await createGenericBooking(
      {
        ...baseInput,
        slotStart: slotStart90,
        slotEnd: slotEnd90,
        optionIds: ['11111111-1111-4111-9111-111111111111'],
      },
      ['11111111-1111-4111-9111-111111111111'],
      serviceContext,
      baseDeps({
        calculateQuote: async () => ({
          priceMinMinor: 15000,
          priceMaxMinor: 15000,
          currency: 'HUF',
          priceMode: 'estimated',
          durationMinMinutes: 90,
          durationMaxMinutes: 90,
          selectedOptions: [
            {
              id: '11111111-1111-4111-9111-111111111111',
              groupSlug: 'extras',
              optionSlug: 'deep-clean',
              label: 'Deep clean',
              priceDeltaMinor: 3000,
              priceDeltaMaxMinor: null,
              durationDeltaMinutes: 15,
              durationDeltaMaxMinutes: null,
            },
          ],
        }),
        insertBooking: async (params) => {
          insertParams = params;
          return {
            ok: true,
            booking: {
              id: 'test-booking-id',
              slot_start: params.input.slotStart,
              slot_end: params.input.slotEnd,
            },
          };
        },
      }),
    );

    assert.equal(result.success, true);
    assert.ok(insertParams);
    if (!insertParams) return;
    assert.equal(insertParams.input.slotEnd, slotEnd90);
    // 90 min slot + 15 min before + 15 min after => 2h blocked window.
    assert.equal(
      new Date(insertParams.blockedEnd).getTime() -
        new Date(insertParams.blockedStart).getTime(),
      2 * 60 * 60 * 1000,
    );
    assert.equal(insertParams.calculatedPriceMinor, 15000);
    assert.equal(insertParams.priceMode, 'estimated');
    assert.equal(insertParams.currency, 'HUF');
    assert.equal(insertParams.pricingSnapshot.durationMinMinutes, 90);
    assert.equal(insertParams.pricingSnapshot.durationMaxMinutes, 90);
    assert.equal(
      insertParams.pricingSnapshot.selectedOptions[0]?.id,
      '11111111-1111-4111-9111-111111111111',
    );
  });

  it('rejects a slot that does not match the server-side quote duration', async () => {
    const result = await createGenericBooking(
      baseInput,
      ['11111111-1111-4111-9111-111111111111'],
      serviceContext,
      baseDeps({
        calculateQuote: async () => ({
          priceMinMinor: 15000,
          priceMaxMinor: 15000,
          currency: 'HUF',
          priceMode: 'estimated',
          durationMinMinutes: 90,
          durationMaxMinutes: 90,
          selectedOptions: [],
        }),
      }),
    );

    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error, 'invalid_slot');
  });

  it('stores null scalar pricing fields when the quote price is null', async () => {
    let insertParams: Parameters<Required<CreateBookingDeps>['insertBooking']>[0] | null = null;

    const result = await createGenericBooking(
      {
        ...baseInput,
        slotStart: '2025-09-01T10:00:00.000Z',
        slotEnd: '2025-09-01T11:00:00.000Z',
      },
      [],
      serviceContext,
      baseDeps({
        calculateQuote: async () => ({
          priceMinMinor: null,
          priceMaxMinor: null,
          currency: 'HUF',
          priceMode: 'fixed',
          durationMinMinutes: 60,
          durationMaxMinutes: 60,
          selectedOptions: [],
        }),
        insertBooking: async (params) => {
          insertParams = params;
          return {
            ok: true,
            booking: {
              id: 'test-booking-id',
              slot_start: params.input.slotStart,
              slot_end: params.input.slotEnd,
            },
          };
        },
      }),
    );

    assert.equal(result.success, true);
    assert.ok(insertParams);
    if (!insertParams) return;
    assert.equal(insertParams.calculatedPriceMinor, null);
    assert.equal(insertParams.priceMode, null);
    assert.equal(insertParams.currency, null);
    assert.equal(insertParams.pricingSnapshot.priceMinMinor, null);
    assert.equal(insertParams.pricingSnapshot.priceMaxMinor, null);
    assert.equal(insertParams.pricingSnapshot.priceMode, 'fixed');
    assert.equal(insertParams.pricingSnapshot.currency, 'HUF');
  });

  it('returns invalid_intake when a required intake field is missing', async () => {
    let insertCalled = false;
    let calendarCreated = false;

    const result = await createGenericBooking(
      baseInput,
      [],
      serviceContext,
      baseDeps({
        loadIntakeFields: async () => [
          {
            id: 'breed-id',
            siteId: serviceContext.siteId,
            serviceId: serviceContext.serviceId,
            slug: 'dog-breed',
            label: 'Kutyafajta',
            fieldType: 'text',
            isRequired: true,
            minLength: 2,
            maxLength: 50,
            minValue: null,
            maxValue: null,
            minSelections: 0,
            maxSelections: 0,
            sortOrder: 0,
            isActive: true,
            options: [],
          },
        ],
        validateIntake: validateBookingIntake,
        insertBooking: async () => {
          insertCalled = true;
          return {
            ok: true,
            booking: {
              id: 'should-not-happen',
              slot_start: slotStart,
              slot_end: slotEnd,
            },
          };
        },
        createCalendarEvent: async () => {
          calendarCreated = true;
          return { ok: true, provider: 'mock', eventId: 'evt' };
        },
      }),
    );

    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error, 'invalid_intake');
    assert.equal(insertCalled, false);
    assert.equal(calendarCreated, false);
  });

  it('stores normalized intake data when validation succeeds', async () => {
    let insertParams: Parameters<Required<CreateBookingDeps>['insertBooking']>[0] | null = null;

    const result = await createGenericBooking(
      {
        ...baseInput,
        intakeData: {
          'dog-breed': '  Golden Retriever  ',
          'temperament-notes': '',
        },
      },
      [],
      serviceContext,
      baseDeps({
        loadIntakeFields: async () => [
          {
            id: 'breed-id',
            siteId: serviceContext.siteId,
            serviceId: serviceContext.serviceId,
            slug: 'dog-breed',
            label: 'Kutyafajta',
            fieldType: 'text',
            isRequired: true,
            minLength: 2,
            maxLength: 50,
            minValue: null,
            maxValue: null,
            minSelections: 0,
            maxSelections: 0,
            sortOrder: 0,
            isActive: true,
            options: [],
          },
          {
            id: 'notes-id',
            siteId: serviceContext.siteId,
            serviceId: serviceContext.serviceId,
            slug: 'temperament-notes',
            label: 'Temperamentum',
            fieldType: 'textarea',
            isRequired: false,
            minLength: 0,
            maxLength: 500,
            minValue: null,
            maxValue: null,
            minSelections: 0,
            maxSelections: 0,
            sortOrder: 1,
            isActive: true,
            options: [],
          },
        ],
        validateIntake: validateBookingIntake,
        insertBooking: async (params) => {
          insertParams = params;
          return {
            ok: true,
            booking: {
              id: 'test-booking-id',
              slot_start: params.input.slotStart,
              slot_end: params.input.slotEnd,
            },
          };
        },
      }),
    );

    assert.equal(result.success, true);
    assert.ok(insertParams);
    if (!insertParams) return;
    assert.deepEqual(insertParams.normalizedIntakeData, {
      'dog-breed': 'Golden Retriever',
    });
  });

  it('rejects unknown intake slugs at the domain layer even if the route accepted them', async () => {
    let insertCalled = false;

    const result = await createGenericBooking(
      {
        ...baseInput,
        intakeData: { 'dog-breed': 'Beagle', 'hacker-field': 'x' },
      },
      [],
      serviceContext,
      baseDeps({
        loadIntakeFields: async () => [
          {
            id: 'breed-id',
            siteId: serviceContext.siteId,
            serviceId: serviceContext.serviceId,
            slug: 'dog-breed',
            label: 'Kutyafajta',
            fieldType: 'text',
            isRequired: true,
            minLength: 2,
            maxLength: 50,
            minValue: null,
            maxValue: null,
            minSelections: 0,
            maxSelections: 0,
            sortOrder: 0,
            isActive: true,
            options: [],
          },
        ],
        validateIntake: validateBookingIntake,
        insertBooking: async () => {
          insertCalled = true;
          return {
            ok: true,
            booking: {
              id: 'should-not-happen',
              slot_start: slotStart,
              slot_end: slotEnd,
            },
          };
        },
      }),
    );

    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error, 'invalid_intake');
    assert.equal(insertCalled, false);
  });
});

describe('createGenericBooking intake-driven option selection', () => {
  const groomingService: BookingServiceContext = {
    siteId: '11111111-1111-1111-1111-111111111111',
    siteSlug: 'demo',
    siteName: 'Demo Grooming',
    timezone: 'Europe/Budapest',
    serviceId: 'g1111111-1111-1111-1111-111111111111',
    serviceSlug: 'full-grooming',
    serviceName: 'Full Grooming',
    scheduleId: '33333333-3333-3333-3333-333333333333',
    durationMinutes: 90,
    maxDurationMinutes: 120,
    slotIntervalMinutes: 15,
    minimumNoticeMinutes: 0,
    bookingWindowDays: 14,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    cancelCutoffHours: 12,
    rescheduleCutoffHours: 12,
    maxReschedules: 2,
    publicBookingEnabled: true,
    pricingMode: 'estimated',
    basePriceMinor: 14900,
    basePriceMaxMinor: 17900,
    currency: 'HUF',
  };

  const sizeGroup = {
    id: 'size-group',
    siteId: groomingService.siteId,
    serviceId: groomingService.serviceId,
    slug: 'dog-size',
    label: 'Méret',
    selectionMode: 'single' as const,
    isRequired: true,
    minSelections: 1,
    maxSelections: 1,
    sortOrder: 0,
    isActive: true,
  };

  const coatGroup = {
    id: 'coat-group',
    siteId: groomingService.siteId,
    serviceId: groomingService.serviceId,
    slug: 'coat-condition',
    label: 'Szőrzet állapota',
    selectionMode: 'single' as const,
    isRequired: true,
    minSelections: 1,
    maxSelections: 1,
    sortOrder: 1,
    isActive: true,
  };

  const desiredGroup = {
    id: 'desired-group',
    siteId: groomingService.siteId,
    serviceId: groomingService.serviceId,
    slug: 'desired-result',
    label: 'Kívánt eredmény',
    selectionMode: 'single' as const,
    isRequired: true,
    minSelections: 1,
    maxSelections: 1,
    sortOrder: 2,
    isActive: true,
  };

  const groups = [sizeGroup, coatGroup, desiredGroup];

  const options = [
    {
      id: 'small-opt',
      siteId: groomingService.siteId,
      serviceId: groomingService.serviceId,
      optionGroupId: sizeGroup.id,
      slug: 'small',
      label: 'Kistestű',
      priceDeltaMinor: 0,
      priceDeltaMaxMinor: 0,
      durationDeltaMinutes: 0,
      durationDeltaMaxMinutes: 0,
      sortOrder: 0,
      isActive: true,
    },
    {
      id: 'coat-maintained-opt',
      siteId: groomingService.siteId,
      serviceId: groomingService.serviceId,
      optionGroupId: coatGroup.id,
      slug: 'maintained',
      label: 'Rendszeresen ápolt',
      priceDeltaMinor: 0,
      priceDeltaMaxMinor: 0,
      durationDeltaMinutes: 0,
      durationDeltaMaxMinutes: 0,
      sortOrder: 0,
      isActive: true,
    },
    {
      id: 'desired-light-opt',
      siteId: groomingService.siteId,
      serviceId: groomingService.serviceId,
      optionGroupId: desiredGroup.id,
      slug: 'light-trim',
      label: 'Csak igazítás',
      priceDeltaMinor: 0,
      priceDeltaMaxMinor: 0,
      durationDeltaMinutes: 0,
      durationDeltaMaxMinutes: 0,
      sortOrder: 0,
      isActive: true,
    },
  ];

  const weightField = {
    id: 'weight-field',
    siteId: groomingService.siteId,
    serviceId: groomingService.serviceId,
    slug: 'dog-weight-kg',
    label: 'Testsúly',
    fieldType: 'number' as const,
    isRequired: false,
    minLength: 0,
    maxLength: 1,
    minValue: 1,
    maxValue: 100,
    minSelections: 0,
    maxSelections: 0,
    sortOrder: 0,
    isActive: true,
    options: [],
  };

  const ageField = {
    id: 'age-field',
    siteId: groomingService.siteId,
    serviceId: groomingService.serviceId,
    slug: 'dog-age-group',
    label: 'Életkor',
    fieldType: 'single_choice' as const,
    isRequired: true,
    minLength: 1,
    maxLength: 1,
    minValue: null,
    maxValue: null,
    minSelections: 1,
    maxSelections: 1,
    sortOrder: 1,
    isActive: true,
    options: [
      {
        id: 'adult-opt',
        siteId: groomingService.siteId,
        serviceId: groomingService.serviceId,
        intakeFieldId: 'age-field',
        slug: 'adult',
        label: 'Felnőtt',
        sortOrder: 0,
        isActive: true,
      },
    ],
  };

  const fields = [weightField, ageField];

  function makeGroomingInput(
    overrides: Partial<GenericBookingInput> = {},
  ): GenericBookingInput {
    return {
      name: 'Teszt Elek',
      email: 'teszt@example.com',
      phone: '+36 30 123 4567',
      notes: '',
      slotStart,
      slotEnd,
      optionIds: [],
      intakeData: {
        'dog-weight-kg': 5,
        'dog-age-group': 'adult',
      },
      locale: 'hu',
      ...overrides,
    };
  }

  async function calculateQuote(
    service: BookingServiceContext,
    optionIds: string[],
    intakeData: import('../../booking-intake/types').BookingIntakeData,
  ): Promise<PublicQuoteResponse> {
    const resolution = resolveIntakeOptions(
      optionIds,
      intakeData,
      fields,
      groups,
      options,
    );
    if ('error' in resolution) {
      throw new PublicQuoteServiceError(
        resolution.error,
        'Invalid intake/option selection',
      );
    }

    try {
      const quote = calculateBookingQuote({
        service,
        groups,
        options,
        selectedOptionIds: resolution.optionIds,
        mode: 'complete',
      });
      return {
        ...quote,
        selectedOptions: quote.selectedOptions.map((selected) => ({
          id: selected.optionId,
          groupSlug: selected.groupSlug,
          optionSlug: selected.optionSlug,
          label: selected.label,
          priceDeltaMinor: selected.priceDeltaMinor,
          priceDeltaMaxMinor: selected.priceDeltaMaxMinor,
          durationDeltaMinutes: selected.durationDeltaMinutes,
          durationDeltaMaxMinutes: selected.durationDeltaMaxMinutes,
        })),
      };
    } catch (err) {
      if (err instanceof PublicQuoteServiceError) {
        throw err;
      }
      throw new PublicQuoteServiceError(
        'invalid_selection',
        err instanceof Error ? err.message : 'Invalid option selection',
      );
    }
  }

  it('rejects final booking when coat-condition is missing', async () => {
    let insertCalled = false;
    const result = await createGenericBooking(
      makeGroomingInput({
        slotEnd: '2025-09-01T11:30:00.000Z',
      }),
      [],
      groomingService,
      baseDeps({
        loadIntakeFields: async () => fields,
        validateIntake: validateBookingIntake,
        calculateQuote,
        insertBooking: async () => {
          insertCalled = true;
          return {
            ok: true,
            booking: {
              id: 'should-not-happen',
              slot_start: slotStart,
              slot_end: slotEnd,
            },
          };
        },
      }),
    );

    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error, 'invalid_selection');
    assert.equal(insertCalled, false);
  });

  it('rejects final booking when desired-result is missing', async () => {
    let insertCalled = false;
    const result = await createGenericBooking(
      makeGroomingInput({
        optionIds: ['coat-maintained-opt'],
        slotEnd: '2025-09-01T11:30:00.000Z',
      }),
      ['coat-maintained-opt'],
      groomingService,
      baseDeps({
        loadIntakeFields: async () => fields,
        validateIntake: validateBookingIntake,
        calculateQuote,
        insertBooking: async () => {
          insertCalled = true;
          return {
            ok: true,
            booking: {
              id: 'should-not-happen',
              slot_start: slotStart,
              slot_end: slotEnd,
            },
          };
        },
      }),
    );

    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error, 'invalid_selection');
    assert.equal(insertCalled, false);
  });

  it('creates booking with complete selection and stores weight-derived size in snapshot', async () => {
    let insertParams: Parameters<Required<CreateBookingDeps>['insertBooking']>[0] | null = null;

    const result = await createGenericBooking(
      makeGroomingInput({
        optionIds: ['coat-maintained-opt', 'desired-light-opt'],
        slotEnd: '2025-09-01T12:00:00.000Z',
      }),
      ['coat-maintained-opt', 'desired-light-opt'],
      groomingService,
      baseDeps({
        loadIntakeFields: async () => fields,
        validateIntake: validateBookingIntake,
        calculateQuote,
        insertBooking: async (params) => {
          insertParams = params;
          return {
            ok: true,
            booking: {
              id: 'test-booking-id',
              slot_start: params.input.slotStart,
              slot_end: params.input.slotEnd,
            },
          };
        },
      }),
    );

    assert.equal(result.success, true);
    assert.ok(insertParams);
    if (!insertParams) return;
    const captured = insertParams as unknown as Parameters<
      Required<CreateBookingDeps>['insertBooking']
    >[0];
    assert.equal(captured.normalizedIntakeData['dog-weight-kg'], 5);
    assert.equal(captured.normalizedIntakeData['dog-age-group'], 'adult');
    assert.ok(
      Array.isArray(captured.pricingSnapshot.selectedOptions) &&
        captured.pricingSnapshot.selectedOptions.some(
          (o: unknown) =>
            typeof o === 'object' &&
            o !== null &&
            (o as { optionSlug?: string }).optionSlug === 'small',
        ),
    );
  });
});
