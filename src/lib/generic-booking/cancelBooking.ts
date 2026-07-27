// ============================================================
// Generic booking — cancel
//
// Works exclusively on public.bookings. Never touches audit_bookings.
// Does NOT create/patch/delete Calendar events and does NOT send emails
// in this slice.
//
// Temporary fail-closed transition rule:
//   If the booking already has a google_calendar_event_id OR its
//   calendar_sync_status is 'synced', the operation returns
//   service_unavailable and makes no database changes. Calendar event
//   CRUD will be wired in a later slice.
//
// Fail-closed:
//   - malformed/short token                -> not_found
//   - missing / mismatched / expired token -> not_found
//   - calendar event already present/synced-> service_unavailable
//   - booking not pending/booked           -> invalid_state
//   - service/site/schedule cannot load    -> service_unavailable
//   - cancel cutoff passed                 -> cutoff_passed
//   - concurrent status change (0 rows)    -> invalid_state
//
// Existing bookings remain cancellable even if the service is no longer
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

export interface CancelGenericBookingResult {
  success: true;
  status: 'cancelled';
}

export type CancelGenericBookingErrorCode =
  | 'not_found'
  | 'invalid_state'
  | 'service_unavailable'
  | 'cutoff_passed'
  | 'db_error';

export interface CancelGenericBookingError {
  success: false;
  error: CancelGenericBookingErrorCode;
  message: string;
}

export type CancelGenericBookingOutcome =
  | CancelGenericBookingResult
  | CancelGenericBookingError;

interface BookingRow {
  id: string;
  service_id: string;
  slot_start: string;
  booking_status: 'pending' | 'booked' | 'cancelled';
  management_token_encrypted: string;
  management_token_expires_at: string;
  google_calendar_event_id: string | null;
  calendar_sync_status: 'pending' | 'synced' | 'failed';
}

export interface CancelBookingDeps {
  lookupByTokenHash?: (hash: string) => Promise<BookingRow | null>;
  loadServiceContext?: (serviceId: string) => Promise<BookingServiceContext>;
  cancelBookingInDb?: (
    bookingId: string,
    reason: string | undefined,
    now: Date,
    currentStatus: 'pending' | 'booked',
  ) => Promise<BookingRow | null>;
  hashToken?: (rawToken: string) => string;
  verifyToken?: (rawToken: string, encryptedToken: string) => boolean;
  now?: () => Date;
}

const defaultDeps: Required<CancelBookingDeps> = {
  async lookupByTokenHash(hash) {
    const { data, error } = await getSupabase()
      .from('bookings')
      .select(
        'id, service_id, slot_start, booking_status, management_token_encrypted, management_token_expires_at, google_calendar_event_id, calendar_sync_status',
      )
      .eq('management_token_hash', hash)
      .maybeSingle();

    if (error) {
      console.error('Generic cancel lookup failed:', error);
      return null;
    }

    return (data as BookingRow | null) ?? null;
  },
  loadServiceContext: loadBookingServiceContextForManagement,
  async cancelBookingInDb(bookingId, reason, now, currentStatus) {
    const { data, error } = await getSupabase()
      .from('bookings')
      .update({
        booking_status: 'cancelled',
        cancelled_at: now.toISOString(),
        cancel_reason: reason || null,
        updated_at: now.toISOString(),
      })
      .eq('id', bookingId)
      .eq('booking_status', currentStatus)
      .select(
        'id, service_id, slot_start, booking_status, management_token_encrypted, management_token_expires_at, google_calendar_event_id, calendar_sync_status',
      )
      .single();

    if (error) {
      console.error('Generic cancel DB update failed:', error);
      return null;
    }

    return (data as BookingRow | null) ?? null;
  },
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

/**
 * Cancel a generic booking using a raw management token.
 */
export async function cancelGenericBooking(
  rawToken: string,
  reason?: string,
  deps: CancelBookingDeps = {},
): Promise<CancelGenericBookingOutcome> {
  if (!isValidManagementTokenFormat(rawToken)) {
    return {
      success: false,
      error: 'not_found',
      message: 'Érvénytelen vagy lejárt link.',
    };
  }

  const {
    lookupByTokenHash,
    loadServiceContext,
    cancelBookingInDb,
    hashToken,
    verifyToken,
    now,
  } = { ...defaultDeps, ...deps };

  const tokenHash = hashToken(rawToken);
  const booking = await lookupByTokenHash(tokenHash);

  if (!booking) {
    return {
      success: false,
      error: 'not_found',
      message: 'Érvénytelen vagy lejárt link.',
    };
  }

  if (!verifyToken(rawToken, booking.management_token_encrypted)) {
    return {
      success: false,
      error: 'not_found',
      message: 'Érvénytelen vagy lejárt link.',
    };
  }

  const nowDate = now();
  const expiresAt = booking.management_token_expires_at
    ? new Date(booking.management_token_expires_at)
    : null;
  if (expiresAt && nowDate > expiresAt) {
    return {
      success: false,
      error: 'not_found',
      message: 'Érvénytelen vagy lejárt link.',
    };
  }

  // Temporary fail-closed transition rule: do not modify bookings that
  // already have a Calendar event or are marked synced.
  if (
    booking.google_calendar_event_id ||
    booking.calendar_sync_status === 'synced'
  ) {
    return {
      success: false,
      error: 'service_unavailable',
      message:
        'A foglalás jelenleg nem kezelhető online. Kérlek válaszolj az eredeti emailre.',
    };
  }

  if (!['pending', 'booked'].includes(booking.booking_status)) {
    return {
      success: false,
      error: 'invalid_state',
      message: 'Ezt a foglalást nem lehet lemondani.',
    };
  }

  let service: BookingServiceContext;
  try {
    service = await loadServiceContext(booking.service_id);
  } catch (err) {
    console.error('Generic cancel: failed to load service context', err);
    return {
      success: false,
      error: 'service_unavailable',
      message: 'A foglalási szolgáltatás nem azonosítható.',
    };
  }

  const slotStartMs = toEpochMs(booking.slot_start);
  const nowMs = nowDate.getTime();
  const cutoffMs = slotStartMs - service.cancelCutoffHours * 60 * 60 * 1000;

  if (nowMs > cutoffMs) {
    return {
      success: false,
      error: 'cutoff_passed',
      message:
        'A lemondási határidő lejárt. Kérlek válaszolj az eredeti emailre, és személyesen intézkedünk.',
    };
  }

  const currentStatus = booking.booking_status as 'pending' | 'booked';
  const updated = await cancelBookingInDb(
    booking.id,
    reason,
    nowDate,
    currentStatus,
  );

  if (!updated) {
    // 0 modified rows means the booking status changed concurrently.
    return {
      success: false,
      error: 'invalid_state',
      message: 'Ezt a foglalást nem lehet lemondani.',
    };
  }

  return { success: true, status: 'cancelled' };
}
