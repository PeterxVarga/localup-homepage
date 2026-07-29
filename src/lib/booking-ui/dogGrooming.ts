import type { BookingIntakeData } from '../booking-intake/types';
import type {
  PublicPricingConfig,
  PublicQuoteResponse,
} from '../booking-pricing/types';

export type DogServiceSlug =
  | 'bath-and-brush'
  | 'full-grooming'
  | 'trimming-special-care';

export interface DogServiceCard {
  slug: DogServiceSlug;
  name: string;
  description: string;
  eyebrow?: string;
  icon: string;
  visual: string;
  accent: 'orange' | 'lilac' | 'rose';
}

export interface BookingSlot {
  start: string;
  end: string;
}

export interface BookingDay {
  date: string;
  dayName?: string;
  slots: BookingSlot[];
}

export const DOG_SERVICES: DogServiceCard[] = [
  {
    slug: 'bath-and-brush',
    name: 'Fürdetés és szőrápolás',
    description: 'Fürdetés, szárítás és kifésülés.',
    icon: '♨',
    visual: '🛁',
    accent: 'orange',
  },
  {
    slug: 'full-grooming',
    name: 'Teljes kutyakozmetika',
    description: 'Teljes ápolás és személyre szabott fazon.',
    eyebrow: 'Leggyakoribb',
    icon: '✦',
    visual: '🐕',
    accent: 'lilac',
  },
  {
    slug: 'trimming-special-care',
    name: 'Trimmelés és speciális ápolás',
    description: 'Speciális kezelés szőrtípus szerint.',
    icon: '≋',
    visual: '✂️',
    accent: 'rose',
  },
];

const uuid = (prefix: string, suffix: string) =>
  `${prefix}-1111-4111-8111-${suffix.padStart(12, '0')}`;

const serviceBase: Record<
  DogServiceSlug,
  {
    priceMin: number;
    priceMax: number;
    durationMin: number;
    durationMax: number;
  }
> = {
  'bath-and-brush': {
    priceMin: 12900,
    priceMax: 15900,
    durationMin: 45,
    durationMax: 75,
  },
  'full-grooming': {
    priceMin: 14900,
    priceMax: 17900,
    durationMin: 90,
    durationMax: 120,
  },
  'trimming-special-care': {
    priceMin: 16900,
    priceMax: 20900,
    durationMin: 90,
    durationMax: 150,
  },
};

const option = (
  id: string,
  slug: string,
  label: string,
  priceDeltaMinor: number,
  priceDeltaMaxMinor: number,
  durationDeltaMinutes: number,
  durationDeltaMaxMinutes: number,
) => ({
  id,
  slug,
  label,
  priceDeltaMinor,
  priceDeltaMaxMinor,
  durationDeltaMinutes,
  durationDeltaMaxMinutes,
});

