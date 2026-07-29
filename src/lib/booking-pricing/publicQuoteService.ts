// ============================================================
// Public booking quote/config service
//
// Shared application layer for the public pricing-config and quote
// endpoints. Resolves the tenant-aware service context, loads active
// option groups/options, and delegates calculation to the pure
// calculateBookingQuote function.
//
// Fail-closed: never trusts client-supplied prices, durations, labels,
// modes, or currencies. Only option IDs are accepted from the client.
// ============================================================

import { getBookingServiceContext } from '../booking-service/queries';
import { BookingServiceError } from '../booking-service/types';
import type { BookingServiceContext } from '../booking-service/types';
import { calculateBookingQuote } from './calculateBookingQuote';
import { loadBookingServiceOptions } from './queries';
import { loadBookingServiceIntakeFields } from '../booking-intake/queries';
import { resolveIntakeOptions } from './intakeOptionResolver';
import { validateBookingIntake } from '../booking-intake/validateBookingIntake';
import { BookingPricingError } from './types';
import type {
  BookingServiceOption,
  BookingServiceOptionGroup,
  PricingMode,
  PublicOptionConfig,
  PublicOptionGroupConfig,
  PublicPricingConfig,
  PublicQuoteResponse,
  PublicSelectedOption,
  SelectedOptionQuote,
} from './types';
import type {
  BookingIntakeData,
  BookingServiceIntakeField,
  PublicIntakeField,
} from '../booking-intake/types';

export class PublicQuoteServiceError extends Error {
  readonly code:
    | 'service_unavailable'
    | 'invalid_request'
    | 'invalid_intake'
    | 'invalid_selection';

  constructor(
    code:
      | 'service_unavailable'
      | 'invalid_request'
      | 'invalid_intake'
      | 'invalid_selection',
    message: string,
  ) {
    super(message);
    this.name = 'PublicQuoteServiceError';
    this.code = code;
  }
}

export interface PublicQuoteServiceDeps {
  loadServiceContext: (siteSlug: string, serviceSlug: string) => Promise<BookingServiceContext>;
  loadOptions: (siteId: string, serviceId: string) => Promise<{
    groups: BookingServiceOptionGroup[];
    options: BookingServiceOption[];
  }>;
  loadIntakeFields: (siteId: string, serviceId: string) => Promise<
    import('../booking-intake/types').BookingServiceIntakeField[]
  >;
}

const defaultDeps: PublicQuoteServiceDeps = {
  loadServiceContext: getBookingServiceContext,
  loadOptions: loadBookingServiceOptions,
  loadIntakeFields: loadBookingServiceIntakeFields,
};

const UUID_REGEX =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

function isSelectionErrorCode(code: string): boolean {
  return [
    'unknown_option_id',
    'duplicate_option_id',
    'inactive_option',
    'inactive_group',
    'option_service_mismatch',
    'group_service_mismatch',
    'missing_group_configuration',
    'min_selections_not_met',
    'max_selections_exceeded',
    'single_group_too_many',
    'required_group_not_met',
    'invalid_calculated_duration',
    'negative_price',
    'price_overflow',
  ].includes(code);
}

function isConfigErrorCode(code: string): boolean {
  return [
    'option_groups_load_failed',
    'options_load_failed',
    'inconsistent_options',
    'invalid_pricing_mode',
    'invalid_currency',
    'invalid_base_duration',
    'invalid_base_price',
  ].includes(code);
}

function assertSlugs(siteSlug: string, serviceSlug: string): void {
  if (!siteSlug || !serviceSlug) {
    throw new PublicQuoteServiceError(
      'service_unavailable',
      'Service lookup failed',
    );
  }
}

function validateOptionIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new PublicQuoteServiceError(
      'invalid_request',
      'optionIds must be an array',
    );
  }

  if (value.length > 20) {
    throw new PublicQuoteServiceError(
      'invalid_request',
      'optionIds must contain at most 20 items',
    );
  }

  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !UUID_REGEX.test(item)) {
      throw new PublicQuoteServiceError(
        'invalid_request',
        'Each optionId must be a valid UUID',
      );
    }
    ids.push(item);
  }

  return ids;
}

async function resolvePublicService(
  siteSlug: string,
  serviceSlug: string,
  loadServiceContext: PublicQuoteServiceDeps['loadServiceContext'],
): Promise<BookingServiceContext> {
  assertSlugs(siteSlug, serviceSlug);

  try {
    const service = await loadServiceContext(siteSlug, serviceSlug);

    if (!service.publicBookingEnabled) {
      throw new PublicQuoteServiceError(
        'service_unavailable',
        'Public booking is not enabled for this service',
      );
    }

    return service;
  } catch (err) {
    if (err instanceof PublicQuoteServiceError) {
      throw err;
    }

    if (err instanceof BookingServiceError) {
      throw new PublicQuoteServiceError(
        'service_unavailable',
        'Service lookup failed',
      );
    }

    throw new PublicQuoteServiceError(
      'service_unavailable',
      'Service lookup failed',
    );
  }
}

