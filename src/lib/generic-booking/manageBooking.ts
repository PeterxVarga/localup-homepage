// ============================================================
// Generic booking — management lookup
//
// Returns non-sensitive details for the public manage page.
// Works exclusively on public.bookings. Never touches audit_bookings.
//
// Fail-closed:
//   - malformed/short token                -> not_found
//   - token hash not found                 -> not_found
//   - encrypted token does not match       -> not_found
//   - token expired                        -> not_found
//   - service/site/schedule cannot load    -> service_unavailable
//
// Existing bookings remain manageable even if the service is no longer
// actively bookable (public_booking_enabled=false or is_active=false).
// ============================================================

import { getSupabase } from '../supabase';
import {
  hashManagementToken,
  verifyManagementToken,
} from '../tokens/crypto';
import { loadBookingServiceContextForManagement } from './loadServiceContext';
import { isValidManagementTokenFormat } from './tokenValidation';
import type { BookingServiceContext } from '../booking-service/types';

export interface GenericManageBookingDetails {
  bookingId: string;
  siteSlug: string;
  serviceSlug: string;
  name: string;
  email: string;
  slotStart: string;
  slotEnd: string;
  isCancelled: boolean;
  cancelCutoffPassed: boolean;
  rescheduleCutoffPassed: boolean;
  rescheduleCount: number;
  maxReschedules: number;
  priceMinMinor: number | null;
  priceMaxMinor: number | null;
  currency: string | null;
  priceMode: string | null;
  durationMinMinutes: number | null;
  durationMaxMinutes: number | null;
}

export type GenericManageLookupResult =
  | { status: 'found'; details: GenericManageBookingDetails }
  | { status: 'not_found' }
  | { status: 'service_unavailable' };

interface BookingRow {
  id: string;
  site_id: string;
  service_id: string;
  customer_name: string;
  customer_email: string;
  slot_start: string;
  slot_end: string;
  booking_status: 'pending' | 'booked' | 'cancelled';
  management_token_encrypted: string;
  management_token_expires_at: string;
  reschedule_count: number;
  pricing_snapshot: Record<string, unknown> | null;
}

export interface ManageBookingDeps {
  lookupByTokenHash?: (hash: string) => Promise<BookingRow | null>;
  loadServiceContext?: (serviceId: string) => Promise<BookingServiceContext>;
  hashToken?: (rawToken: string) => string;
  verifyToken?: (rawToken: string, encryptedToken: string) => boolean;
  now?: () => Date;
}

const defaultDeps: Required<ManageBookingDeps> = {
  async lookupByTokenHash(hash) {
    const { data, error } = await getSupabase()
      .from('bookings')
      .select(
        'id, site_id, service_id, customer_name, customer_email, slot_start, slot_end, booking_status, management_token_encrypted, management_token_expires_at, reschedule_count, pricing_snapshot',
      )
      .eq('management_token_hash', hash)
      .maybeSingle();

    if (error) {
      console.error('Generic manage lookup failed:', error);
      return null;
    }

    return (data as BookingRow | null) ?? null;
  },
  loadServiceContext: loadBookingServiceContextForManagement,
  hashToken: hashManagementToken,
  verifyToken: verifyManagementToken,
  now: () => new Date(),
};

function toEpochMs(value: string): number {
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) {
    throw new RangeError(`Invalid timestamp: ${value}`);
  }
  return ms;
}

interface PricingRange {
  priceMinMinor: number | null;
  priceMaxMinor: number | null;
  currency: string | null;
  priceMode: string | null;
  durationMinMinutes: number | null;
  durationMaxMinutes: number | null;
}

function extractPricingRangeFromSnapshot(
  snapshot: Record<string, unknown> | null,
): PricingRange {
  if (!snapshot) {
    return {
      priceMinMinor: null,
      priceMaxMinor: null,
      currency: null,
      priceMode: null,
      durationMinMinutes: null,
      durationMaxMinutes: null,
    };
  }

  const version = snapshot.version;
  const priceMode =
    typeof snapshot.priceMode === 'string' ? snapshot.priceMode : null;
  const currency =
    typeof snapshot.currency === 'string' ? snapshot.currency : null;

  if (version === 2) {
    return {
      priceMinMinor:
        typeof snapshot.priceMinMinor === 'number'
          ? snapshot.priceMinMinor
          : null,
      priceMaxMinor:
        typeof snapshot.priceMaxMinor === 'number'
          ? snapshot.priceMaxMinor
          : null,
      currency,
      priceMode,
      durationMinMinutes:
        typeof snapshot.durationMinMinutes === 'number'
          ? snapshot.durationMinMinutes
          : null,
      durationMaxMinutes:
        typeof snapshot.durationMaxMinutes === 'number'
          ? snapshot.durationMaxMinutes
          : null,
    };
  }

  // v1 or unversioned scalar snapshot: treat min === max.
  const priceMinor =
    typeof snapshot.priceMinor === 'number' ? snapshot.priceMinor : null;
  const durationMinutes =
    typeof snapshot.durationMinutes === 'number'
      ? snapshot.durationMinutes
      : null;

  return {
    priceMinMinor: priceMinor,
    priceMaxMinor: priceMinor,
    currency,
    priceMode,
    durationMinMinutes: durationMinutes,
    durationMaxMinutes: durationMinutes,
  };
}

/**
 * Look up a generic booking by raw management token.
 * Verifies token integrity and expiry.
 * Does NOT perform any mutation.
 */
export async function getManageBookingDetails(
  rawToken: string,
  deps: ManageBookingDeps = {},
): Promise<GenericManageLookupResult> {
  if (!isValidManagementTokenFormat(rawToken)) {
    return { status: 'not_found' };
  }

  const { lookupByTokenHash, loadServiceContext, hashToken, verifyToken, now } =
    { ...defaultDeps, ...deps };

  const tokenHash = hashToken(rawToken);
  const booking = await lookupByTokenHash(tokenHash);

  if (!booking) {
    return { status: 'not_found' };
  }

  if (!verifyToken(rawToken, booking.management_token_encrypted)) {
    return { status: 'not_found' };
  }

  const nowDate = now();
  const expiresAt = booking.management_token_expires_at
    ? new Date(booking.management_token_expires_at)
    : null;
  if (expiresAt && nowDate > expiresAt) {
    return { status: 'not_found' };
  }

  let service: BookingServiceContext;
  try {
    service = await loadServiceContext(booking.service_id);
  } catch (err) {
    console.error('Generic manage: failed to load service context', err);
    return { status: 'service_unavailable' };
  }

  const slotStartMs = toEpochMs(booking.slot_start);
  const nowMs = nowDate.getTime();
  const cancelCutoffMs =
    slotStartMs - service.cancelCutoffHours * 60 * 60 * 1000;
  const rescheduleCutoffMs =
    slotStartMs - service.rescheduleCutoffHours * 60 * 60 * 1000;

  const pricingRange = extractPricingRangeFromSnapshot(booking.pricing_snapshot);

  return {
    status: 'found',
    details: {
      bookingId: booking.id,
      siteSlug: service.siteSlug,
      serviceSlug: service.serviceSlug,
      name: booking.customer_name,
      email: booking.customer_email,
      slotStart: booking.slot_start,
      slotEnd: booking.slot_end,
      isCancelled: booking.booking_status === 'cancelled',
      cancelCutoffPassed: nowMs > cancelCutoffMs,
      rescheduleCutoffPassed: nowMs > rescheduleCutoffMs,
      rescheduleCount: booking.reschedule_count,
      maxReschedules: service.maxReschedules,
      ...pricingRange,
    },
  };
}