export function createMockPricingConfig(
  serviceSlug: DogServiceSlug,
): PublicPricingConfig {
  const service = DOG_SERVICES.find((item) => item.slug === serviceSlug)!;
  const base = serviceBase[serviceSlug];
  const prefix =
    serviceSlug === 'full-grooming'
      ? 'd7111111'
      : serviceSlug === 'bath-and-brush'
        ? 'd8111111'
        : 'd9111111';

  return {
    service: {
      slug: service.slug,
      name: service.name,
      pricingMode: 'estimated',
      basePriceMinor: base.priceMin,
      basePriceMaxMinor: base.priceMax,
      currency: 'HUF',
      baseDurationMinutes: base.durationMin,
      baseDurationMaxMinutes: base.durationMax,
    },
    optionGroups: [
      {
        slug: 'dog-size',
        label: 'A kutya mérete',
        selectionMode: 'single',
        isRequired: true,
        minSelections: 1,
        maxSelections: 1,
        options: [
          option(uuid(prefix, '121'), 'small', 'Kistestű, 0–10 kg', 0, 0, 0, 0),
          option(uuid(prefix, '122'), 'medium', 'Közepes, 11–25 kg', 3000, 4000, 15, 30),
          option(uuid(prefix, '123'), 'large', 'Nagytestű, 26–40 kg', 6000, 8000, 30, 45),
          option(uuid(prefix, '124'), 'extra-large', 'Óriástestű, 40 kg felett', 9000, 12000, 45, 60),
        ],
      },
      {
        slug: 'coat-condition',
        label: 'Szőrzet állapota',
        selectionMode: 'single',
        isRequired: true,
        minSelections: 1,
        maxSelections: 1,
        options: [
          option(uuid(prefix, '151'), 'maintained', 'Rendszeresen ápolt', 0, 0, 0, 0),
          option(uuid(prefix, '152'), 'slightly-matted', 'Kissé csomós', 2000, 3000, 20, 20),
          option(uuid(prefix, '153'), 'heavily-matted', 'Erősen csomós vagy filces', 5000, 8000, 40, 60),
          option(uuid(prefix, '154'), 'unknown', 'Nem tudom megítélni', 0, 3000, 0, 20),
        ],
      },
      {
        slug: 'desired-result',
        label: 'Kívánt eredmény',
        selectionMode: 'single',
        isRequired: true,
        minSelections: 1,
        maxSelections: 1,
        options: [
          option(uuid(prefix, '161'), 'light-trim', 'Csak egy kis igazítás', 0, 0, 0, 0),
          option(uuid(prefix, '162'), 'short-manageable', 'Rövidebb, könnyen kezelhető', 0, 0, 0, 0),
          option(uuid(prefix, '163'), 'breed-standard', 'Fajtának megfelelő fazon', 2000, 3000, 15, 30),
          option(uuid(prefix, '164'), 'groomer-choice', 'Rábízom a kozmetikusra', 0, 2000, 0, 15),
        ],
      },
      {
        slug: 'add-ons',
        label: 'Kiegészítő kezelések',
        selectionMode: 'multiple',
        isRequired: false,
        minSelections: 0,
        maxSelections: 3,
        options: [
          option(uuid(prefix, '131'), 'deshedding', 'Aljszőrkiszedés', 3000, 5000, 15, 30),
          option(uuid(prefix, '132'), 'teeth-cleaning', 'Fogtisztítás', 2500, 2500, 10, 10),
          option(uuid(prefix, '133'), 'paw-care', 'Mancsápolás', 2000, 2000, 10, 10),
        ],
      },
    ],
    intakeFields: [
      {
        slug: 'dog-name',
        label: 'Kutyus neve',
        fieldType: 'text',
        isRequired: true,
        minLength: 1,
        maxLength: 80,
        minValue: null,
        maxValue: null,
        minSelections: 0,
        maxSelections: 0,
        options: [],
      },
      {
        slug: 'dog-breed',
        label: 'Fajta',
        fieldType: 'text',
        isRequired: true,
        minLength: 2,
        maxLength: 100,
        minValue: null,
        maxValue: null,
        minSelections: 0,
        maxSelections: 0,
        options: [],
      },
      {
        slug: 'dog-weight-kg',
        label: 'Testsúly',
        fieldType: 'number',
        isRequired: false,
        minLength: 0,
        maxLength: 1,
        minValue: 1,
        maxValue: 100,
        minSelections: 0,
        maxSelections: 0,
        options: [],
      },
      {
        slug: 'dog-age-group',
        label: 'Életkor',
        fieldType: 'single_choice',
        isRequired: true,
        minLength: 1,
        maxLength: 1,
        minValue: null,
        maxValue: null,
        minSelections: 1,
        maxSelections: 1,
        options: [
          { slug: 'puppy', label: 'Kölyök' },
          { slug: 'adult', label: 'Felnőtt' },
          { slug: 'senior', label: 'Senior' },
        ],
      },
      {
        slug: 'care-considerations',
        label: 'Amire figyeljünk',
        fieldType: 'multiple_choice',
        isRequired: false,
        minLength: 0,
        maxLength: 1,
        minValue: null,
        maxValue: null,
        minSelections: 0,
        maxSelections: 5,
        options: [
          { slug: 'first-groom', label: 'Első kozmetika' },
          { slug: 'anxious', label: 'Félénk vagy nyugtalan' },
          { slug: 'sensitive-skin', label: 'Érzékeny bőr' },
          { slug: 'allergy', label: 'Allergia' },
          { slug: 'puppy-or-senior', label: 'Kölyök vagy senior' },
        ],
      },
      {
        slug: 'temperament-notes',
        label: 'Megjegyzés a kozmetikusnak',
        fieldType: 'textarea',
        isRequired: false,
        minLength: 0,
        maxLength: 120,
        minValue: null,
        maxValue: null,
        minSelections: 0,
        maxSelections: 0,
        options: [],
      },
    ],
  };
}

function sizeSlugFromWeight(weight: number): string {
  if (weight <= 10) return 'small';
  if (weight <= 25) return 'medium';
  if (weight <= 40) return 'large';
  return 'extra-large';
}

