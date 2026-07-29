// ============================================================
// Dog Grooming flow alignment — unit tests
//
// Tests the locked five-step flow backend contract without a live DB.
// Services, option groups, options and intake fields are built from the
// same deterministic contract that migration 020 seeds.
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateQuoteForService,
  PublicQuoteServiceError,
} from '../publicQuoteService';
import type { BookingServiceContext } from '../../booking-service/types';
import type {
  BookingServiceOption,
  BookingServiceOptionGroup,
} from '../types';
import type {
  BookingServiceIntakeField,
  BookingServiceIntakeFieldOption,
} from '../../booking-intake/types';

const SITE_ID = 'd1111111-1111-1111-1111-111111111111';
const SCHEDULE_ID = 'd2222222-2222-2222-2222-222222222222';

function makeUuid(prefix: string, index: number): string {
  let hash = 0;
  for (const ch of prefix) {
    hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff;
  }
  const first = (hash >>> 0).toString(16).padStart(8, '0');
  const idx = String(index).padStart(12, '0');
  return `${first}-0000-4000-8000-${idx}`;
}

function baseService(
  overrides: Partial<BookingServiceContext> & {
    serviceId: string;
    serviceSlug: string;
  },
): BookingServiceContext {
  return {
    siteId: SITE_ID,
    siteSlug: 'bundas-demo',
    siteName: 'Bundás Kutyakozmetika',
    timezone: 'Europe/Budapest',
    scheduleId: SCHEDULE_ID,
    slotIntervalMinutes: 15,
    minimumNoticeMinutes: 720,
    bookingWindowDays: 60,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    cancelCutoffHours: 12,
    rescheduleCutoffHours: 12,
    maxReschedules: 2,
    publicBookingEnabled: false,
    pricingMode: 'estimated',
    currency: 'HUF',
    ...overrides,
  } as BookingServiceContext;
}

const fullGroomingService = baseService({
  serviceId: 'd3333333-3333-3333-3333-333333333333',
  serviceSlug: 'full-grooming',
  serviceName: 'Teljes kutyakozmetika',
  durationMinutes: 90,
  maxDurationMinutes: 120,
  basePriceMinor: 14900,
  basePriceMaxMinor: 17900,
});

const bathAndBrushService = baseService({
  serviceId: 'd4444444-4444-4444-4444-444444444444',
  serviceSlug: 'bath-and-brush',
  serviceName: 'Fürdetés és szőrápolás',
  durationMinutes: 45,
  maxDurationMinutes: 75,
  basePriceMinor: 12900,
  basePriceMaxMinor: 15900,
});

const trimmingSpecialCareService = baseService({
  serviceId: 'd7777777-7777-7777-7777-777777777777',
  serviceSlug: 'trimming-special-care',
  serviceName: 'Trimmelés és speciális ápolás',
  durationMinutes: 90,
  maxDurationMinutes: 150,
  basePriceMinor: 16900,
  basePriceMaxMinor: 20900,
});

function makeGroup(
  serviceId: string,
  overrides: Partial<BookingServiceOptionGroup> & { id: string; slug: string },
): BookingServiceOptionGroup {
  return {
    siteId: SITE_ID,
    serviceId,
    label: overrides.slug,
    selectionMode: 'single',
    isRequired: true,
    minSelections: 1,
    maxSelections: 1,
    sortOrder: 0,
    isActive: true,
    ...overrides,
  };
}

