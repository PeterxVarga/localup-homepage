// ============================================================
// Booking pricing — pure range quote calculator
//
// The calculator is a pure function: it reads no database, writes no
// booking, calls no calendar/email, and trusts no client-supplied labels,
// prices, durations, or modes. The caller may only pass option IDs.
//
// Every quote returns a min/max price and duration range. For fixed
// pricing the contract requires priceMin === priceMax. Duration may still
// be a range because a fixed price does not imply a fixed duration.
// ============================================================

import type {
  BookingQuote,
  BookingQuoteInput,
  BookingServiceOption,
  BookingServiceOptionGroup,
  PricingMode,
  SelectedOptionQuote,
} from './types';
import { BookingPricingError } from './types';

const MIN_DURATION_MINUTES = 5;
const MAX_DURATION_MINUTES = 480;
const DURATION_STEP_MINUTES = 5;

function assertServiceContract(service: BookingQuoteInput['service']): void {
  if (service.pricingMode !== 'fixed' && service.pricingMode !== 'estimated') {
    throw new BookingPricingError(
      `Invalid service pricing mode: ${service.pricingMode}`,
      'invalid_pricing_mode',
    );
  }

  if (!service.currency || !/^[A-Z]{3}$/.test(service.currency)) {
    throw new BookingPricingError(
      `Invalid service currency: ${service.currency}`,
      'invalid_currency',
    );
  }

  if (
    !Number.isInteger(service.durationMinutes) ||
    service.durationMinutes < MIN_DURATION_MINUTES ||
    service.durationMinutes > MAX_DURATION_MINUTES ||
    service.durationMinutes % DURATION_STEP_MINUTES !== 0
  ) {
    throw new BookingPricingError(
      `Invalid service base duration: ${service.durationMinutes}`,
      'invalid_base_duration',
    );
  }

  if (service.maxDurationMinutes !== null) {
    if (
      !Number.isInteger(service.maxDurationMinutes) ||
      service.maxDurationMinutes < MIN_DURATION_MINUTES ||
      service.maxDurationMinutes > MAX_DURATION_MINUTES ||
      service.maxDurationMinutes % DURATION_STEP_MINUTES !== 0 ||
      service.maxDurationMinutes < service.durationMinutes
    ) {
      throw new BookingPricingError(
        `Invalid service max duration: ${service.maxDurationMinutes}`,
        'invalid_base_duration',
      );
    }
  }

  if (
    service.basePriceMinor !== null &&
    (!Number.isSafeInteger(service.basePriceMinor) || service.basePriceMinor < 0)
  ) {
    throw new BookingPricingError(
      `Invalid service base price: ${service.basePriceMinor}`,
      'invalid_base_price',
    );
  }

  if (
    service.basePriceMaxMinor !== null &&
    (!Number.isSafeInteger(service.basePriceMaxMinor) ||
      service.basePriceMaxMinor < 0 ||
      (service.basePriceMinor !== null &&
        service.basePriceMaxMinor < service.basePriceMinor))
  ) {
    throw new BookingPricingError(
      `Invalid service base max price: ${service.basePriceMaxMinor}`,
      'invalid_base_price',
    );
  }

  if (service.pricingMode === 'fixed') {
    if (
      service.basePriceMaxMinor !== null &&
      service.basePriceMinor !== null &&
      service.basePriceMaxMinor !== service.basePriceMinor
    ) {
      throw new BookingPricingError(
        'Fixed pricing requires basePriceMinor === basePriceMaxMinor',
        'invalid_fixed_price_range',
      );
    }
  }
}

function validateNoDuplicateOptionIds(selectedOptionIds: string[]): void {
  const seen = new Set<string>();
  for (const id of selectedOptionIds) {
    if (seen.has(id)) {
      throw new BookingPricingError(
        `Duplicate option ID: ${id}`,
        'duplicate_option_id',
      );
    }
    seen.add(id);
  }
}

function buildOptionMap(
  options: BookingServiceOption[],
): Map<string, BookingServiceOption> {
  const map = new Map<string, BookingServiceOption>();
  for (const option of options) {
    map.set(option.id, option);
  }
  return map;
}

function buildGroupMap(
  groups: BookingServiceOptionGroup[],
): Map<string, BookingServiceOptionGroup> {
  const map = new Map<string, BookingServiceOptionGroup>();
  for (const group of groups) {
    map.set(group.id, group);
  }
  return map;
}