async function loadTenantOptions(
  service: BookingServiceContext,
  loadOptions: PublicQuoteServiceDeps['loadOptions'],
): Promise<{ groups: BookingServiceOptionGroup[]; options: BookingServiceOption[] }> {
  try {
    return await loadOptions(service.siteId, service.serviceId);
  } catch (err) {
    if (err instanceof PublicQuoteServiceError) {
      throw err;
    }

    throw new PublicQuoteServiceError(
      'service_unavailable',
      'Failed to load pricing configuration',
    );
  }
}

function mapPublicOption(option: BookingServiceOption): PublicOptionConfig {
  return {
    id: option.id,
    slug: option.slug,
    label: option.label,
    priceDeltaMinor: option.priceDeltaMinor,
    priceDeltaMaxMinor: option.priceDeltaMaxMinor,
    durationDeltaMinutes: option.durationDeltaMinutes,
    durationDeltaMaxMinutes: option.durationDeltaMaxMinutes,
  };
}

function mapPublicOptionGroup(
  group: BookingServiceOptionGroup,
  options: BookingServiceOption[],
): PublicOptionGroupConfig | null {
  const groupOptions = options
    .filter((option) => option.optionGroupId === group.id && option.isActive)
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }
      return a.id.localeCompare(b.id);
    })
    .map(mapPublicOption);

  if (groupOptions.length === 0) {
    return null;
  }

  return {
    slug: group.slug,
    label: group.label,
    selectionMode: group.selectionMode,
    isRequired: group.isRequired,
    minSelections: group.minSelections,
    maxSelections: group.maxSelections,
    options: groupOptions,
  };
}

function mapPublicIntakeField(
  field: import('../booking-intake/types').BookingServiceIntakeField,
): PublicIntakeField {
  return {
    slug: field.slug,
    label: field.label,
    fieldType: field.fieldType,
    isRequired: field.isRequired,
    minLength: field.minLength,
    maxLength: field.maxLength,
    minValue: field.minValue,
    maxValue: field.maxValue,
    minSelections: field.minSelections,
    maxSelections: field.maxSelections,
    options: field.options
      .filter((o) => o.isActive)
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder;
        }
        return a.id.localeCompare(b.id);
      })
      .map((o) => ({ slug: o.slug, label: o.label })),
  };
}

function buildPublicPricingConfig(
  service: BookingServiceContext,
  groups: BookingServiceOptionGroup[],
  options: BookingServiceOption[],
  intakeFields: import('../booking-intake/types').BookingServiceIntakeField[],
): PublicPricingConfig {
  const activeGroups = groups
    .filter((group) => group.isActive)
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }
      return a.id.localeCompare(b.id);
    })
    .map((group) => mapPublicOptionGroup(group, options))
    .filter((group): group is PublicOptionGroupConfig => group !== null);

  const activeIntakeFields = intakeFields
    .filter((field) => field.isActive)
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }
      return a.id.localeCompare(b.id);
    })
    .map(mapPublicIntakeField);

  return {
    service: {
      slug: service.serviceSlug,
      name: service.serviceName,
      pricingMode: service.pricingMode as PricingMode,
      basePriceMinor: service.basePriceMinor,
      basePriceMaxMinor: service.basePriceMaxMinor,
      currency: service.currency,
      baseDurationMinutes: service.durationMinutes,
      baseDurationMaxMinutes: service.maxDurationMinutes,
    },
    optionGroups: activeGroups,
    intakeFields: activeIntakeFields,
  };
}

function mapPublicSelectedOption(
  selected: SelectedOptionQuote,
): PublicSelectedOption {
  return {
    id: selected.optionId,
    groupSlug: selected.groupSlug,
    optionSlug: selected.optionSlug,
    label: selected.label,
    priceDeltaMinor: selected.priceDeltaMinor,
    priceDeltaMaxMinor: selected.priceDeltaMaxMinor,
    durationDeltaMinutes: selected.durationDeltaMinutes,
    durationDeltaMaxMinutes: selected.durationDeltaMaxMinutes,
  };
}

function buildPublicQuoteResponse(quote: ReturnType<typeof calculateBookingQuote>): PublicQuoteResponse {
  return {
    priceMinMinor: quote.priceMinMinor,
    priceMaxMinor: quote.priceMaxMinor,
    currency: quote.currency,
    priceMode: quote.priceMode,
    durationMinMinutes: quote.durationMinMinutes,
    durationMaxMinutes: quote.durationMaxMinutes,
    selectedOptions: quote.selectedOptions.map(mapPublicSelectedOption),
  };
}

function handleBookingPricingError(err: BookingPricingError): never {
  if (isSelectionErrorCode(err.code)) {
    throw new PublicQuoteServiceError(
      'invalid_selection',
      'The selected options are invalid',
    );
  }

  if (isConfigErrorCode(err.code)) {
    throw new PublicQuoteServiceError(
      'service_unavailable',
      'Pricing configuration error',
    );
  }

  throw new PublicQuoteServiceError(
    'service_unavailable',
    'Pricing calculation failed',
  );
}

