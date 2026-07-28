// ============================================================
// Booking quote calculator — unit tests
//
// Pure domain tests; no database, calendar, or email dependencies.
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateBookingQuote,
} from '../calculateBookingQuote';
import { BookingPricingError } from '../types';
import type {
  BookingServiceContext,
  BookingServiceOptionGroup,
  BookingServiceOption,
} from '../types';

const baseService: BookingServiceContext = {
  siteId: '11111111-1111-1111-1111-111111111111',
  siteSlug: 'demo',
  siteName: 'Demo Site',
  timezone: 'Europe/Budapest',
  serviceId: '22222222-2222-2222-2222-222222222222',
  serviceSlug: 'grooming',
  serviceName: 'Grooming',
  scheduleId: '33333333-3333-3333-3333-333333333333',
  durationMinutes: 60,
  slotIntervalMinutes: 15,
  minimumNoticeMinutes: 0,
  bookingWindowDays: 14,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  cancelCutoffHours: 12,
  rescheduleCutoffHours: 12,
  maxReschedules: 2,
  publicBookingEnabled: true,
  pricingMode: 'fixed',
  basePriceMinor: 1000,
  currency: 'HUF',
};

function makeGroup(
  overrides: Partial<BookingServiceOptionGroup> & { id: string; slug: string },
): BookingServiceOptionGroup {
  return {
    siteId: baseService.siteId,
    serviceId: baseService.serviceId,
    label: overrides.slug ?? overrides.id,
    selectionMode: 'single',
    isRequired: false,
    minSelections: 0,
    maxSelections: 1,
    sortOrder: 0,
    isActive: true,
    ...overrides,
  };
}

function makeOption(
  overrides: Partial<BookingServiceOption> & { id: string; slug: string; optionGroupId: string },
): BookingServiceOption {
  return {
    siteId: baseService.siteId,
    serviceId: baseService.serviceId,
    label: overrides.slug ?? overrides.id,
    priceDeltaMinor: 0,
    durationDeltaMinutes: 0,
    sortOrder: 0,
    isActive: true,
    ...overrides,
  };
}