function resolveSelectedOptions(
  selectedOptionIds: string[],
  optionMap: Map<string, BookingServiceOption>,
  groupMap: Map<string, BookingServiceOptionGroup>,
  serviceSiteId: string,
  serviceId: string,
): BookingServiceOption[] {
  const selected: BookingServiceOption[] = [];

  for (const optionId of selectedOptionIds) {
    const option = optionMap.get(optionId);

    if (!option) {
      throw new BookingPricingError(
        `Unknown option ID: ${optionId}`,
        'unknown_option_id',
      );
    }

    if (!option.isActive) {
      throw new BookingPricingError(
        `Inactive option selected: ${optionId}`,
        'inactive_option',
      );
    }

    if (option.siteId !== serviceSiteId || option.serviceId !== serviceId) {
      throw new BookingPricingError(
        `Option ${optionId} does not belong to the requested service/site`,
        'option_service_mismatch',
      );
    }

    const group = groupMap.get(option.optionGroupId);

    if (!group) {
      throw new BookingPricingError(
        `Missing or inactive group for option ${optionId}`,
        'missing_group_configuration',
      );
    }

    if (!group.isActive) {
      throw new BookingPricingError(
        `Inactive group selected: ${group.id}`,
        'inactive_group',
      );
    }

    if (
      group.siteId !== serviceSiteId ||
      group.serviceId !== serviceId ||
      group.id !== option.optionGroupId
    ) {
      throw new BookingPricingError(
        `Group ${group.id} does not belong to the requested service/site`,
        'group_service_mismatch',
      );
    }

    selected.push(option);
  }

  return selected;
}

function validateGroupSelections(
  groups: BookingServiceOptionGroup[],
  selectedByGroupId: Map<string, BookingServiceOption[]>,
  mode: 'partial' | 'complete',
): void {
  for (const group of groups) {
    if (!group.isActive) {
      continue;
    }

    const selected = selectedByGroupId.get(group.id) ?? [];
    const count = selected.length;

    // Partial mode lets the user progress step-by-step. A group that has no
    // selection yet is simply skipped; once it has any selection, the same
    // structural rules (single/max/min) apply as in complete mode.
    if (mode === 'partial' && count === 0) {
      continue;
    }

    if (group.selectionMode === 'single') {
      if (count > 1) {
        throw new BookingPricingError(
          `Single-selection group ${group.slug} accepts at most one option`,
          'single_group_too_many',
        );
      }

      if (mode === 'complete' && group.isRequired && count < 1) {
        throw new BookingPricingError(
          `Required single-selection group ${group.slug} needs one option`,
          'required_group_not_met',
        );
      }
    }

    if (count < group.minSelections) {
      throw new BookingPricingError(
        `Group ${group.slug} requires at least ${group.minSelections} selection(s)`,
        'min_selections_not_met',
      );
    }

    if (count > group.maxSelections) {
      throw new BookingPricingError(
        `Group ${group.slug} accepts at most ${group.maxSelections} selection(s)`,
        'max_selections_exceeded',
      );
    }
  }
}

function validateOptionRangeContract(
  selected: BookingServiceOption[],
  pricingMode: PricingMode,
): void {
  if (pricingMode !== 'fixed') {
    return;
  }

  for (const option of selected) {
    if (
      option.priceDeltaMaxMinor !== null &&
      option.priceDeltaMaxMinor !== option.priceDeltaMinor
    ) {
      throw new BookingPricingError(
        `Fixed pricing requires option ${option.id} priceDeltaMaxMinor === priceDeltaMinor`,
        'invalid_fixed_price_range',
      );
    }
  }
}

function buildSelectedOptionsQuote(
  selected: BookingServiceOption[],
  groupMap: Map<string, BookingServiceOptionGroup>,
): SelectedOptionQuote[] {
  const withGroup = selected.map((option) => {
    const group = groupMap.get(option.optionGroupId);
    if (!group) {
      throw new BookingPricingError(
        `Missing group for option ${option.id}`,
        'missing_group_configuration',
      );
    }

    return {
      option,
      group,
    };
  });

  withGroup.sort((a, b) => {
    if (a.group.sortOrder !== b.group.sortOrder) {
      return a.group.sortOrder - b.group.sortOrder;
    }
    if (a.option.sortOrder !== b.option.sortOrder) {
      return a.option.sortOrder - b.option.sortOrder;
    }
    return a.option.id.localeCompare(b.option.id);
  });

  return withGroup.map(({ option, group }) => ({
    optionId: option.id,
    groupId: group.id,
    groupSlug: group.slug,
    optionSlug: option.slug,
    label: option.label,
    priceDeltaMinor: option.priceDeltaMinor,
    priceDeltaMaxMinor: option.priceDeltaMaxMinor,
    durationDeltaMinutes: option.durationDeltaMinutes,
    durationDeltaMaxMinutes: option.durationDeltaMaxMinutes,
  }));
}

function validateDuration(value: number): void {
  if (
    !Number.isInteger(value) ||
    value < MIN_DURATION_MINUTES ||
    value > MAX_DURATION_MINUTES ||
    value % DURATION_STEP_MINUTES !== 0
  ) {
    throw new BookingPricingError(
      `Calculated duration ${value} is outside the allowed range or not a multiple of ${DURATION_STEP_MINUTES}`,
      'invalid_calculated_duration',
    );
  }
}