/**
 * Calculate a server-side quote for an already-resolved service context and
 * the option IDs selected by the client.
 *
 * This is the single quote entry point used by public endpoints and by
 * internal booking/reschedule flows. It never trusts client-supplied prices,
 * durations, labels, modes, or currencies.
 *
 * @throws PublicQuoteServiceError with code 'invalid_request' for malformed
 *         input, 'invalid_selection' for option/selection rule violations,
 *         or 'service_unavailable' for config failures.
 */
function looksLikeDeps(
  value: unknown,
): value is Partial<PublicQuoteServiceDeps> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.loadOptions === 'function' ||
    typeof candidate.loadServiceContext === 'function' ||
    typeof candidate.loadIntakeFields === 'function'
  );
}

export async function calculateQuoteForService(
  service: BookingServiceContext,
  rawOptionIds: unknown,
  intakeDataOrDeps: BookingIntakeData | Partial<Pick<PublicQuoteServiceDeps, 'loadOptions' | 'loadIntakeFields'>> = {},
  maybeDeps: Partial<Pick<PublicQuoteServiceDeps, 'loadOptions' | 'loadIntakeFields'>> = {},
  mode: 'partial' | 'complete' = 'complete',
): Promise<PublicQuoteResponse> {
  const optionIds = validateOptionIds(rawOptionIds);
  const deps = looksLikeDeps(intakeDataOrDeps) ? intakeDataOrDeps : maybeDeps;
  const intakeData = looksLikeDeps(intakeDataOrDeps)
    ? {}
    : (intakeDataOrDeps as BookingIntakeData);
  const { loadOptions, loadIntakeFields } = { ...defaultDeps, ...deps };

  const { groups, options } = await loadTenantOptions(service, loadOptions);

  // Load intake fields when the service has a dog-size option group (used for
  // weight→size mapping) or when the client sent any intake data that must be
  // validated against the server-owned contract.
  const hasSizeGroup = groups.some(
    (g) => g.isActive && g.slug === 'dog-size',
  );
  const hasIntakeData = Object.keys(intakeData).length > 0;
  let fields: BookingServiceIntakeField[] = [];
  if (hasSizeGroup || hasIntakeData) {
    fields = await loadIntakeFields(service.siteId, service.serviceId);
  }

  if (hasIntakeData) {
    const validation = validateBookingIntake(intakeData, fields);
    if ('code' in validation) {
      throw new PublicQuoteServiceError(
        'invalid_intake',
        'Invalid intake data for pricing.',
      );
    }
  }

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
      resolution.error === 'invalid_intake'
        ? 'Invalid intake data for pricing.'
        : 'Invalid option selection.',
    );
  }

  try {
    const quote = calculateBookingQuote({
      service,
      groups,
      options,
      selectedOptionIds: resolution.optionIds,
      mode,
    });

    return buildPublicQuoteResponse(quote);
  } catch (err) {
    if (err instanceof PublicQuoteServiceError) {
      throw err;
    }

    if (err instanceof BookingPricingError) {
      handleBookingPricingError(err);
    }

    throw new PublicQuoteServiceError(
      'service_unavailable',
      'Pricing calculation failed',
    );
  }
}

/**
 * Load the public pricing configuration for a site/service slug pair.
 *
 * @throws PublicQuoteServiceError with code 'service_unavailable' on any
 *         lookup or config failure.
 */
export async function getPublicPricingConfig(
  siteSlug: string,
  serviceSlug: string,
  deps: Partial<PublicQuoteServiceDeps> = {},
): Promise<PublicPricingConfig> {
  const { loadServiceContext, loadOptions, loadIntakeFields } = {
    ...defaultDeps,
    ...deps,
  };

  const service = await resolvePublicService(
    siteSlug,
    serviceSlug,
    loadServiceContext,
  );
  const { groups, options } = await loadTenantOptions(service, loadOptions);
  const intakeFields = await loadIntakeFields(service.siteId, service.serviceId);

  return buildPublicPricingConfig(service, groups, options, intakeFields);
}

/**
 * Calculate a public quote for a site/service slug pair and the option IDs
 * selected by the client.
 *
 * @throws PublicQuoteServiceError with code 'invalid_request' for malformed
 *         input, 'invalid_selection' for option/selection rule violations,
 *         or 'service_unavailable' for lookup/config failures.
 */
export async function getPublicQuote(
  siteSlug: string,
  serviceSlug: string,
  rawOptionIds: unknown,
  intakeDataOrDeps: BookingIntakeData | Partial<PublicQuoteServiceDeps> = {},
  maybeDeps: Partial<PublicQuoteServiceDeps> = {},
  mode: 'partial' | 'complete' = 'complete',
): Promise<PublicQuoteResponse> {
  const deps = looksLikeDeps(intakeDataOrDeps) ? intakeDataOrDeps : maybeDeps;
  const intakeData = looksLikeDeps(intakeDataOrDeps)
    ? {}
    : (intakeDataOrDeps as BookingIntakeData);
  const { loadServiceContext } = { ...defaultDeps, ...deps };

  const service = await resolvePublicService(
    siteSlug,
    serviceSlug,
    loadServiceContext,
  );

  return calculateQuoteForService(service, rawOptionIds, intakeData, deps, mode);
}
