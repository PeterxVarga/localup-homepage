// ============================================================
// Booking pricing — domain types
//
// Pure-domain types used by the configurable pricing calculator.
// No DB client or framework imports here.
// ============================================================

import type { BookingServiceContext } from '../booking-service/types';

export type PricingMode = 'fixed' | 'estimated';
export type SelectionMode = 'single' | 'multiple';

export interface BookingServiceOptionGroup {
  id: string;
  siteId: string;
  serviceId: string;
  slug: string;
  label: string;
  selectionMode: SelectionMode;
  isRequired: boolean;
  minSelections: number;
  maxSelections: number;
  sortOrder: number;
  isActive: boolean;
}

export interface BookingServiceOption {
  id: string;
  siteId: string;
  serviceId: string;
  optionGroupId: string;
  slug: string;
  label: string;
  priceDeltaMinor: number;
  priceDeltaMaxMinor: number | null;
  durationDeltaMinutes: number;
  durationDeltaMaxMinutes: number | null;
  sortOrder: number;
  isActive: boolean;
}

export interface SelectedOptionQuote {
  optionId: string;
  groupId: string;
  groupSlug: string;
  optionSlug: string;
  label: string;
  priceDeltaMinor: number;
  priceDeltaMaxMinor: number | null;
  durationDeltaMinutes: number;
  durationDeltaMaxMinutes: number | null;
}

export interface BookingQuote {
  priceMinMinor: number | null;
  priceMaxMinor: number | null;
  currency: string;
  priceMode: PricingMode;
  durationMinMinutes: number;
  durationMaxMinutes: number;
  selectedOptions: SelectedOptionQuote[];
}

export interface BookingQuoteInput {
  service: BookingServiceContext;
  groups: BookingServiceOptionGroup[];
  options: BookingServiceOption[];
  selectedOptionIds: string[];
}

export class BookingPricingError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'BookingPricingError';
    this.code = code;
  }
}

export type BookingServiceContextWithPricing = BookingServiceContext;

export interface PublicServiceConfig {
  slug: string;
  name: string;
  pricingMode: PricingMode;
  basePriceMinor: number | null;
  basePriceMaxMinor: number | null;
  currency: string;
  baseDurationMinutes: number;
  baseDurationMaxMinutes: number | null;
}

export interface PublicOptionConfig {
  id: string;
  slug: string;
  label: string;
  priceDeltaMinor: number;
  priceDeltaMaxMinor: number | null;
  durationDeltaMinutes: number;
  durationDeltaMaxMinutes: number | null;
}

export interface PublicOptionGroupConfig {
  slug: string;
  label: string;
  selectionMode: SelectionMode;
  isRequired: boolean;
  minSelections: number;
  maxSelections: number;
  options: PublicOptionConfig[];
}

export interface PublicPricingConfig {
  service: PublicServiceConfig;
  optionGroups: PublicOptionGroupConfig[];
}

export interface PublicSelectedOption {
  id: string;
  groupSlug: string;
  optionSlug: string;
  label: string;
  priceDeltaMinor: number;
  priceDeltaMaxMinor: number | null;
  durationDeltaMinutes: number;
  durationDeltaMaxMinutes: number | null;
}

export interface PublicQuoteResponse {
  priceMinMinor: number | null;
  priceMaxMinor: number | null;
  currency: string;
  priceMode: PricingMode;
  durationMinMinutes: number;
  durationMaxMinutes: number;
  selectedOptions: PublicSelectedOption[];
}