function calculateFinalDurationRange(
  baseDurationMinutes: number,
  baseMaxDurationMinutes: number | null,
  selected: BookingServiceOption[],
): { durationMinMinutes: number; durationMaxMinutes: number } {
  const durationMinMinutes = selected.reduce(
    (sum, option) => sum + option.durationDeltaMinutes,
    baseDurationMinutes,
  );

  const durationMaxMinutes = selected.reduce(
    (sum, option) => sum + (option.durationDeltaMaxMinutes ?? option.durationDeltaMinutes),
    baseMaxDurationMinutes ?? baseDurationMinutes,
  );

  validateDuration(durationMinMinutes);
  validateDuration(durationMaxMinutes);

  if (durationMaxMinutes < durationMinMinutes) {
    throw new BookingPricingError(
      `Calculated max duration ${durationMaxMinutes} is less than min duration ${durationMinMinutes}`,
      'invalid_calculated_duration',
    );
  }

  return { durationMinMinutes, durationMaxMinutes };
}

function validatePriceValue(value: number, currency: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new BookingPricingError(
      'Calculated price exceeds safe integer range',
      'price_overflow',
    );
  }

  if (value < 0) {
    throw new BookingPricingError(
      `Calculated price ${value} ${currency} is negative`,
      'negative_price',
    );
  }

  return value;
}

function calculateFinalPriceRange(
  basePriceMinor: number | null,
  basePriceMaxMinor: number | null,
  selected: BookingServiceOption[],
  currency: string,
): { priceMinMinor: number | null; priceMaxMinor: number | null } {
  if (basePriceMinor === null) {
    if (basePriceMaxMinor !== null) {
      throw new BookingPricingError(
        'basePriceMaxMinor cannot be set when basePriceMinor is null',
        'invalid_base_price',
      );
    }
    return { priceMinMinor: null, priceMaxMinor: null };
  }

  const minDeltaSum = selected.reduce((sum, option) => {
    const next = sum + option.priceDeltaMinor;
    if (!Number.isSafeInteger(next)) {
      throw new BookingPricingError(
        'Price delta sum exceeds safe integer range',
        'price_overflow',
      );
    }
    return next;
  }, 0);

  const maxDeltaSum = selected.reduce((sum, option) => {
    const delta = option.priceDeltaMaxMinor ?? option.priceDeltaMinor;
    const next = sum + delta;
    if (!Number.isSafeInteger(next)) {
      throw new BookingPricingError(
        'Price delta sum exceeds safe integer range',
        'price_overflow',
      );
    }
    return next;
  }, 0);

  const effectiveBaseMax = basePriceMaxMinor ?? basePriceMinor;

  const priceMinMinor = validatePriceValue(
    basePriceMinor + minDeltaSum,
    currency,
  );
  const priceMaxMinor = validatePriceValue(
    effectiveBaseMax + maxDeltaSum,
    currency,
  );

  if (priceMaxMinor < priceMinMinor) {
    throw new BookingPricingError(
      `Calculated max price ${priceMaxMinor} is less than min price ${priceMinMinor}`,
      'negative_price',
    );
  }

  return { priceMinMinor, priceMaxMinor };
}

/**
 * Calculate a deterministic booking quote from a service context,
 * active option groups, active options, and the option IDs selected
 * by the client.
 *
 * The client may only submit option IDs. Prices, durations, labels,
 * modes, and currencies are always taken from the trusted service
 * configuration loaded by the server.
 */
export function calculateBookingQuote(
  input: BookingQuoteInput,
): BookingQuote {
  const { service, groups, options, selectedOptionIds, mode = 'complete' } = input;

  assertServiceContract(service);
  validateNoDuplicateOptionIds(selectedOptionIds);

  const optionMap = buildOptionMap(options);
  const groupMap = buildGroupMap(groups);

  const selected = resolveSelectedOptions(
    selectedOptionIds,
    optionMap,
    groupMap,
    service.siteId,
    service.serviceId,
  );

  const selectedByGroupId = new Map<string, BookingServiceOption[]>();
  for (const option of selected) {
    const list = selectedByGroupId.get(option.optionGroupId) ?? [];
    list.push(option);
    selectedByGroupId.set(option.optionGroupId, list);
  }

  validateGroupSelections(groups, selectedByGroupId, mode);
  validateOptionRangeContract(selected, service.pricingMode);

  const selectedOptions = buildSelectedOptionsQuote(selected, groupMap);
  const { durationMinMinutes, durationMaxMinutes } = calculateFinalDurationRange(
    service.durationMinutes,
    service.maxDurationMinutes,
    selected,
  );
  const { priceMinMinor, priceMaxMinor } = calculateFinalPriceRange(
    service.basePriceMinor,
    service.basePriceMaxMinor,
    selected,
    service.currency,
  );

  if (service.pricingMode === 'fixed' && priceMinMinor !== priceMaxMinor) {
    throw new BookingPricingError(
      'Fixed pricing requires calculated priceMin === priceMax',
      'invalid_fixed_price_range',
    );
  }

  return {
    priceMinMinor,
    priceMaxMinor,
    currency: service.currency,
    priceMode: service.pricingMode as PricingMode,
    durationMinMinutes,
    durationMaxMinutes,
    selectedOptions,
  };
}