function makeOption(
  serviceId: string,
  groupId: string,
  overrides: Partial<BookingServiceOption> & { id: string; slug: string },
): BookingServiceOption {
  return {
    siteId: SITE_ID,
    serviceId,
    optionGroupId: groupId,
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

function makeIntakeField(
  serviceId: string,
  overrides: Partial<BookingServiceIntakeField> & {
    id: string;
    slug: string;
    fieldType: BookingServiceIntakeField['fieldType'];
  },
): BookingServiceIntakeField {
  return {
    siteId: SITE_ID,
    serviceId,
    label: overrides.slug,
    isRequired: false,
    minLength: 0,
    maxLength: 100,
    minValue: null,
    maxValue: null,
    minSelections: 0,
    maxSelections: 0,
    sortOrder: 0,
    isActive: true,
    options: [],
    ...overrides,
  };
}

function makeIntakeOption(
  fieldId: string,
  overrides: Partial<BookingServiceIntakeFieldOption> & { id: string; slug: string },
): BookingServiceIntakeFieldOption {
  return {
    siteId: SITE_ID,
    serviceId: fieldId.split('-')[0] ?? 'unknown',
    intakeFieldId: fieldId,
    label: overrides.slug,
    sortOrder: 0,
    isActive: true,
    ...overrides,
  };
}

function buildDogGroomingConfig(
  service: BookingServiceContext,
  prefix: string,
) {
  const sizeGroupId = makeUuid(`${prefix}-size`, 1);
  const coatGroupId = makeUuid(`${prefix}-coat`, 2);
  const desiredGroupId = makeUuid(`${prefix}-desired`, 3);
  const addOnsGroupId = makeUuid(`${prefix}-addons`, 4);

  const groups = [
    makeGroup(service.serviceId, {
      id: sizeGroupId,
      slug: 'dog-size',
      label: 'A kutya mérete',
      selectionMode: 'single',
      isRequired: true,
      minSelections: 1,
      maxSelections: 1,
      sortOrder: 0,
    }),
    makeGroup(service.serviceId, {
      id: coatGroupId,
      slug: 'coat-condition',
      label: 'Szőrzet állapota',
      selectionMode: 'single',
      isRequired: true,
      minSelections: 1,
      maxSelections: 1,
      sortOrder: 1,
    }),
    makeGroup(service.serviceId, {
      id: desiredGroupId,
      slug: 'desired-result',
      label: 'Kívánt eredmény',
      selectionMode: 'single',
      isRequired: true,
      minSelections: 1,
      maxSelections: 1,
      sortOrder: 2,
    }),
    makeGroup(service.serviceId, {
      id: addOnsGroupId,
      slug: 'add-ons',
      label: 'Kiegészítő kezelések',
      selectionMode: 'multiple',
      isRequired: false,
      minSelections: 0,
      maxSelections: 3,
      sortOrder: 3,
    }),
  ];

  const options = [
    makeOption(service.serviceId, sizeGroupId, {
      id: makeUuid(`${prefix}-size-small`, 11),
      slug: 'small',
      label: 'Kistestű, 0–10 kg',
      priceDeltaMinor: 0,
      priceDeltaMaxMinor: 0,
      durationDeltaMinutes: 0,
      durationDeltaMaxMinutes: 0,
      sortOrder: 0,
    }),
    makeOption(service.serviceId, sizeGroupId, {
      id: makeUuid(`${prefix}-size-medium`, 12),
      slug: 'medium',
      label: 'Közepes, 11–25 kg',
      priceDeltaMinor: 3000,
      priceDeltaMaxMinor: 4000,
      durationDeltaMinutes: 15,
      durationDeltaMaxMinutes: 30,
      sortOrder: 1,
    }),
    makeOption(service.serviceId, sizeGroupId, {
      id: makeUuid(`${prefix}-size-large`, 13),
      slug: 'large',
      label: 'Nagytestű, 26–40 kg',
      priceDeltaMinor: 6000,
      priceDeltaMaxMinor: 8000,
      durationDeltaMinutes: 30,
      durationDeltaMaxMinutes: 45,
      sortOrder: 2,
    }),
    makeOption(service.serviceId, sizeGroupId, {
      id: makeUuid(`${prefix}-size-xl`, 14),
      slug: 'extra-large',
      label: 'Óriástestű, 40 kg felett',
      priceDeltaMinor: 9000,
      priceDeltaMaxMinor: 12000,
      durationDeltaMinutes: 45,
      durationDeltaMaxMinutes: 60,
      sortOrder: 3,
    }),
    makeOption(service.serviceId, coatGroupId, {
      id: makeUuid(`${prefix}-coat-maintained`, 21),
      slug: 'maintained',
      label: 'Rendszeresen ápolt',
      priceDeltaMinor: 0,
      priceDeltaMaxMinor: 0,
      durationDeltaMinutes: 0,
      durationDeltaMaxMinutes: 0,
      sortOrder: 0,
    }),
    makeOption(service.serviceId, coatGroupId, {
      id: makeUuid(`${prefix}-coat-slightly`, 22),
      slug: 'slightly-matted',
      label: 'Kissé csomós',
      priceDeltaMinor: 2000,
      priceDeltaMaxMinor: 3000,
      durationDeltaMinutes: 20,
      durationDeltaMaxMinutes: 20,
      sortOrder: 1,
    }),
    makeOption(service.serviceId, coatGroupId, {
      id: makeUuid(`${prefix}-coat-heavily`, 23),
      slug: 'heavily-matted',
      label: 'Erősen csomós vagy filces',
      priceDeltaMinor: 5000,
      priceDeltaMaxMinor: 8000,
      durationDeltaMinutes: 40,
      durationDeltaMaxMinutes: 60,
      sortOrder: 2,
    }),
    makeOption(service.serviceId, coatGroupId, {
      id: makeUuid(`${prefix}-coat-unknown`, 24),
      slug: 'unknown',
      label: 'Nem tudom megítélni',
      priceDeltaMinor: 0,
      priceDeltaMaxMinor: 3000,
      durationDeltaMinutes: 0,
      durationDeltaMaxMinutes: 20,
      sortOrder: 3,
    }),
    makeOption(service.serviceId, desiredGroupId, {
      id: makeUuid(`${prefix}-desired-light`, 31),
      slug: 'light-trim',
      label: 'Csak egy kis igazítás',
      priceDeltaMinor: 0,
      priceDeltaMaxMinor: 0,
      durationDeltaMinutes: 0,
      durationDeltaMaxMinutes: 0,
      sortOrder: 0,
    }),
    makeOption(service.serviceId, desiredGroupId, {
      id: makeUuid(`${prefix}-desired-short`, 32),
      slug: 'short-manageable',
      label: 'Rövidebb, könnyen kezelhető',
      priceDeltaMinor: 0,
      priceDeltaMaxMinor: 0,
      durationDeltaMinutes: 0,
      durationDeltaMaxMinutes: 0,
      sortOrder: 1,
    }),
    makeOption(service.serviceId, desiredGroupId, {
      id: makeUuid(`${prefix}-desired-breed`, 33),
      slug: 'breed-standard',
      label: 'Fajtának megfelelő fazon',
      priceDeltaMinor: 2000,
      priceDeltaMaxMinor: 3000,
      durationDeltaMinutes: 15,
      durationDeltaMaxMinutes: 30,
      sortOrder: 2,
    }),
    makeOption(service.serviceId, desiredGroupId, {
      id: makeUuid(`${prefix}-desired-groomer`, 34),
      slug: 'groomer-choice',
      label: 'Rábízom a kozmetikusra',
      priceDeltaMinor: 0,
      priceDeltaMaxMinor: 2000,
      durationDeltaMinutes: 0,
      durationDeltaMaxMinutes: 15,
      sortOrder: 3,
    }),
    makeOption(service.serviceId, addOnsGroupId, {
      id: makeUuid(`${prefix}-addons-deshedding`, 41),
      slug: 'deshedding',
      label: 'Aljszőrkiszedés',
      priceDeltaMinor: 3000,
      priceDeltaMaxMinor: 5000,
      durationDeltaMinutes: 15,
      durationDeltaMaxMinutes: 30,
      sortOrder: 0,
    }),
    makeOption(service.serviceId, addOnsGroupId, {
      id: makeUuid(`${prefix}-addons-teeth`, 42),
      slug: 'teeth-cleaning',
      label: 'Fogtisztítás',
      priceDeltaMinor: 2500,
      priceDeltaMaxMinor: 2500,
      durationDeltaMinutes: 10,
      durationDeltaMaxMinutes: 10,
      sortOrder: 1,
    }),
    makeOption(service.serviceId, addOnsGroupId, {
      id: makeUuid(`${prefix}-addons-paw`, 43),
      slug: 'paw-care',
      label: 'Mancsápolás',
      priceDeltaMinor: 2000,
      priceDeltaMaxMinor: 2000,
      durationDeltaMinutes: 10,
      durationDeltaMaxMinutes: 10,
      sortOrder: 2,
    }),
  ];

  const nameField = makeIntakeField(service.serviceId, {
    id: makeUuid(`${prefix}-name`, 51),
    slug: 'dog-name',
    fieldType: 'text',
    label: 'Kutyus neve',
    isRequired: true,
    minLength: 1,
    maxLength: 80,
    sortOrder: 0,
  });
  const breedField = makeIntakeField(service.serviceId, {
    id: makeUuid(`${prefix}-breed`, 52),
    slug: 'dog-breed',
    fieldType: 'text',
    label: 'Fajta',
    isRequired: true,
    minLength: 2,
    maxLength: 100,
    sortOrder: 1,
  });
  const weightField = makeIntakeField(service.serviceId, {
    id: makeUuid(`${prefix}-weight`, 53),
    slug: 'dog-weight-kg',
    fieldType: 'number',
    label: 'Testsúly',
    isRequired: false,
    minLength: 0,
    maxLength: 1,
    minValue: 1,
    maxValue: 100,
    sortOrder: 2,
  });
  const ageField = makeIntakeField(service.serviceId, {
    id: makeUuid(`${prefix}-age`, 54),
    slug: 'dog-age-group',
    fieldType: 'single_choice',
    label: 'Életkor',
    isRequired: true,
    minLength: 1,
    maxLength: 1,
    minSelections: 1,
    maxSelections: 1,
    sortOrder: 3,
  });
  const careField = makeIntakeField(service.serviceId, {
    id: makeUuid(`${prefix}-care`, 55),
    slug: 'care-considerations',
    fieldType: 'multiple_choice',
    label: 'Amire figyeljünk',
    isRequired: false,
    minLength: 0,
    maxLength: 1,
    minSelections: 0,
    maxSelections: 5,
    sortOrder: 4,
  });
  const notesField = makeIntakeField(service.serviceId, {
    id: makeUuid(`${prefix}-notes`, 56),
    slug: 'temperament-notes',
    fieldType: 'textarea',
    label: 'Temperamentum és különleges tudnivalók',
    isRequired: false,
    minLength: 0,
    maxLength: 120,
    sortOrder: 5,
  });

  ageField.options = [
    makeIntakeOption(ageField.id, {
      id: makeUuid(`${prefix}-age-puppy`, 61),
      slug: 'puppy',
      label: 'Kölyök, 0–12 hó',
      sortOrder: 0,
    }),
    makeIntakeOption(ageField.id, {
      id: makeUuid(`${prefix}-age-adult`, 62),
      slug: 'adult',
      label: 'Felnőtt, 1–7 év',
      sortOrder: 1,
    }),
    makeIntakeOption(ageField.id, {
      id: makeUuid(`${prefix}-age-senior`, 63),
      slug: 'senior',
      label: 'Senior, 7+ év',
      sortOrder: 2,
    }),
  ];
  careField.options = [
    makeIntakeOption(careField.id, {
      id: makeUuid(`${prefix}-care-first`, 71),
      slug: 'first-groom',
      label: 'Első kozmetikálás',
      sortOrder: 0,
    }),
    makeIntakeOption(careField.id, {
      id: makeUuid(`${prefix}-care-anxious`, 72),
      slug: 'anxious',
      label: 'Szorongó',
      sortOrder: 1,
    }),
    makeIntakeOption(careField.id, {
      id: makeUuid(`${prefix}-care-skin`, 73),
      slug: 'sensitive-skin',
      label: 'Érzékeny bőr',
      sortOrder: 2,
    }),
    makeIntakeOption(careField.id, {
      id: makeUuid(`${prefix}-care-allergy`, 74),
      slug: 'allergy',
      label: 'Allergia',
      sortOrder: 3,
    }),
    makeIntakeOption(careField.id, {
      id: makeUuid(`${prefix}-care-puppy-senior`, 75),
      slug: 'puppy-or-senior',
      label: 'Kölyök vagy senior',
      sortOrder: 4,
    }),
  ];

  const fields = [nameField, breedField, weightField, ageField, careField, notesField];

  return { groups, options, fields };
}

const fullConfig = buildDogGroomingConfig(fullGroomingService, 'full');
const bathConfig = buildDogGroomingConfig(bathAndBrushService, 'bath');
const trimConfig = buildDogGroomingConfig(trimmingSpecialCareService, 'trim');

function makeDeps(
  service: BookingServiceContext,
  groups: BookingServiceOptionGroup[],
  options: BookingServiceOption[],
  intakeFields: BookingServiceIntakeField[],
) {
  return {
    loadServiceContext: async () => service,
    loadOptions: async () => ({ groups, options }),
    loadIntakeFields: async () => intakeFields,
  };
}

const minimalIntake = {
  'dog-name': 'Bodri',
  'dog-breed': 'Golden Retriever',
  'dog-age-group': 'adult',
};

function selectFor(
  config: ReturnType<typeof buildDogGroomingConfig>,
  slugs: { size?: string; coat?: string; desired?: string; addOns?: string[] },
) {
  const byGroupSlug = new Map(config.groups.map((g) => [g.slug, g.id]));
  const byComposite = new Map(
    config.options.map((o) => [`${o.optionGroupId}:${o.slug}`, o.id]),
  );
  const ids: string[] = [];
  if (slugs.size) {
    ids.push(byComposite.get(`${byGroupSlug.get('dog-size')}:${slugs.size}`)!);
  }
  if (slugs.coat) {
    ids.push(byComposite.get(`${byGroupSlug.get('coat-condition')}:${slugs.coat}`)!);
  }
  if (slugs.desired) {
    ids.push(byComposite.get(`${byGroupSlug.get('desired-result')}:${slugs.desired}`)!);
  }
  if (slugs.addOns) {
    for (const s of slugs.addOns) {
      ids.push(byComposite.get(`${byGroupSlug.get('add-ons')}:${s}`)!);
    }
  }
  return ids;
}

function minimalOptions(config: ReturnType<typeof buildDogGroomingConfig>) {
  return selectFor(config, { coat: 'maintained', desired: 'light-trim' });
}

describe('Dog Grooming service contracts', () => {
  it('full-grooming has the locked base price and duration', async () => {
    const quote = await calculateQuoteForService(
      fullGroomingService,
      minimalOptions(fullConfig),
      { ...minimalIntake, 'dog-weight-kg': 5 },
      makeDeps(
        fullGroomingService,
        fullConfig.groups,
        fullConfig.options,
        fullConfig.fields,
      ),
    );
    assert.equal(quote.priceMode, 'estimated');
    assert.equal(quote.priceMinMinor, 14900);
    assert.equal(quote.priceMaxMinor, 17900);
    assert.equal(quote.durationMinMinutes, 90);
    assert.equal(quote.durationMaxMinutes, 120);
  });

  it('bath-and-brush has the locked base price and duration', async () => {
    const quote = await calculateQuoteForService(
      bathAndBrushService,
      minimalOptions(bathConfig),
      { ...minimalIntake, 'dog-weight-kg': 5 },
      makeDeps(
        bathAndBrushService,
        bathConfig.groups,
        bathConfig.options,
        bathConfig.fields,
      ),
    );
    assert.equal(quote.priceMinMinor, 12900);
    assert.equal(quote.priceMaxMinor, 15900);
    assert.equal(quote.durationMinMinutes, 45);
    assert.equal(quote.durationMaxMinutes, 75);
  });

  it('trimming-special-care has the locked base price and duration', async () => {
    const quote = await calculateQuoteForService(
      trimmingSpecialCareService,
      minimalOptions(trimConfig),
      { ...minimalIntake, 'dog-weight-kg': 5 },
      makeDeps(
        trimmingSpecialCareService,
        trimConfig.groups,
        trimConfig.options,
        trimConfig.fields,
      ),
    );
    assert.equal(quote.priceMinMinor, 16900);
    assert.equal(quote.priceMaxMinor, 20900);
    assert.equal(quote.durationMinMinutes, 90);
    assert.equal(quote.durationMaxMinutes, 150);
  });
});

describe('Dog Grooming weight → size mapping', () => {
  it('maps 10 kg to small', async () => {
    const quote = await calculateQuoteForService(
      fullGroomingService,
      minimalOptions(fullConfig),
      { ...minimalIntake, 'dog-weight-kg': 10 },
      makeDeps(
        fullGroomingService,
        fullConfig.groups,
        fullConfig.options,
        fullConfig.fields,
      ),
    );
    assert.equal(
      quote.selectedOptions.some((o) => o.optionSlug === 'small'),
      true,
    );
    assert.equal(
      quote.selectedOptions.some((o) => o.optionSlug === 'medium'),
      false,
    );
  });

  it('maps 11 kg to medium', async () => {
    const quote = await calculateQuoteForService(
      fullGroomingService,
      minimalOptions(fullConfig),
      { ...minimalIntake, 'dog-weight-kg': 11 },
      makeDeps(
        fullGroomingService,
        fullConfig.groups,
        fullConfig.options,
        fullConfig.fields,
      ),
    );
    assert.equal(
      quote.selectedOptions.some((o) => o.optionSlug === 'medium'),
      true,
    );
  });

  it('maps 25 kg to medium', async () => {
    const quote = await calculateQuoteForService(
      fullGroomingService,
      minimalOptions(fullConfig),
      { ...minimalIntake, 'dog-weight-kg': 25 },
      makeDeps(
        fullGroomingService,
        fullConfig.groups,
        fullConfig.options,
        fullConfig.fields,
      ),
    );
    assert.equal(
      quote.selectedOptions.some((o) => o.optionSlug === 'medium'),
      true,
    );
  });

  it('maps 26 kg to large', async () => {
    const quote = await calculateQuoteForService(
      fullGroomingService,
      minimalOptions(fullConfig),
      { ...minimalIntake, 'dog-weight-kg': 26 },
      makeDeps(
        fullGroomingService,
        fullConfig.groups,
        fullConfig.options,
        fullConfig.fields,
      ),
    );
    assert.equal(
      quote.selectedOptions.some((o) => o.optionSlug === 'large'),
      true,
    );
  });

  it('maps 40 kg to large', async () => {
    const quote = await calculateQuoteForService(
      fullGroomingService,
      minimalOptions(fullConfig),
      { ...minimalIntake, 'dog-weight-kg': 40 },
      makeDeps(
        fullGroomingService,
        fullConfig.groups,
        fullConfig.options,
        fullConfig.fields,
      ),
    );
    assert.equal(
      quote.selectedOptions.some((o) => o.optionSlug === 'large'),
      true,
    );
  });

  it('maps 41 kg to extra-large', async () => {
    const quote = await calculateQuoteForService(
      fullGroomingService,
      minimalOptions(fullConfig),
      { ...minimalIntake, 'dog-weight-kg': 41 },
      makeDeps(
        fullGroomingService,
        fullConfig.groups,
        fullConfig.options,
        fullConfig.fields,
      ),
    );
    assert.equal(
      quote.selectedOptions.some((o) => o.optionSlug === 'extra-large'),
      true,
    );
  });

  it('maps 100 kg to extra-large', async () => {
    const quote = await calculateQuoteForService(
      fullGroomingService,
      minimalOptions(fullConfig),
      { ...minimalIntake, 'dog-weight-kg': 100 },
      makeDeps(
        fullGroomingService,
        fullConfig.groups,
        fullConfig.options,
        fullConfig.fields,
      ),
    );
    assert.equal(
      quote.selectedOptions.some((o) => o.optionSlug === 'extra-large'),
      true,
    );
  });

  it('maps 1 kg to small', async () => {
    const quote = await calculateQuoteForService(
      fullGroomingService,
      minimalOptions(fullConfig),
      { ...minimalIntake, 'dog-weight-kg': 1 },
      makeDeps(
        fullGroomingService,
        fullConfig.groups,
        fullConfig.options,
        fullConfig.fields,
      ),
    );
    assert.equal(
      quote.selectedOptions.some((o) => o.optionSlug === 'small'),
      true,
    );
  });

  it('maps 10.01 kg to medium', async () => {
    const quote = await calculateQuoteForService(
      fullGroomingService,
      minimalOptions(fullConfig),
      { ...minimalIntake, 'dog-weight-kg': 10.01 },
      makeDeps(
        fullGroomingService,
        fullConfig.groups,
        fullConfig.options,
        fullConfig.fields,
      ),
    );
    assert.equal(
      quote.selectedOptions.some((o) => o.optionSlug === 'medium'),
      true,
    );
  });

  it('maps 25.01 kg to large', async () => {
    const quote = await calculateQuoteForService(
      fullGroomingService,
      minimalOptions(fullConfig),
      { ...minimalIntake, 'dog-weight-kg': 25.01 },
      makeDeps(
        fullGroomingService,
        fullConfig.groups,
        fullConfig.options,
        fullConfig.fields,
      ),
    );
    assert.equal(
      quote.selectedOptions.some((o) => o.optionSlug === 'large'),
      true,
    );
  });

  it('maps 40.01 kg to extra-large', async () => {
    const quote = await calculateQuoteForService(
      fullGroomingService,
      minimalOptions(fullConfig),
      { ...minimalIntake, 'dog-weight-kg': 40.01 },
      makeDeps(
        fullGroomingService,
        fullConfig.groups,
        fullConfig.options,
        fullConfig.fields,
      ),
    );
    assert.equal(
      quote.selectedOptions.some((o) => o.optionSlug === 'extra-large'),
      true,
    );
  });

  it('rejects 0 kg', async () => {
    await assert.rejects(
      () =>
        calculateQuoteForService(
          fullGroomingService,
          minimalOptions(fullConfig),
          { ...minimalIntake, 'dog-weight-kg': 0 },
          makeDeps(
            fullGroomingService,
            fullConfig.groups,
            fullConfig.options,
            fullConfig.fields,
          ),
        ),
      (err: unknown) =>
        err instanceof PublicQuoteServiceError && err.code === 'invalid_intake',
    );
  });

  it('rejects weight above 100 kg', async () => {
    await assert.rejects(
      () =>
        calculateQuoteForService(
          fullGroomingService,
          minimalOptions(fullConfig),
          { ...minimalIntake, 'dog-weight-kg': 100.1 },
          makeDeps(
            fullGroomingService,
            fullConfig.groups,
            fullConfig.options,
            fullConfig.fields,
          ),
        ),
      (err: unknown) =>
        err instanceof PublicQuoteServiceError && err.code === 'invalid_intake',
    );
  });

  it('rejects NaN and Infinity weight', async () => {
    const deps = makeDeps(
      fullGroomingService,
      fullConfig.groups,
      fullConfig.options,
      fullConfig.fields,
    );

    await assert.rejects(
      () =>
        calculateQuoteForService(
          fullGroomingService,
          minimalOptions(fullConfig),
          { ...minimalIntake, 'dog-weight-kg': NaN },
          deps,
        ),
      (err: unknown) =>
        err instanceof PublicQuoteServiceError && err.code === 'invalid_intake',
    );

    await assert.rejects(
      () =>
        calculateQuoteForService(
          fullGroomingService,
          minimalOptions(fullConfig),
          { ...minimalIntake, 'dog-weight-kg': Infinity },
          deps,
        ),
      (err: unknown) =>
        err instanceof PublicQuoteServiceError && err.code === 'invalid_intake',
    );
  });

  it('accepts explicit size when weight is absent', async () => {
    const quote = await calculateQuoteForService(
      fullGroomingService,
      selectFor(fullConfig, {
        size: 'medium',
        coat: 'maintained',
        desired: 'light-trim',
      }),
      minimalIntake,
      makeDeps(
        fullGroomingService,
        fullConfig.groups,
        fullConfig.options,
        fullConfig.fields,
      ),
    );
    assert.equal(
      quote.selectedOptions.some((o) => o.optionSlug === 'medium'),
      true,
    );
  });

  it('rejects conflicting size when weight is provided', async () => {
    await assert.rejects(
      () =>
        calculateQuoteForService(
          fullGroomingService,
          selectFor(fullConfig, {
            size: 'medium',
            coat: 'maintained',
            desired: 'light-trim',
          }),
          { ...minimalIntake, 'dog-weight-kg': 10 },
          makeDeps(
            fullGroomingService,
            fullConfig.groups,
            fullConfig.options,
            fullConfig.fields,
          ),
        ),
      (err: unknown) =>
        err instanceof PublicQuoteServiceError &&
        err.code === 'invalid_selection',
    );
  });

  it('rejects missing weight and size', async () => {
    await assert.rejects(
      () =>
        calculateQuoteForService(
          fullGroomingService,
          selectFor(fullConfig, { coat: 'maintained', desired: 'light-trim' }),
          minimalIntake,
          makeDeps(
            fullGroomingService,
            fullConfig.groups,
            fullConfig.options,
            fullConfig.fields,
          ),
        ),
      (err: unknown) =>
        err instanceof PublicQuoteServiceError &&
        err.code === 'invalid_selection',
    );
  });
});

describe('Dog Grooming intake choices', () => {
  it('rejects unknown age group choice', async () => {
    await assert.rejects(
      () =>
        calculateQuoteForService(
          fullGroomingService,
          minimalOptions(fullConfig),
          { ...minimalIntake, 'dog-age-group': 'unknown', 'dog-weight-kg': 5 },
          makeDeps(
            fullGroomingService,
            fullConfig.groups,
            fullConfig.options,
            fullConfig.fields,
          ),
        ),
      (err: unknown) =>
        err instanceof PublicQuoteServiceError && err.code === 'invalid_intake',
    );
  });

  it('accepts multiple care considerations up to 5', async () => {
    const quote = await calculateQuoteForService(
      fullGroomingService,
      selectFor(fullConfig, {
        size: 'small',
        coat: 'maintained',
        desired: 'light-trim',
      }),
      {
        ...minimalIntake,
        'dog-weight-kg': 5,
        'care-considerations': ['first-groom', 'anxious', 'sensitive-skin'],
      },
      makeDeps(
        fullGroomingService,
        fullConfig.groups,
        fullConfig.options,
        fullConfig.fields,
      ),
    );
    assert.equal(quote.priceMinMinor, 14900);
  });

  it('accepts empty care considerations', async () => {
    const quote = await calculateQuoteForService(
      fullGroomingService,
      selectFor(fullConfig, {
        size: 'small',
        coat: 'maintained',
        desired: 'light-trim',
      }),
      {
        ...minimalIntake,
        'dog-weight-kg': 5,
        'care-considerations': [],
      },
      makeDeps(
        fullGroomingService,
        fullConfig.groups,
        fullConfig.options,
        fullConfig.fields,
      ),
    );
    assert.equal(quote.priceMinMinor, 14900);
  });
});

describe('Dog Grooming option groups', () => {
  it('rejects missing required coat-condition', async () => {
    await assert.rejects(
      () =>
        calculateQuoteForService(
          fullGroomingService,
          selectFor(fullConfig, { size: 'small', desired: 'light-trim' }),
          { ...minimalIntake, 'dog-weight-kg': 5 },
          makeDeps(
            fullGroomingService,
            fullConfig.groups,
            fullConfig.options,
            fullConfig.fields,
          ),
        ),
      (err: unknown) =>
        err instanceof PublicQuoteServiceError &&
        err.code === 'invalid_selection',
    );
  });

  it('rejects missing required desired-result', async () => {
    await assert.rejects(
      () =>
        calculateQuoteForService(
          fullGroomingService,
          selectFor(fullConfig, { size: 'small', coat: 'maintained' }),
          { ...minimalIntake, 'dog-weight-kg': 5 },
          makeDeps(
            fullGroomingService,
            fullConfig.groups,
            fullConfig.options,
            fullConfig.fields,
          ),
        ),
      (err: unknown) =>
        err instanceof PublicQuoteServiceError &&
        err.code === 'invalid_selection',
    );
  });

  it('rejects options from another service', async () => {
    await assert.rejects(
      () =>
        calculateQuoteForService(
          fullGroomingService,
          selectFor(bathConfig, {
            size: 'small',
            coat: 'maintained',
            desired: 'light-trim',
          }),
          { ...minimalIntake, 'dog-weight-kg': 5 },
          makeDeps(
            fullGroomingService,
            fullConfig.groups,
            fullConfig.options,
            fullConfig.fields,
          ),
        ),
      (err: unknown) =>
        err instanceof PublicQuoteServiceError &&
        err.code === 'invalid_selection',
    );
  });
});

describe('Dog Grooming progressive quote', () => {
  it('Step 2 partial quote with only dog-size returns the base range', async () => {
    const quote = await calculateQuoteForService(
      fullGroomingService,
      selectFor(fullConfig, { size: 'small' }),
      { ...minimalIntake, 'dog-weight-kg': 5 },
      makeDeps(
        fullGroomingService,
        fullConfig.groups,
        fullConfig.options,
        fullConfig.fields,
      ),
      'partial',
    );
    assert.equal(quote.priceMinMinor, 14900);
    assert.equal(quote.priceMaxMinor, 17900);
    assert.equal(quote.durationMinMinutes, 90);
    assert.equal(quote.durationMaxMinutes, 120);
  });

  it('Step 2 selection with only dog-size is rejected in complete mode', async () => {
    await assert.rejects(
      () =>
        calculateQuoteForService(
          fullGroomingService,
          selectFor(fullConfig, { size: 'small' }),
          { ...minimalIntake, 'dog-weight-kg': 5 },
          makeDeps(
            fullGroomingService,
            fullConfig.groups,
            fullConfig.options,
            fullConfig.fields,
          ),
          'complete',
        ),
      (err: unknown) =>
        err instanceof PublicQuoteServiceError &&
        err.code === 'invalid_selection',
    );
  });
});

describe('Dog Grooming reference quotes', () => {
  it('full + small + slightly-matted + short-manageable = 16 900–20 900 Ft, 110–140 min', async () => {
    const quote = await calculateQuoteForService(
      fullGroomingService,
      selectFor(fullConfig, {
        coat: 'slightly-matted',
        desired: 'short-manageable',
      }),
      { ...minimalIntake, 'dog-weight-kg': 5 },
      makeDeps(
        fullGroomingService,
        fullConfig.groups,
        fullConfig.options,
        fullConfig.fields,
      ),
    );
    assert.equal(quote.priceMinMinor, 16900);
    assert.equal(quote.priceMaxMinor, 20900);
    assert.equal(quote.durationMinMinutes, 110);
    assert.equal(quote.durationMaxMinutes, 140);
  });

  it('heavily-matted adds up to 60 minutes', async () => {
    const quote = await calculateQuoteForService(
      fullGroomingService,
      selectFor(fullConfig, {
        coat: 'heavily-matted',
        desired: 'light-trim',
      }),
      { ...minimalIntake, 'dog-weight-kg': 5 },
      makeDeps(
        fullGroomingService,
        fullConfig.groups,
        fullConfig.options,
        fullConfig.fields,
      ),
    );
    assert.equal(quote.durationMinMinutes, 130);
    assert.equal(quote.durationMaxMinutes, 180);
  });
});

describe('Dog Grooming legacy regressions', () => {
  it('services without a dog-size group do not require intake data', async () => {
    const cosmeticService: BookingServiceContext = {
      ...fullGroomingService,
      serviceId: 'c1111111-1111-1111-1111-111111111111',
      serviceSlug: 'cosmetic',
      serviceName: 'Cosmetic',
      pricingMode: 'fixed',
      basePriceMinor: 12000,
      basePriceMaxMinor: null,
      durationMinutes: 60,
      maxDurationMinutes: null,
    };
    const group = makeGroup(cosmeticService.serviceId, {
      id: makeUuid('cosmetic-extras', 1),
      slug: 'extras',
      selectionMode: 'multiple',
      isRequired: false,
      minSelections: 0,
      maxSelections: 2,
    });
    const option = makeOption(cosmeticService.serviceId, group.id, {
      id: makeUuid('cosmetic-opt', 1),
      slug: 'deep-clean',
      priceDeltaMinor: 2500,
      durationDeltaMinutes: 15,
    });

    const quote = await calculateQuoteForService(
      cosmeticService,
      [option.id],
      {},
      {
        loadServiceContext: async () => cosmeticService,
        loadOptions: async () => ({ groups: [group], options: [option] }),
        loadIntakeFields: async () => [],
      },
    );

    assert.equal(quote.priceMinMinor, 14500);
    assert.equal(quote.durationMinMinutes, 75);
  });
});