describe('calculateBookingQuote', () => {
  it('returns fixed base price with no options', () => {
    const quote = calculateBookingQuote({
      service: baseService,
      groups: [],
      options: [],
      selectedOptionIds: [],
    });

    assert.equal(quote.priceMode, 'fixed');
    assert.equal(quote.currency, 'HUF');
    assert.equal(quote.priceMinor, 1000);
    assert.equal(quote.durationMinutes, 60);
    assert.deepEqual(quote.selectedOptions, []);
  });

  it('returns estimated price with options', () => {
    const group = makeGroup({
      id: 'g1',
      slug: 'size',
      selectionMode: 'single',
      isRequired: true,
      minSelections: 1,
    });
    const option = makeOption({
      id: 'o1',
      slug: 'medium',
      optionGroupId: 'g1',
      priceDeltaMinor: 3000,
      durationDeltaMinutes: 30,
    });

    const quote = calculateBookingQuote({
      service: { ...baseService, pricingMode: 'estimated', basePriceMinor: 14900 },
      groups: [group],
      options: [option],
      selectedOptionIds: ['o1'],
    });

    assert.equal(quote.priceMode, 'estimated');
    assert.equal(quote.priceMinor, 17900);
    assert.equal(quote.durationMinutes, 90);
  });

  it('adds price and duration deltas from multiple options', () => {
    const g1 = makeGroup({
      id: 'g1',
      slug: 'size',
      selectionMode: 'single',
      isRequired: true,
      minSelections: 1,
    });
    const g2 = makeGroup({
      id: 'g2',
      slug: 'coat',
      selectionMode: 'single',
      isRequired: true,
      minSelections: 1,
    });
    const o1 = makeOption({
      id: 'o1',
      slug: 'medium',
      optionGroupId: 'g1',
      priceDeltaMinor: 3000,
      durationDeltaMinutes: 30,
    });
    const o2 = makeOption({
      id: 'o2',
      slug: 'long',
      optionGroupId: 'g2',
      priceDeltaMinor: 2000,
      durationDeltaMinutes: 30,
    });

    const quote = calculateBookingQuote({
      service: { ...baseService, pricingMode: 'estimated', basePriceMinor: 14900 },
      groups: [g1, g2],
      options: [o1, o2],
      selectedOptionIds: ['o1', 'o2'],
    });

    assert.equal(quote.priceMinor, 19900);
    assert.equal(quote.durationMinutes, 120);
  });

  it('returns null price when basePriceMinor is null', () => {
    const group = makeGroup({
      id: 'g1',
      slug: 'size',
      selectionMode: 'single',
    });
    const option = makeOption({
      id: 'o1',
      slug: 'medium',
      optionGroupId: 'g1',
      priceDeltaMinor: 3000,
      durationDeltaMinutes: 30,
    });

    const quote = calculateBookingQuote({
      service: { ...baseService, basePriceMinor: null },
      groups: [group],
      options: [option],
      selectedOptionIds: ['o1'],
    });

    assert.equal(quote.priceMinor, null);
    assert.equal(quote.durationMinutes, 90);
  });

  it('rejects a required single group with no selection', () => {
    const group = makeGroup({
      id: 'g1',
      slug: 'size',
      selectionMode: 'single',
      isRequired: true,
      minSelections: 1,
    });

    assert.throws(
      () => calculateBookingQuote({
        service: baseService,
        groups: [group],
        options: [],
        selectedOptionIds: [],
      }),
      (err: unknown) =>
        err instanceof BookingPricingError &&
        err.code === 'required_group_not_met',
    );
  });

  it('accepts an optional single group with no selection', () => {
    const group = makeGroup({
      id: 'g1',
      slug: 'size',
      selectionMode: 'single',
      isRequired: false,
      minSelections: 0,
    });

    const quote = calculateBookingQuote({
      service: baseService,
      groups: [group],
      options: [],
      selectedOptionIds: [],
    });

    assert.equal(quote.priceMinor, 1000);
    assert.equal(quote.durationMinutes, 60);
    assert.equal(quote.selectedOptions.length, 0);
  });

  it('enforces multiple group min and max selections', () => {
    const group = makeGroup({
      id: 'g1',
      slug: 'extras',
      selectionMode: 'multiple',
      isRequired: true,
      minSelections: 1,
      maxSelections: 2,
    });
    const o1 = makeOption({ id: 'o1', slug: 'nail', optionGroupId: 'g1' });
    const o2 = makeOption({ id: 'o2', slug: 'ear', optionGroupId: 'g1' });
    const o3 = makeOption({ id: 'o3', slug: 'teeth', optionGroupId: 'g1' });

    assert.throws(
      () => calculateBookingQuote({
        service: baseService,
        groups: [group],
        options: [o1, o2, o3],
        selectedOptionIds: [],
      }),
      (err: unknown) =>
        err instanceof BookingPricingError &&
        err.code === 'min_selections_not_met',
    );

    assert.throws(
      () => calculateBookingQuote({
        service: baseService,
        groups: [group],
        options: [o1, o2, o3],
        selectedOptionIds: ['o1', 'o2', 'o3'],
      }),
      (err: unknown) =>
        err instanceof BookingPricingError &&
        err.code === 'max_selections_exceeded',
    );

    const quote = calculateBookingQuote({
      service: baseService,
      groups: [group],
      options: [o1, o2, o3],
      selectedOptionIds: ['o1', 'o2'],
    });
    assert.equal(quote.selectedOptions.length, 2);
  });

  it('rejects duplicate option IDs', () => {
    const group = makeGroup({
      id: 'g1',
      slug: 'extras',
      selectionMode: 'multiple',
      maxSelections: 2,
    });
    const option = makeOption({ id: 'o1', slug: 'nail', optionGroupId: 'g1' });

    assert.throws(
      () => calculateBookingQuote({
        service: baseService,
        groups: [group],
        options: [option],
        selectedOptionIds: ['o1', 'o1'],
      }),
      (err: unknown) =>
        err instanceof BookingPricingError &&
        err.code === 'duplicate_option_id',
    );
  });

  it('rejects unknown option IDs', () => {
    assert.throws(
      () => calculateBookingQuote({
        service: baseService,
        groups: [],
        options: [],
        selectedOptionIds: ['missing'],
      }),
      (err: unknown) =>
        err instanceof BookingPricingError &&
        err.code === 'unknown_option_id',
    );
  });

  it('rejects options belonging to another service or site', () => {
    const option = makeOption({
      id: 'o1',
      slug: 'other',
      optionGroupId: 'g1',
      siteId: '99999999-9999-9999-9999-999999999999',
      serviceId: '88888888-8888-8888-8888-888888888888',
    });

    assert.throws(
      () => calculateBookingQuote({
        service: baseService,
        groups: [],
        options: [option],
        selectedOptionIds: ['o1'],
      }),
      (err: unknown) =>
        err instanceof BookingPricingError &&
        err.code === 'option_service_mismatch',
    );
  });

  it('rejects inactive groups', () => {
    const group = makeGroup({
      id: 'g1',
      slug: 'size',
      isActive: false,
    });
    const option = makeOption({ id: 'o1', slug: 'medium', optionGroupId: 'g1' });

    assert.throws(
      () => calculateBookingQuote({
        service: baseService,
        groups: [group],
        options: [option],
        selectedOptionIds: ['o1'],
      }),
      (err: unknown) =>
        err instanceof BookingPricingError &&
        err.code === 'inactive_group',
    );
  });

  it('rejects inactive options', () => {
    const group = makeGroup({ id: 'g1', slug: 'size' });
    const option = makeOption({
      id: 'o1',
      slug: 'medium',
      optionGroupId: 'g1',
      isActive: false,
    });

    assert.throws(
      () => calculateBookingQuote({
        service: baseService,
        groups: [group],
        options: [option],
        selectedOptionIds: ['o1'],
      }),
      (err: unknown) =>
        err instanceof BookingPricingError &&
        err.code === 'inactive_option',
    );
  });

  it('rejects a negative final price', () => {
    const group = makeGroup({ id: 'g1', slug: 'discount' });
    const option = makeOption({
      id: 'o1',
      slug: 'large-discount',
      optionGroupId: 'g1',
      priceDeltaMinor: -2000,
    });

    assert.throws(
      () => calculateBookingQuote({
        service: baseService,
        groups: [group],
        options: [option],
        selectedOptionIds: ['o1'],
      }),
      (err: unknown) =>
        err instanceof BookingPricingError &&
        err.code === 'negative_price',
    );
  });

  it('rejects unsafe integer prices', () => {
    const group = makeGroup({ id: 'g1', slug: 'size' });
    const option = makeOption({
      id: 'o1',
      slug: 'premium',
      optionGroupId: 'g1',
      priceDeltaMinor: 1,
    });

    assert.throws(
      () => calculateBookingQuote({
        service: {
          ...baseService,
          basePriceMinor: Number.MAX_SAFE_INTEGER,
        },
        groups: [group],
        options: [option],
        selectedOptionIds: ['o1'],
      }),
      (err: unknown) =>
        err instanceof BookingPricingError &&
        err.code === 'price_overflow',
    );
  });

  it('rejects an invalid final duration', () => {
    const group = makeGroup({ id: 'g1', slug: 'duration' });
    const option = makeOption({
      id: 'o1',
      slug: 'subtract-all',
      optionGroupId: 'g1',
      durationDeltaMinutes: -60,
    });

    assert.throws(
      () => calculateBookingQuote({
        service: baseService,
        groups: [group],
        options: [option],
        selectedOptionIds: ['o1'],
      }),
      (err: unknown) =>
        err instanceof BookingPricingError &&
        err.code === 'invalid_calculated_duration',
    );
  });

  it('returns deterministic selectedOptions order', () => {
    const g1 = makeGroup({
      id: 'g1',
      slug: 'first',
      sortOrder: 1,
      selectionMode: 'multiple',
      maxSelections: 2,
    });
    const g2 = makeGroup({ id: 'g2', slug: 'second', sortOrder: 2 });
    const o1 = makeOption({
      id: 'o1',
      slug: 'b',
      optionGroupId: 'g1',
      sortOrder: 2,
    });
    const o2 = makeOption({
      id: 'o2',
      slug: 'a',
      optionGroupId: 'g1',
      sortOrder: 1,
    });
    const o3 = makeOption({
      id: 'o3',
      slug: 'only',
      optionGroupId: 'g2',
      sortOrder: 1,
    });

    const quote = calculateBookingQuote({
      service: baseService,
      groups: [g2, g1],
      options: [o1, o3, o2],
      selectedOptionIds: ['o1', 'o2', 'o3'],
    });

    const ids = quote.selectedOptions.map((o) => o.optionId);
    assert.deepEqual(ids, ['o2', 'o1', 'o3']);
  });

  it('works with zero option groups for a legacy service', () => {
    const quote = calculateBookingQuote({
      service: { ...baseService, pricingMode: 'fixed', basePriceMinor: null },
      groups: [],
      options: [],
      selectedOptionIds: [],
    });

    assert.equal(quote.priceMode, 'fixed');
    assert.equal(quote.priceMinor, null);
    assert.equal(quote.durationMinutes, 60);
    assert.deepEqual(quote.selectedOptions, []);
  });
});
