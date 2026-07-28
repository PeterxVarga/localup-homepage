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
} from './types';

export class PublicQuoteServiceError extends Error {
  readonly code: 'service_unavailable' | 'invalid_request' | 'invalid_selection';

  constructor(
    code: 'service_unavailable' | 'invalid_request' | 'invalid_selection',
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
}

const defaultDeps: PublicQuoteServiceDeps = {
  loadServiceContext: getBookingServiceContext,
  loadOptions: loadBookingServiceOptions,
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
    durationDeltaMinutes: option.durationDeltaMinutes,
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

function buildPublicPricingConfig(
  service: BookingServiceContext,
  groups: BookingServiceOptionGroup[],
  options: BookingServiceOption[],
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

  return {
    service: {
      slug: service.serviceSlug,
      name: service.serviceName,
      pricingMode: service.pricingMode as PricingMode,
      basePriceMinor: service.basePriceMinor,
      currency: service.currency,
      baseDurationMinutes: service.durationMinutes,
    },
    optionGroups: activeGroups,
  };
}

function mapPublicSelectedOption(
  selected: { optionId: string; groupSlug: string; optionSlug: string; label: string; priceDeltaMinor: number; durationDeltaMinutes: number },
): PublicSelectedOption {
  return {
    id: selected.optionId,
    groupSlug: selected.groupSlug,
    optionSlug: selected.optionSlug,
    label: selected.label,
    priceDeltaMinor: selected.priceDeltaMinor,
    durationDeltaMinutes: selected.durationDeltaMinutes,
  };
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
  const { loadServiceContext, loadOptions } = { ...defaultDeps, ...deps };

  const service = await resolvePublicService(
    siteSlug,
    serviceSlug,
    loadServiceContext,
  );
  const { groups, options } = await loadTenantOptions(service, loadOptions);

  return buildPublicPricingConfig(service, groups, options);
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
  deps: Partial<PublicQuoteServiceDeps> = {},
): Promise<PublicQuoteResponse> {
  const optionIds = validateOptionIds(rawOptionIds);
  const { loadServiceContext, loadOptions } = { ...defaultDeps, ...deps };

  const service = await resolvePublicService(
    siteSlug,
    serviceSlug,
    loadServiceContext,
  );
  const { groups, options } = await loadTenantOptions(service, loadOptions);

  try {
    const quote = calculateBookingQuote({
      service,
      groups,
      options,
      selectedOptionIds: optionIds,
    });

    return {
      priceMinor: quote.priceMinor,
      currency: quote.currency,
      priceMode: quote.priceMode,
      durationMinutes: quote.durationMinutes,
      selectedOptions: quote.selectedOptions.map(mapPublicSelectedOption),
    };
  } catch (err) {
    if (err instanceof PublicQuoteServiceError) {
      throw err;
    }

    if (err instanceof BookingPricingError) {
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

    throw new PublicQuoteServiceError(
      'service_unavailable',
      'Pricing calculation failed',
    );
  }
}
