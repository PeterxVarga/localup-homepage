// ============================================================
// Generic booking — cancel
//
// Works exclusively on public.bookings. Never touches audit_bookings.
// Does NOT send emails or reminders in this slice.
//
// On a successful database cancellation the tenant Calendar event is also
// deleted if one exists. A Google 404 is treated as a successful deletion.
// If the Calendar deletion fails with a non-404 error, the booking stays
// cancelled and a service_unavailable error is returned so the mismatch is
// not silently ignored.
//
// Fail-closed:
//   - malformed/short token                -> not_found
//   - missing / mismatched / expired token -> not_found
//   - booking not pending/booked           -> invalid_state
//   - service/site/schedule cannot load    -> service_unavailable
//   - cancel cutoff passed                 -> cutoff_passed
//   - concurrent status change (0 rows)    -> invalid_state
//   - calendar deletion non-404 error      -> service_unavailable
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
import { resolveGenericAvailabilityProvider } from '../calendar/genericAvailabilityProvider';
import type { GenericCalendarProvider } from '../calendar/genericAvailabilityResolver';
import { sendGenericBookingCancellation } from '../email/generic/index.ts';

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
  site_id: string;
  service_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  customer_notes: string | null;
  slot_start: string;
  slot_end: string;
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
  resolveCalendarProvider?: (
    siteId: string,
    siteSlug: string,
  ) => Promise<GenericCalendarProvider>;
  deleteCalendarEvent?: (
    provider: GenericCalendarProvider,
    eventId: string,
  ) => Promise<boolean>;
  clearCalendarEventInDb?: (params: {
    bookingId: string;
    eventId: string;
  }) => Promise<boolean>;
  markCalendarSyncFailed?: (params: {
    bookingId: string;
    eventId: string;
  }) => Promise<boolean>;
  sendCancellationEmails?: (params: {
    bookingId: string;
    service: BookingServiceContext;
    customerName: string;
    customerEmail: string;
    phone?: string;
    notes?: string;
    slotStart: string;
    slotEnd: string;
  }) => Promise<{ customer: boolean; admin: boolean }>;
  hashToken?: (rawToken: string) => string;
  verifyToken?: (rawToken: string, encryptedToken: string) => boolean;
  now?: () => Date;
}

const defaultDeps: Required<CancelBookingDeps> = {
  async lookupByTokenHash(hash) {
    const { data, error } = await getSupabase()
      .from('bookings')
      .select(
        'id, site_id, service_id, customer_name, customer_email, customer_phone, customer_notes, slot_start, slot_end, booking_status, management_token_encrypted, management_token_expires_at, google_calendar_event_id, calendar_sync_status',
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
        'id, site_id, service_id, customer_name, customer_email, customer_phone, customer_notes, slot_start, slot_end, booking_status, management_token_encrypted, management_token_expires_at, google_calendar_event_id, calendar_sync_status',
      )
      .single();

    if (error) {
      console.error('Generic cancel DB update failed:', error);
      return null;
    }

    return (data as BookingRow | null) ?? null;
  },
  async resolveCalendarProvider(siteId, siteSlug) {
    return resolveGenericAvailabilityProvider(siteId, siteSlug);
  },
  async deleteCalendarEvent(provider, eventId) {
    const result = await provider.deleteEvent(eventId);
    return result.ok;
  },
  async clearCalendarEventInDb({ bookingId, eventId }) {
    const { error } = await getSupabase()
      .from('bookings')
      .update({
        google_calendar_event_id: null,
        calendar_sync_status: 'synced',
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .eq('booking_status', 'cancelled')
      .eq('google_calendar_event_id', eventId);

    if (error) {
      console.error('Generic cancel: failed to clear calendar event in DB');
      return false;
    }

    return true;
  },
  async markCalendarSyncFailed({ bookingId, eventId }) {
    const { error } = await getSupabase()
      .from('bookings')
      .update({
        calendar_sync_status: 'failed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .eq('booking_status', 'cancelled')
      .eq('google_calendar_event_id', eventId);

    if (error) {
      console.error('Generic cancel: failed to mark calendar sync failed');
      return false;
    }

    return true;
  },
  async sendCancellationEmails(params) {
    try {
      return await sendGenericBookingCancellation({
        bookingId: params.bookingId,
        service: params.service,
        customerName: params.customerName,
        customerEmail: params.customerEmail,
        phone: params.phone,
        notes: params.notes,
        slotStart: params.slotStart,
        slotEnd: params.slotEnd,
      });
    } catch (err) {
      console.error('Generic cancel: cancellation email failed');
      return { customer: false, admin: false };
    }
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
    resolveCalendarProvider,
    deleteCalendarEvent,
    clearCalendarEventInDb,
    markCalendarSyncFailed,
    sendCancellationEmails,
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

  // Delete the tenant Calendar event if one exists. A 404 from Google is
  // treated as a successful deletion. Any other Calendar error is surfaced
  // so the mismatch is not silently ignored.
  const eventId = booking.google_calendar_event_id;
  if (eventId) {
    let calendarDeleted: boolean;
    try {
      const provider = await resolveCalendarProvider(
        service.siteId,
        service.siteSlug,
      );
      calendarDeleted = await deleteCalendarEvent(provider, eventId);
    } catch (err) {
      console.error('Generic cancel: calendar event deletion failed');
      calendarDeleted = false;
    }

    if (calendarDeleted) {
      const cleared = await clearCalendarEventInDb({ bookingId: booking.id, eventId });
      if (!cleared) {
        console.error('Generic cancel: failed to clear calendar event in DB');
      }
    } else {
      const marked = await markCalendarSyncFailed({ bookingId: booking.id, eventId });
      if (!marked) {
        console.error('Generic cancel: failed to mark calendar sync failed');
      }

      return {
        success: false,
        error: 'service_unavailable',
        message:
          'A foglalás lemondása sikeres volt, de a naptáresemény törlése nem sikerült. Kérlek válaszolj az eredeti emailre.',
      };
    }
  }

  // Send tenant cancellation emails. Email failure is isolated and does not
  // roll back the cancelled booking or Calendar deletion.
  try {
    await sendCancellationEmails({
      bookingId: updated.id,
      service,
      customerName: updated.customer_name,
      customerEmail: updated.customer_email,
      phone: updated.customer_phone ?? undefined,
      notes: updated.customer_notes ?? undefined,
      slotStart: updated.slot_start,
      slotEnd: updated.slot_end,
    });
  } catch (err) {
    console.error('Generic cancel: cancellation email failed');
  }

  return { success: true, status: 'cancelled' };
}
