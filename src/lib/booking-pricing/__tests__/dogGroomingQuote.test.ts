// ============================================================
// Dog Grooming quote fixture tests
//
// Pure-domain tests based on the approved demo seed values in
// supabase/migrations/018_dog_grooming_booking_config.sql.
// No database, calendar, or email dependencies.
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateBookingQuote } from '../calculateBookingQuote';
import { BookingPricingError } from '../types';
import type { BookingServiceContext } from '../../booking-service/types';
import type {
  BookingServiceOptionGroup,
  BookingServiceOption,
} from '../types';

const BUNDAS_SITE_ID = 'd1111111-1111-1111-1111-111111111111';
const BUNDAS_SCHEDULE_ID = 'd2222222-2222-2222-2222-222222222222';

const COMMON_SERVICE_FIELDS: Omit<
  BookingServiceContext,
  'serviceId' | 'serviceSlug' | 'serviceName' | 'durationMinutes' | 'maxDurationMinutes' | 'pricingMode' | 'basePriceMinor' | 'basePriceMaxMinor'
> = {
  siteId: BUNDAS_SITE_ID,
  siteSlug: 'bundas-demo',
  siteName: 'Bundás Kutyakozmetika',
  timezone: 'Europe/Budapest',
  scheduleId: BUNDAS_SCHEDULE_ID,
  slotIntervalMinutes: 15,
  minimumNoticeMinutes: 720,
  bookingWindowDays: 60,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  cancelCutoffHours: 12,
  rescheduleCutoffHours: 12,
  maxReschedules: 2,
  publicBookingEnabled: false,
  currency: 'HUF',
};

function makeService(
  overrides: Pick<
    BookingServiceContext,
    | 'serviceId'
    | 'serviceSlug'
    | 'serviceName'
    | 'durationMinutes'
    | 'maxDurationMinutes'
    | 'pricingMode'
    | 'basePriceMinor'
    | 'basePriceMaxMinor'
  >,
): BookingServiceContext {
  return {
    ...COMMON_SERVICE_FIELDS,
    ...overrides,
  };
}