export function calculateMockQuote(
  config: PublicPricingConfig,
  selectedOptionIds: string[],
  intakeData: BookingIntakeData,
  complete = false,
): PublicQuoteResponse {
  const weight = intakeData['dog-weight-kg'];
  const sizeSlug =
    typeof weight === 'number' && Number.isFinite(weight)
      ? sizeSlugFromWeight(weight)
      : null;
  const selected = new Set(selectedOptionIds);

  if (sizeSlug) {
    const size = config.optionGroups
      .find((group) => group.slug === 'dog-size')
      ?.options.find((item) => item.slug === sizeSlug);
    if (size) selected.add(size.id);
  }

  if (complete) {
    for (const group of config.optionGroups.filter((item) => item.isRequired)) {
      const count = group.options.filter((item) => selected.has(item.id)).length;
      if (count < group.minSelections) {
        throw new Error('invalid_selection');
      }
    }
  }

  const selectedOptions = config.optionGroups.flatMap((group) =>
    group.options
      .filter((item) => selected.has(item.id))
      .map((item) => ({
        id: item.id,
        groupSlug: group.slug,
        optionSlug: item.slug,
        label: item.label,
        priceDeltaMinor: item.priceDeltaMinor,
        priceDeltaMaxMinor: item.priceDeltaMaxMinor,
        durationDeltaMinutes: item.durationDeltaMinutes,
        durationDeltaMaxMinutes: item.durationDeltaMaxMinutes,
      })),
  );

  const minPrice = config.service.basePriceMinor;
  const maxPrice = config.service.basePriceMaxMinor;

  return {
    priceMinMinor:
      minPrice === null
        ? null
        : minPrice +
          selectedOptions.reduce((sum, item) => sum + item.priceDeltaMinor, 0),
    priceMaxMinor:
      maxPrice === null
        ? null
        : maxPrice +
          selectedOptions.reduce(
            (sum, item) =>
              sum + (item.priceDeltaMaxMinor ?? item.priceDeltaMinor),
            0,
          ),
    currency: config.service.currency,
    priceMode: config.service.pricingMode,
    durationMinMinutes:
      config.service.baseDurationMinutes +
      selectedOptions.reduce((sum, item) => sum + item.durationDeltaMinutes, 0),
    durationMaxMinutes:
      (config.service.baseDurationMaxMinutes ??
        config.service.baseDurationMinutes) +
      selectedOptions.reduce(
        (sum, item) =>
          sum + (item.durationDeltaMaxMinutes ?? item.durationDeltaMinutes),
        0,
      ),
    selectedOptions,
  };
}

export function createMockSlots(
  durationMinutes: number,
  now = new Date(),
): BookingDay[] {
  const days: BookingDay[] = [];
  for (let offset = 1; offset <= 20 && days.length < 12; offset += 1) {
    const date = new Date(now);
    date.setDate(now.getDate() + offset);
    const weekday = date.getDay();
    if (weekday === 0) continue;

    const starts = weekday === 6 ? [10, 11.5, 12.5] : [9, 10.5, 12, 14.5, 16];
    const slots = starts.map((hour) => {
      const start = new Date(date);
      start.setHours(Math.floor(hour), hour % 1 ? 30 : 0, 0, 0);
      const end = new Date(start.getTime() + durationMinutes * 60_000);
      return { start: start.toISOString(), end: end.toISOString() };
    });

    days.push({
      date: date.toISOString().slice(0, 10),
      dayName: new Intl.DateTimeFormat('hu-HU', { weekday: 'long' }).format(date),
      slots,
    });
  }
  return days;
}

export function formatHuf(value: number | null): string {
  if (value === null) return 'Egyedi ár';
  return `${new Intl.NumberFormat('hu-HU').format(value)} Ft`;
}

export function formatQuotePrice(quote: PublicQuoteResponse | null): string {
  if (!quote || quote.priceMinMinor === null) return 'Egyedi ár';
  if (
    quote.priceMaxMinor === null ||
    quote.priceMaxMinor === quote.priceMinMinor
  ) {
    return formatHuf(quote.priceMinMinor);
  }
  return `${new Intl.NumberFormat('hu-HU').format(quote.priceMinMinor)}–${new Intl.NumberFormat('hu-HU').format(quote.priceMaxMinor)} Ft`;
}

export function formatQuoteDuration(
  quote: PublicQuoteResponse | null,
): string {
  if (!quote) return '—';
  if (quote.durationMinMinutes === quote.durationMaxMinutes) {
    return `${quote.durationMinMinutes} perc`;
  }
  return `${quote.durationMinMinutes}–${quote.durationMaxMinutes} perc`;
}
