// ============================================================
// Public quote/config service — unit tests
//
// Tests the shared application layer without a live database.
// Dependencies are injected so the calculator can be exercised
// deterministically.
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPublicPricingConfig,
  getPublicQuote,
  PublicQuoteServiceError,
} from '../publicQuoteService';
import type { BookingServiceContext } from '../../booking-service/types';
import type {
  BookingServiceOption,
  BookingServiceOptionGroup,
} from '../types';

const baseService: BookingServiceContext = {
  siteId: '11111111-1111-1111-1111-111111111111',
  siteSlug: 'demo',
  siteName: 'Demo Site',
  timezone: 'Europe/Budapest',
  serviceId: '22222222-2222-2222-2222-222222222222',
  serviceSlug: 'grooming',
  serviceName: 'Dog Grooming',
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
  basePriceMinor: 12000,
  currency: 'HUF',
};

function makeGroup(
  overrides: Partial<BookingServiceOptionGroup> & { id: string; slug: string },
): BookingServiceOptionGroup {
  return {
    siteId: baseService.siteId,
    serviceId: baseService.serviceId,
    label: overrides.slug,
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
  overrides: Partial<BookingServiceOption> & {
    id: string;
    slug: string;
    optionGroupId: string;
  },
): BookingServiceOption {
  return {
    siteId: baseService.siteId,
    serviceId: baseService.serviceId,
    label: overrides.slug,
    priceDeltaMinor: 0,
    durationDeltaMinutes: 0,
    sortOrder: 0,
    isActive: true,
    ...overrides,
  };
}

function makeDeps(
  service: BookingServiceContext,
  groups: BookingServiceOptionGroup[],
  options: BookingServiceOption[],
) {
  return {
    loadServiceContext: async () => service,
    loadOptions: async () => ({ groups, options }),
  };
}

describe('getPublicPricingConfig', () => {
  it('returns fixed price service with no option groups', async () => {
    const config = await getPublicPricingConfig(
      'demo',
      'grooming',
      makeDeps(baseService, [], []),
    );

    assert.equal(config.service.pricingMode, 'fixed');
    assert.equal(config.service.basePriceMinor, 12000);
    assert.equal(config.service.currency, 'HUF');
    assert.equal(config.service.baseDurationMinutes, 60);
    assert.deepEqual(config.optionGroups, []);
  });

  it('does not expose internal site or service IDs', async () => {
    const config = await getPublicPricingConfig(
      'demo',
      'grooming',
      makeDeps(baseService, [], []),
    );

    const serviceKeys = Object.keys(config.service);
    assert.ok(!serviceKeys.includes('siteId'));
    assert.ok(!serviceKeys.includes('serviceId'));
    assert.ok(!serviceKeys.includes('scheduleId'));
    assert.ok(serviceKeys.includes('slug'));
    assert.ok(serviceKeys.includes('name'));
    assert.ok(serviceKeys.includes('pricingMode'));
    assert.ok(serviceKeys.includes('basePriceMinor'));
    assert.ok(serviceKeys.includes('currency'));
    assert.ok(serviceKeys.includes('baseDurationMinutes'));
  });

  it('excludes inactive groups and options', async () => {
    const group = makeGroup({ id: 'g1', slug: 'size' });
    const activeOption = makeOption({
      id: '11111111-1111-4111-9111-111111111111',
      slug: 'small',
      optionGroupId: 'g1',
    });
    const inactiveOption = makeOption({
      id: '22222222-2222-4222-a222-222222222222',
      slug: 'large',
      optionGroupId: 'g1',
      isActive: false,
    });

    const config = await getPublicPricingConfig(
      'demo',
      'grooming',
      makeDeps(baseService, [group], [activeOption, inactiveOption]),
    );

    assert.equal(config.optionGroups.length, 1);
    assert.equal(config.optionGroups[0]?.options.length, 1);
    assert.equal(config.optionGroups[0]?.options[0]?.id, '11111111-1111-4111-9111-111111111111');
  });

  it('returns stable group and option sort order', async () => {
    const g1 = makeGroup({ id: 'g1', slug: 'first', sortOrder: 2 });
    const g2 = makeGroup({ id: 'g2', slug: 'second', sortOrder: 1 });
    const o1 = makeOption({
      id: '11111111-1111-4111-9111-111111111111',
      slug: 'b',
      optionGroupId: 'g2',
      sortOrder: 2,
    });
    const o2 = makeOption({
      id: '22222222-2222-4222-a222-222222222222',
      slug: 'a',
      optionGroupId: 'g2',
      sortOrder: 1,
    });
    const o3 = makeOption({
      id: '33333333-3333-4333-a333-333333333333',
      slug: 'only',
      optionGroupId: 'g1',
      sortOrder: 1,
    });

    const config = await getPublicPricingConfig(
      'demo',
      'grooming',
      makeDeps(baseService, [g1, g2], [o1, o2, o3]),
    );

    const groupSlugs = config.optionGroups.map((g) => g.slug);
    assert.deepEqual(groupSlugs, ['second', 'first']);

    const optionIds = config.optionGroups[0]?.options.map((o) => o.id);
    assert.deepEqual(optionIds, ['22222222-2222-4222-a222-222222222222', '11111111-1111-4111-9111-111111111111']);
  });

  it('rejects non-public services', async () => {
    await assert.rejects(
      () =>
        getPublicPricingConfig(
          'demo',
          'grooming',
          makeDeps(
            { ...baseService, publicBookingEnabled: false },
            [],
            [],
          ),
        ),
      (err: unknown) =>
        err instanceof PublicQuoteServiceError &&
        err.code === 'service_unavailable',
    );
  });
});

describe('getPublicQuote', () => {
  it('returns fixed price with no options', async () => {
    const quote = await getPublicQuote(
      'demo',
      'grooming',
      [],
      makeDeps(baseService, [], []),
    );

    assert.equal(quote.priceMode, 'fixed');
    assert.equal(quote.priceMinor, 12000);
    assert.equal(quote.currency, 'HUF');
    assert.equal(quote.durationMinutes, 60);
    assert.deepEqual(quote.selectedOptions, []);
  });

  it('returns estimated price with options', async () => {
    const group = makeGroup({
      id: 'g1',
      slug: 'size',
      selectionMode: 'single',
      isRequired: true,
      minSelections: 1,
    });
    const option = makeOption({
      id: '11111111-1111-4111-9111-111111111111',
      slug: 'medium',
      optionGroupId: 'g1',
      priceDeltaMinor: 3000,
      durationDeltaMinutes: 15,
    });

    const quote = await getPublicQuote(
      'demo',
      'grooming',
      ['11111111-1111-4111-9111-111111111111'],
      makeDeps(
        { ...baseService, pricingMode: 'estimated', basePriceMinor: 14900 },
        [group],
        [option],
      ),
    );

    assert.equal(quote.priceMode, 'estimated');
    assert.equal(quote.priceMinor, 17900);
    assert.equal(quote.durationMinutes, 75);
  });

  it('calculates 60 to 75 minutes via duration delta', async () => {
    const group = makeGroup({
      id: 'g1',
      slug: 'extras',
      selectionMode: 'single',
      isRequired: true,
      minSelections: 1,
    });
    const option = makeOption({
      id: '11111111-1111-4111-9111-111111111111',
      slug: 'deep-clean',
      optionGroupId: 'g1',
      priceDeltaMinor: 2500,
      durationDeltaMinutes: 15,
    });

    const quote = await getPublicQuote(
      'demo',
      'grooming',
      ['11111111-1111-4111-9111-111111111111'],
      makeDeps(baseService, [group], [option]),
    );

    assert.equal(quote.priceMinor, 14500);
    assert.equal(quote.durationMinutes, 75);
  });

  it('returns null price when basePriceMinor is null', async () => {
    const group = makeGroup({
      id: 'g1',
      slug: 'size',
      selectionMode: 'single',
    });
    const option = makeOption({
      id: '11111111-1111-4111-9111-111111111111',
      slug: 'medium',
      optionGroupId: 'g1',
      priceDeltaMinor: 3000,
      durationDeltaMinutes: 15,
    });

    const quote = await getPublicQuote(
      'demo',
      'grooming',
      ['11111111-1111-4111-9111-111111111111'],
      makeDeps(
        { ...baseService, basePriceMinor: null },
        [group],
        [option],
      ),
    );

    assert.equal(quote.priceMinor, null);
    assert.equal(quote.currency, 'HUF');
    assert.equal(quote.priceMode, 'fixed');
    assert.equal(quote.durationMinutes, 75);
  });

  it('rejects missing required group selection', async () => {
    const group = makeGroup({
      id: 'g1',
      slug: 'size',
      selectionMode: 'single',
      isRequired: true,
      minSelections: 1,
    });

    await assert.rejects(
      () =>
        getPublicQuote(
          'demo',
          'grooming',
          [],
          makeDeps(baseService, [group], []),
        ),
      (err: unknown) =>
        err instanceof PublicQuoteServiceError &&
        err.code === 'invalid_selection',
    );
  });

  it('enforces multiple group min and max', async () => {
    const group = makeGroup({
      id: 'g1',
      slug: 'extras',
      selectionMode: 'multiple',
      isRequired: true,
      minSelections: 1,
      maxSelections: 2,
    });
    const o1 = makeOption({ id: '11111111-1111-4111-9111-111111111111', slug: 'nail', optionGroupId: 'g1' });
    const o2 = makeOption({ id: '22222222-2222-4222-a222-222222222222', slug: 'ear', optionGroupId: 'g1' });
    const o3 = makeOption({ id: '33333333-3333-4333-a333-333333333333', slug: 'teeth', optionGroupId: 'g1' });

    await assert.rejects(
      () =>
        getPublicQuote(
          'demo',
          'grooming',
          [],
          makeDeps(baseService, [group], [o1, o2, o3]),
        ),
      (err: unknown) =>
        err instanceof PublicQuoteServiceError &&
        err.code === 'invalid_selection',
    );

    await assert.rejects(
      () =>
        getPublicQuote(
          'demo',
          'grooming',
          ['11111111-1111-4111-9111-111111111111', '22222222-2222-4222-a222-222222222222', '33333333-3333-4333-a333-333333333333'],
          makeDeps(baseService, [group], [o1, o2, o3]),
        ),
      (err: unknown) =>
        err instanceof PublicQuoteServiceError &&
        err.code === 'invalid_selection',
    );

    const quote = await getPublicQuote(
      'demo',
      'grooming',
      ['11111111-1111-4111-9111-111111111111', '22222222-2222-4222-a222-222222222222'],
      makeDeps(baseService, [group], [o1, o2, o3]),
    );
    assert.equal(quote.selectedOptions.length, 2);
  });

  it('rejects duplicate option IDs', async () => {
    const group = makeGroup({
      id: 'g1',
      slug: 'extras',
      selectionMode: 'multiple',
      maxSelections: 2,
    });
    const option = makeOption({
      id: '11111111-1111-4111-9111-111111111111',
      slug: 'nail',
      optionGroupId: 'g1',
    });

    await assert.rejects(
      () =>
        getPublicQuote(
          'demo',
          'grooming',
          ['11111111-1111-4111-9111-111111111111', '11111111-1111-4111-9111-111111111111'],
          makeDeps(baseService, [group], [option]),
        ),
      (err: unknown) =>
        err instanceof PublicQuoteServiceError &&
        err.code === 'invalid_selection',
    );
  });

  it('rejects options from another tenant or service', async () => {
    const group = makeGroup({ id: 'g1', slug: 'size' });
    const option = makeOption({
      id: '11111111-1111-4111-9111-111111111111',
      slug: 'other',
      optionGroupId: 'g1',
      siteId: '99999999-9999-9999-9999-999999999999',
      serviceId: '88888888-8888-8888-8888-888888888888',
    });

    await assert.rejects(
      () =>
        getPublicQuote(
          'demo',
          'grooming',
          ['11111111-1111-4111-9111-111111111111'],
          makeDeps(baseService, [group], [option]),
        ),
      (err: unknown) =>
        err instanceof PublicQuoteServiceError &&
        err.code === 'invalid_selection',
    );
  });

  it('rejects selecting an inactive option', async () => {
    const group = makeGroup({ id: 'g1', slug: 'size' });
    const option = makeOption({
      id: '11111111-1111-4111-9111-111111111111',
      slug: 'inactive',
      optionGroupId: 'g1',
      isActive: false,
    });

    await assert.rejects(
      () =>
        getPublicQuote(
          'demo',
          'grooming',
          ['11111111-1111-4111-9111-111111111111'],
          makeDeps(baseService, [group], [option]),
        ),
      (err: unknown) =>
        err instanceof PublicQuoteServiceError &&
        err.code === 'invalid_selection',
    );
  });

  it('maps service_unavailable for non-public service', async () => {
    await assert.rejects(
      () =>
        getPublicQuote(
          'demo',
          'grooming',
          [],
          makeDeps(
            { ...baseService, publicBookingEnabled: false },
            [],
            [],
          ),
        ),
      (err: unknown) =>
        err instanceof PublicQuoteServiceError &&
        err.code === 'service_unavailable',
    );
  });

  it('rejects invalid optionIds input types', async () => {
    await assert.rejects(
      () =>
        getPublicQuote(
          'demo',
          'grooming',
          'not-an-array',
          makeDeps(baseService, [], []),
        ),
      (err: unknown) =>
        err instanceof PublicQuoteServiceError &&
        err.code === 'invalid_request',
    );

    await assert.rejects(
      () =>
        getPublicQuote(
          'demo',
          'grooming',
          ['not-a-uuid'],
          makeDeps(baseService, [], []),
        ),
      (err: unknown) =>
        err instanceof PublicQuoteServiceError &&
        err.code === 'invalid_request',
    );
  });
});