function makeGroup(
  overrides: Partial<BookingServiceOptionGroup> &
    Pick<BookingServiceOptionGroup, 'id' | 'slug' | 'serviceId'>,
): BookingServiceOptionGroup {
  return {
    siteId: BUNDAS_SITE_ID,
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
  overrides: Partial<BookingServiceOption> &
    Pick<BookingServiceOption, 'id' | 'slug' | 'optionGroupId' | 'serviceId'>,
): BookingServiceOption {
  return {
    siteId: BUNDAS_SITE_ID,
    label: overrides.slug,
    priceDeltaMinor: 0,
    priceDeltaMaxMinor: null,
    durationDeltaMinutes: 0,
    durationDeltaMaxMinutes: null,
    sortOrder: 0,
    isActive: true,
    ...overrides,
  };
}

const FULL_SERVICE = makeService({
  serviceId: 'd3333333-3333-3333-3333-333333333333',
  serviceSlug: 'full-grooming',
  serviceName: 'Teljes kozmetika',
  durationMinutes: 60,
  maxDurationMinutes: 90,
  pricingMode: 'estimated',
  basePriceMinor: 11900,
  basePriceMaxMinor: 14900,
});

const BATH_SERVICE = makeService({
  serviceId: 'd4444444-4444-4444-4444-444444444444',
  serviceSlug: 'bath-and-brush',
  serviceName: 'Fürdetés és kefélés',
  durationMinutes: 45,
  maxDurationMinutes: 60,
  pricingMode: 'estimated',
  basePriceMinor: 7900,
  basePriceMaxMinor: 9900,
});

const NAIL_SERVICE = makeService({
  serviceId: 'd5555555-5555-5555-5555-555555555555',
  serviceSlug: 'nail-trimming',
  serviceName: 'Karomvágás',
  durationMinutes: 15,
  maxDurationMinutes: 15,
  pricingMode: 'fixed',
  basePriceMinor: 3500,
  basePriceMaxMinor: 3500,
});

const PUPPY_SERVICE = makeService({
  serviceId: 'd6666666-6666-6666-6666-666666666666',
  serviceSlug: 'puppy-first-groom',
  serviceName: 'Első kölyökkozmetika',
  durationMinutes: 45,
  maxDurationMinutes: 45,
  pricingMode: 'fixed',
  basePriceMinor: 6900,
  basePriceMaxMinor: 6900,
});

const FULL_DOG_SIZE_GROUP = makeGroup({
  id: 'd7111111-1111-1111-1111-111111111111',
  serviceId: FULL_SERVICE.serviceId,
  slug: 'dog-size',
  label: 'A kutya mérete',
  selectionMode: 'single',
  isRequired: true,
  minSelections: 1,
  maxSelections: 1,
  sortOrder: 0,
});

const FULL_ADDONS_GROUP = makeGroup({
  id: 'd7111111-1111-1111-1111-111111111112',
  serviceId: FULL_SERVICE.serviceId,
  slug: 'add-ons',
  label: 'Kiegészítő kezelések',
  selectionMode: 'multiple',
  isRequired: false,
  minSelections: 0,
  maxSelections: 3,
  sortOrder: 1,
});

const BATH_DOG_SIZE_GROUP = makeGroup({
  id: 'd8111111-1111-1111-1111-111111111111',
  serviceId: BATH_SERVICE.serviceId,
  slug: 'dog-size',
  label: 'A kutya mérete',
  selectionMode: 'single',
  isRequired: true,
  minSelections: 1,
  maxSelections: 1,
  sortOrder: 0,
});

const BATH_ADDONS_GROUP = makeGroup({
  id: 'd8111111-1111-1111-1111-111111111112',
  serviceId: BATH_SERVICE.serviceId,
  slug: 'add-ons',
  label: 'Kiegészítő kezelések',
  selectionMode: 'multiple',
  isRequired: false,
  minSelections: 0,
  maxSelections: 3,
  sortOrder: 1,
});

const FULL_DOG_SIZE_OPTIONS: BookingServiceOption[] = [
  makeOption({
    id: 'd7111111-1111-1111-1111-111111111121',
    serviceId: FULL_SERVICE.serviceId,
    optionGroupId: FULL_DOG_SIZE_GROUP.id,
    slug: 'small',
    label: 'Kistestű, 0–10 kg',
    priceDeltaMinor: 0,
    priceDeltaMaxMinor: 0,
    durationDeltaMinutes: 0,
    durationDeltaMaxMinutes: 0,
    sortOrder: 0,
  }),
  makeOption({
    id: 'd7111111-1111-1111-1111-111111111122',
    serviceId: FULL_SERVICE.serviceId,
    optionGroupId: FULL_DOG_SIZE_GROUP.id,
    slug: 'medium',
    label: 'Közepes, 11–25 kg',
    priceDeltaMinor: 3000,
    priceDeltaMaxMinor: 4000,
    durationDeltaMinutes: 15,
    durationDeltaMaxMinutes: 30,
    sortOrder: 1,
  }),
  makeOption({
    id: 'd7111111-1111-1111-1111-111111111123',
    serviceId: FULL_SERVICE.serviceId,
    optionGroupId: FULL_DOG_SIZE_GROUP.id,
    slug: 'large',
    label: 'Nagytestű, 26–40 kg',
    priceDeltaMinor: 6000,
    priceDeltaMaxMinor: 8000,
    durationDeltaMinutes: 30,
    durationDeltaMaxMinutes: 45,
    sortOrder: 2,
  }),
  makeOption({
    id: 'd7111111-1111-1111-1111-111111111124',
    serviceId: FULL_SERVICE.serviceId,
    optionGroupId: FULL_DOG_SIZE_GROUP.id,
    slug: 'extra-large',
    label: 'Óriástestű, 40 kg felett',
    priceDeltaMinor: 9000,
    priceDeltaMaxMinor: 12000,
    durationDeltaMinutes: 45,
    durationDeltaMaxMinutes: 60,
    sortOrder: 3,
  }),
];

const FULL_ADDON_OPTIONS: BookingServiceOption[] = [
  makeOption({
    id: 'd7111111-1111-1111-1111-111111111131',
    serviceId: FULL_SERVICE.serviceId,
    optionGroupId: FULL_ADDONS_GROUP.id,
    slug: 'deshedding',
    label: 'Aljszőrkiszedés',
    priceDeltaMinor: 3000,
    priceDeltaMaxMinor: 5000,
    durationDeltaMinutes: 15,
    durationDeltaMaxMinutes: 30,
    sortOrder: 0,
  }),
  makeOption({
    id: 'd7111111-1111-1111-1111-111111111132',
    serviceId: FULL_SERVICE.serviceId,
    optionGroupId: FULL_ADDONS_GROUP.id,
    slug: 'teeth-cleaning',
    label: 'Fogtisztítás',
    priceDeltaMinor: 2500,
    priceDeltaMaxMinor: 2500,
    durationDeltaMinutes: 10,
    durationDeltaMaxMinutes: 10,
    sortOrder: 1,
  }),
  makeOption({
    id: 'd7111111-1111-1111-1111-111111111133',
    serviceId: FULL_SERVICE.serviceId,
    optionGroupId: FULL_ADDONS_GROUP.id,
    slug: 'paw-care',
    label: 'Mancsápolás',
    priceDeltaMinor: 2000,
    priceDeltaMaxMinor: 2000,
    durationDeltaMinutes: 10,
    durationDeltaMaxMinutes: 10,
    sortOrder: 2,
  }),
  // Test-only fixture option used to exercise max_selections_exceeded.
  makeOption({
    id: 'd7111111-1111-1111-1111-111111111134',
    serviceId: FULL_SERVICE.serviceId,
    optionGroupId: FULL_ADDONS_GROUP.id,
    slug: 'flea-shampoo',
    label: 'Bolhairtó sampon',
    priceDeltaMinor: 1500,
    priceDeltaMaxMinor: 2500,
    durationDeltaMinutes: 10,
    durationDeltaMaxMinutes: 15,
    sortOrder: 3,
  }),
];

const BATH_DOG_SIZE_OPTIONS: BookingServiceOption[] = [
  makeOption({
    id: 'd8111111-1111-1111-1111-111111111121',
    serviceId: BATH_SERVICE.serviceId,
    optionGroupId: BATH_DOG_SIZE_GROUP.id,
    slug: 'small',
    label: 'Kistestű, 0–10 kg',
    priceDeltaMinor: 0,
    priceDeltaMaxMinor: 0,
    durationDeltaMinutes: 0,
    durationDeltaMaxMinutes: 0,
    sortOrder: 0,
  }),
  makeOption({
    id: 'd8111111-1111-1111-1111-111111111122',
    serviceId: BATH_SERVICE.serviceId,
    optionGroupId: BATH_DOG_SIZE_GROUP.id,
    slug: 'medium',
    label: 'Közepes, 11–25 kg',
    priceDeltaMinor: 3000,
    priceDeltaMaxMinor: 4000,
    durationDeltaMinutes: 15,
    durationDeltaMaxMinutes: 30,
    sortOrder: 1,
  }),
  makeOption({
    id: 'd8111111-1111-1111-1111-111111111123',
    serviceId: BATH_SERVICE.serviceId,
    optionGroupId: BATH_DOG_SIZE_GROUP.id,
    slug: 'large',
    label: 'Nagytestű, 26–40 kg',
    priceDeltaMinor: 6000,
    priceDeltaMaxMinor: 8000,
    durationDeltaMinutes: 30,
    durationDeltaMaxMinutes: 45,
    sortOrder: 2,
  }),
  makeOption({
    id: 'd8111111-1111-1111-1111-111111111124',
    serviceId: BATH_SERVICE.serviceId,
    optionGroupId: BATH_DOG_SIZE_GROUP.id,
    slug: 'extra-large',
    label: 'Óriástestű, 40 kg felett',
    priceDeltaMinor: 9000,
    priceDeltaMaxMinor: 12000,
    durationDeltaMinutes: 45,
    durationDeltaMaxMinutes: 60,
    sortOrder: 3,
  }),
];

const BATH_ADDON_OPTIONS: BookingServiceOption[] = [
  makeOption({
    id: 'd8111111-1111-1111-1111-111111111131',
    serviceId: BATH_SERVICE.serviceId,
    optionGroupId: BATH_ADDONS_GROUP.id,
    slug: 'deshedding',
    label: 'Aljszőrkiszedés',
    priceDeltaMinor: 3000,
    priceDeltaMaxMinor: 5000,
    durationDeltaMinutes: 15,
    durationDeltaMaxMinutes: 30,
    sortOrder: 0,
  }),
  makeOption({
    id: 'd8111111-1111-1111-1111-111111111132',
    serviceId: BATH_SERVICE.serviceId,
    optionGroupId: BATH_ADDONS_GROUP.id,
    slug: 'teeth-cleaning',
    label: 'Fogtisztítás',
    priceDeltaMinor: 2500,
    priceDeltaMaxMinor: 2500,
    durationDeltaMinutes: 10,
    durationDeltaMaxMinutes: 10,
    sortOrder: 1,
  }),
  makeOption({
    id: 'd8111111-1111-1111-1111-111111111133',
    serviceId: BATH_SERVICE.serviceId,
    optionGroupId: BATH_ADDONS_GROUP.id,
    slug: 'paw-care',
    label: 'Mancsápolás',
    priceDeltaMinor: 2000,
    priceDeltaMaxMinor: 2000,
    durationDeltaMinutes: 10,
    durationDeltaMaxMinutes: 10,
    sortOrder: 2,
  }),
];

const FULL_GROUPS = [FULL_DOG_SIZE_GROUP, FULL_ADDONS_GROUP];
const FULL_OPTIONS = [...FULL_DOG_SIZE_OPTIONS, ...FULL_ADDON_OPTIONS];

const BATH_GROUPS = [BATH_DOG_SIZE_GROUP, BATH_ADDONS_GROUP];
const BATH_OPTIONS = [...BATH_DOG_SIZE_OPTIONS, ...BATH_ADDON_OPTIONS];

describe('Dog Grooming quote fixture', () => {
  it('full-grooming + small with no add-ons', () => {
    const quote = calculateBookingQuote({
      service: FULL_SERVICE,
      groups: FULL_GROUPS,
      options: FULL_OPTIONS,
      selectedOptionIds: [FULL_DOG_SIZE_OPTIONS[0].id],
    });

    assert.equal(quote.priceMode, 'estimated');
    assert.equal(quote.priceMinMinor, 11900);
    assert.equal(quote.priceMaxMinor, 14900);
    assert.equal(quote.durationMinMinutes, 60);
    assert.equal(quote.durationMaxMinutes, 90);
  });

  it('full-grooming + large', () => {
    const quote = calculateBookingQuote({
      service: FULL_SERVICE,
      groups: FULL_GROUPS,
      options: FULL_OPTIONS,
      selectedOptionIds: [FULL_DOG_SIZE_OPTIONS[2].id],
    });

    assert.equal(quote.priceMinMinor, 17900);
    assert.equal(quote.priceMaxMinor, 22900);
    assert.equal(quote.durationMinMinutes, 90);
    assert.equal(quote.durationMaxMinutes, 135);
  });

  it('full-grooming + medium + deshedding', () => {
    const quote = calculateBookingQuote({
      service: FULL_SERVICE,
      groups: FULL_GROUPS,
      options: FULL_OPTIONS,
      selectedOptionIds: [
        FULL_DOG_SIZE_OPTIONS[1].id,
        FULL_ADDON_OPTIONS[0].id,
      ],
    });

    assert.equal(quote.priceMinMinor, 17900);
    assert.equal(quote.priceMaxMinor, 23900);
    assert.equal(quote.durationMinMinutes, 90);
    assert.equal(quote.durationMaxMinutes, 150);
  });

  it('full-grooming + extra-large + all add-ons', () => {
    const quote = calculateBookingQuote({
      service: FULL_SERVICE,
      groups: FULL_GROUPS,
      options: FULL_OPTIONS,
      selectedOptionIds: [
        FULL_DOG_SIZE_OPTIONS[3].id,
        FULL_ADDON_OPTIONS[0].id,
        FULL_ADDON_OPTIONS[1].id,
        FULL_ADDON_OPTIONS[2].id,
      ],
    });

    assert.equal(quote.priceMinMinor, 28400);
    assert.equal(quote.priceMaxMinor, 36400);
    assert.equal(quote.durationMinMinutes, 140);
    assert.equal(quote.durationMaxMinutes, 200);
  });

  it('bath-and-brush + small', () => {
    const quote = calculateBookingQuote({
      service: BATH_SERVICE,
      groups: BATH_GROUPS,
      options: BATH_OPTIONS,
      selectedOptionIds: [BATH_DOG_SIZE_OPTIONS[0].id],
    });

    assert.equal(quote.priceMode, 'estimated');
    assert.equal(quote.priceMinMinor, 7900);
    assert.equal(quote.priceMaxMinor, 9900);
    assert.equal(quote.durationMinMinutes, 45);
    assert.equal(quote.durationMaxMinutes, 60);
  });

  it('bath-and-brush + extra-large + all add-ons', () => {
    const quote = calculateBookingQuote({
      service: BATH_SERVICE,
      groups: BATH_GROUPS,
      options: BATH_OPTIONS,
      selectedOptionIds: [
        BATH_DOG_SIZE_OPTIONS[3].id,
        BATH_ADDON_OPTIONS[0].id,
        BATH_ADDON_OPTIONS[1].id,
        BATH_ADDON_OPTIONS[2].id,
      ],
    });

    assert.equal(quote.priceMode, 'estimated');
    assert.equal(quote.priceMinMinor, 24400);
    assert.equal(quote.priceMaxMinor, 31400);
    assert.equal(quote.durationMinMinutes, 125);
    assert.equal(quote.durationMaxMinutes, 170);
  });

  it('nail-trimming fixed price and duration', () => {
    const quote = calculateBookingQuote({
      service: NAIL_SERVICE,
      groups: [],
      options: [],
      selectedOptionIds: [],
    });

    assert.equal(quote.priceMode, 'fixed');
    assert.equal(quote.priceMinMinor, 3500);
    assert.equal(quote.priceMaxMinor, 3500);
    assert.equal(quote.durationMinMinutes, 15);
    assert.equal(quote.durationMaxMinutes, 15);
    assert.deepEqual(quote.selectedOptions, []);
  });

  it('puppy-first-groom fixed price and duration', () => {
    const quote = calculateBookingQuote({
      service: PUPPY_SERVICE,
      groups: [],
      options: [],
      selectedOptionIds: [],
    });

    assert.equal(quote.priceMode, 'fixed');
    assert.equal(quote.priceMinMinor, 6900);
    assert.equal(quote.priceMaxMinor, 6900);
    assert.equal(quote.durationMinMinutes, 45);
    assert.equal(quote.durationMaxMinutes, 45);
    assert.deepEqual(quote.selectedOptions, []);
  });

  it('rejects missing required dog-size group', () => {
    assert.throws(
      () =>
        calculateBookingQuote({
          service: FULL_SERVICE,
          groups: FULL_GROUPS,
          options: FULL_OPTIONS,
          selectedOptionIds: [],
        }),
      (err: unknown) =>
        err instanceof BookingPricingError &&
        err.code === 'required_group_not_met',
    );
  });

  it('rejects two dog-size selections', () => {
    assert.throws(
      () =>
        calculateBookingQuote({
          service: FULL_SERVICE,
          groups: FULL_GROUPS,
          options: FULL_OPTIONS,
          selectedOptionIds: [
            FULL_DOG_SIZE_OPTIONS[0].id,
            FULL_DOG_SIZE_OPTIONS[1].id,
          ],
        }),
      (err: unknown) =>
        err instanceof BookingPricingError &&
        err.code === 'single_group_too_many',
    );
  });

  it('rejects four add-ons (max_selections_exceeded)', () => {
    assert.throws(
      () =>
        calculateBookingQuote({
          service: FULL_SERVICE,
          groups: FULL_GROUPS,
          options: FULL_OPTIONS,
          selectedOptionIds: [
            FULL_DOG_SIZE_OPTIONS[0].id,
            FULL_ADDON_OPTIONS[0].id,
            FULL_ADDON_OPTIONS[1].id,
            FULL_ADDON_OPTIONS[2].id,
            FULL_ADDON_OPTIONS[3].id,
          ],
        }),
      (err: unknown) =>
        err instanceof BookingPricingError &&
        err.code === 'max_selections_exceeded',
    );
  });

  it('rejects an option belonging to another service', () => {
    assert.throws(
      () =>
        calculateBookingQuote({
          service: FULL_SERVICE,
          groups: FULL_GROUPS,
          options: [...FULL_OPTIONS, BATH_DOG_SIZE_OPTIONS[1]],
          selectedOptionIds: [
            FULL_DOG_SIZE_OPTIONS[0].id,
            BATH_DOG_SIZE_OPTIONS[1].id,
          ],
        }),
      (err: unknown) =>
        err instanceof BookingPricingError &&
        err.code === 'option_service_mismatch',
    );
  });

  it('returns deterministic option order', () => {
    const quote = calculateBookingQuote({
      service: FULL_SERVICE,
      groups: FULL_GROUPS,
      options: FULL_OPTIONS,
      selectedOptionIds: [
        FULL_ADDON_OPTIONS[0].id,
        FULL_DOG_SIZE_OPTIONS[1].id,
      ],
    });

    const ids = quote.selectedOptions.map((o) => o.optionId);
    assert.deepEqual(ids, [
      FULL_DOG_SIZE_OPTIONS[1].id,
      FULL_ADDON_OPTIONS[0].id,
    ]);
  });
});
