// ============================================================
// Generic booking — reschedule
//
// Works exclusively on public.bookings. Never touches audit_bookings.
// Does NOT create/patch/delete Calendar events and does NOT send emails
// or reminders in this slice.
//
// Temporary fail-closed transition rule:
//   If the booking already has a google_calendar_event_id OR its
//   calendar_sync_status is 'synced', the operation returns
//   service_unavailable and makes no database changes. Calendar event
//   CRUD will be wired in a later slice.
//
// Checks performed in order:
//   1. token format + lookup + verify + expiry          (not_found)
//   2. calendar event already present/synced            (service_unavailable)
//   3. booking state pending/booked                     (invalid_state)
//   4. service context loads and service is active      (service_unavailable)
//   5. expectedOldSlotStart matches current slot        (booking_changed)
//   6. new slot duration matches service                (invalid_slot / service_unavailable)
//   7. new slot follows availability rules              (invalid_slot)
//   8. reschedule cutoff not passed                     (cutoff_passed)
//   9. max reschedules not reached                      (max_reschedules_reached)
//  10. no site-level booking conflict (own id excluded) (slot_taken)
//  11. tenant Calendar freeBusy is clear                (slot_taken / service_unavailable)
//  12. atomic DB update                                 (slot_taken / booking_changed / db_error)
//
// The final exclusion constraint on public.bookings is the ultimate
// race-condition guard; 23P01 is surfaced as slot_taken.
//
// Rescheduling requires an active service. View/cancel allow inactive
// services because the booking already exists.
// ============================================================

import { getSupabase } from '../supabase';
import {
  hashManagementToken,
  verifyManagementToken,
} from '../tokens/crypto';
import {
  isSlotValidAccordingToRules,
  getExpectedSlotEnd,
} from '../booking/validateSlot';
import {
  computeBlockedRange,
  intervalsOverlap,
} from '../booking/intervals';
import {
  resolveGenericAvailabilityProvider,
  bindGetFreeBusy,
} from '../calendar/genericAvailabilityProvider';
import { loadActiveBookingServiceContext } from './loadServiceContext';
import { isValidManagementTokenFormat } from './tokenValidation';
import type { BookingServiceContext } from '../booking-service/types';
import type { GenericCalendarProvider } from '../calendar/genericAvailabilityResolver';
import { sendGenericBookingReschedule } from '../email/generic/index.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_TTL_DAYS = 30;

export interface RescheduleGenericBookingParams {
  rawToken: string;
  expectedOldSlotStart: string;
  newSlotStart: string;
}

export interface RescheduleGenericBookingSuccess {
  success: true;
  bookingId: string;
  oldSlotStart: string;
  oldSlotEnd: string;
  newSlotStart: string;
  newSlotEnd: string;
  rescheduleCount: number;
  idempotent?: boolean;
}

export type RescheduleGenericBookingErrorCode =
  | 'not_found'
  | 'invalid_state'
  | 'service_unavailable'
  | 'cutoff_passed'
  | 'max_reschedules_reached'
  | 'booking_changed'
  | 'invalid_slot'
  | 'slot_taken'
  | 'db_error';

export interface RescheduleGenericBookingError {
  success: false;
  error: RescheduleGenericBookingErrorCode;
  message: string;
}

export type RescheduleGenericBookingOutcome =
  | RescheduleGenericBookingSuccess
  | RescheduleGenericBookingError;

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
  reschedule_count: number;
}

interface UpdateSlotResult {
  ok: true;
  booking: BookingRow;
}

interface UpdateSlotError {
  ok: false;
  errorCode: string;
  errorMessage: string;
}

type UpdateSlotOutcome = UpdateSlotResult | UpdateSlotError;

export interface RescheduleBookingDeps {
  lookupByTokenHash?: (hash: string) => Promise<BookingRow | null>;
  loadServiceContext?: (serviceId: string) => Promise<BookingServiceContext>;
  isSlotValidAccordingToRules?: (
    slotStart: string,
    slotEnd: string,
    service: BookingServiceContext,
    now?: Date,
  ) => Promise<boolean>;
  resolveAvailabilityProvider?: (
    siteId: string,
    siteSlug: string,
  ) => Promise<GenericCalendarProvider>;
  checkSiteBookingConflict?: (
    siteId: string,
    blockedStart: string,
    blockedEnd: string,
    excludeBookingId: string,
  ) => Promise<boolean>;
  updateBookingSlot?: (params: {
    bookingId: string;
    currentSlotStart: string;
    currentSlotEnd: string;
    currentStatus: 'pending' | 'booked';
    currentRescheduleCount: number;
    newSlotStart: string;
    newSlotEnd: string;
    newBlockedStart: string;
    newBlockedEnd: string;
    newRescheduleCount: number;
    rescheduledAt: string;
    tokenExpiresAt: string;
  }) => Promise<UpdateSlotOutcome>;
  patchCalendarEvent?: (
    provider: GenericCalendarProvider,
    eventId: string,
    params: { start: string; end: string; timeZone: string },
  ) => Promise<{ ok: boolean }>;
  rollbackBookingSlot?: (params: {
    bookingId: string;
    newSlotStart: string;
    newSlotEnd: string;
    newRescheduleCount: number;
    previousSlotStart: string;
    previousSlotEnd: string;
    previousBlockedStart: string;
    previousBlockedEnd: string;
    previousRescheduleCount: number;
    tokenExpiresAt: string;
    rolledBackAt: string;
  }) => Promise<boolean>;
  updateCalendarSyncStatus?: (params: {
    bookingId: string;
    eventId: string;
    slotStart: string;
    slotEnd: string;
    rescheduleCount: number;
    calendarSyncStatus: 'synced' | 'failed';
  }) => Promise<boolean>;
  sendRescheduleEmails?: (params: {
    bookingId: string;
    service: BookingServiceContext;
    customerName: string;
    customerEmail: string;
    phone?: string;
    notes?: string;
    oldSlotStart: string;
    oldSlotEnd: string;
    newSlotStart: string;
    newSlotEnd: string;
    rescheduleCount: number;
  }) => Promise<{ customer: boolean; admin: boolean }>;
  computeBlockedRange?: (
    slotStart: string,
    slotEnd: string,
    bufferBeforeMinutes: number,
    bufferAfterMinutes: number,
  ) => { blockedStart: string; blockedEnd: string };
  getExpectedSlotEnd?: (
    slotStart: string,
    service: BookingServiceContext,
  ) => string;
  getTokenExpiresAt?: (slotEnd: string) => string;
  hashToken?: (rawToken: string) => string;
  verifyToken?: (rawToken: string, encryptedToken: string) => boolean;
  now?: () => Date;
}

async function defaultLookupByTokenHash(hash: string): Promise<BookingRow | null> {
  const { data, error } = await getSupabase()
    .from('bookings')
    .select(
      'id, site_id, service_id, customer_name, customer_email, customer_phone, customer_notes, slot_start, slot_end, booking_status, management_token_encrypted, management_token_expires_at, google_calendar_event_id, calendar_sync_status, reschedule_count',
    )
    .eq('management_token_hash', hash)
    .maybeSingle();

  if (error) {
    console.error('Generic reschedule lookup failed:', error);
    return null;
  }

  return (data as BookingRow | null) ?? null;
}

async function defaultCheckSiteBookingConflict(
  siteId: string,
  blockedStart: string,
  blockedEnd: string,
  excludeBookingId: string,
): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from('bookings')
    .select('id')
    .eq('site_id', siteId)
    .in('booking_status', ['pending', 'booked'])
    .lt('blocked_start', blockedEnd)
    .gt('blocked_end', blockedStart)
    .neq('id', excludeBookingId);

  if (error) {
    console.error('Generic reschedule site conflict check failed:', error);
    throw new Error('site_conflict_check_failed');
  }

  return (data ?? []).length > 0;
}

async function defaultUpdateBookingSlot(params: {
  bookingId: string;
  currentSlotStart: string;
  currentSlotEnd: string;
  currentStatus: 'pending' | 'booked';
  currentRescheduleCount: number;
  newSlotStart: string;
  newSlotEnd: string;
  newBlockedStart: string;
  newBlockedEnd: string;
  newRescheduleCount: number;
  rescheduledAt: string;
  tokenExpiresAt: string;
}): Promise<UpdateSlotOutcome> {
  const { data, error } = await getSupabase()
    .from('bookings')
    .update({
      previous_slot_start: params.currentSlotStart,
      previous_slot_end: params.currentSlotEnd,
      slot_start: params.newSlotStart,
      slot_end: params.newSlotEnd,
      blocked_start: params.newBlockedStart,
      blocked_end: params.newBlockedEnd,
      reschedule_count: params.newRescheduleCount,
      rescheduled_at: params.rescheduledAt,
      management_token_expires_at: params.tokenExpiresAt,
      updated_at: params.rescheduledAt,
    })
    .eq('id', params.bookingId)
    .eq('slot_start', params.currentSlotStart)
    .eq('booking_status', params.currentStatus)
    .eq('reschedule_count', params.currentRescheduleCount)
    .select(
      'id, site_id, service_id, customer_name, customer_email, customer_phone, customer_notes, slot_start, slot_end, booking_status, management_token_encrypted, management_token_expires_at, google_calendar_event_id, calendar_sync_status, reschedule_count',
    )
    .single();

  if (error) {
    return {
      ok: false,
      errorCode: error.code,
      errorMessage: error.message,
    };
  }

  if (!data) {
    return {
      ok: false,
      errorCode: 'NO_ROWS',
      errorMessage: 'No rows updated',
    };
  }

  return { ok: true, booking: data as BookingRow };
}

function defaultGetTokenExpiresAt(slotEnd: string): string {
  return new Date(
    new Date(slotEnd).getTime() + TOKEN_TTL_DAYS * DAY_MS,
  ).toISOString();
}

const defaultDeps: Required<RescheduleBookingDeps> = {
  lookupByTokenHash: defaultLookupByTokenHash,
  loadServiceContext: loadActiveBookingServiceContext,
  isSlotValidAccordingToRules,
  resolveAvailabilityProvider: resolveGenericAvailabilityProvider,
  checkSiteBookingConflict: defaultCheckSiteBookingConflict,
  updateBookingSlot: defaultUpdateBookingSlot,
  async patchCalendarEvent(provider, eventId, params) {
    const result = await provider.patchEvent(eventId, params);
    return { ok: result.ok };
  },
  async rollbackBookingSlot(params) {
    const { error } = await getSupabase()
      .from('bookings')
      .update({
        slot_start: params.previousSlotStart,
        slot_end: params.previousSlotEnd,
        blocked_start: params.previousBlockedStart,
        blocked_end: params.previousBlockedEnd,
        reschedule_count: params.previousRescheduleCount,
        previous_slot_start: null,
        previous_slot_end: null,
        management_token_expires_at: params.tokenExpiresAt,
        updated_at: params.rolledBackAt,
      })
      .eq('id', params.bookingId)
      .eq('slot_start', params.newSlotStart)
      .eq('slot_end', params.newSlotEnd)
      .eq('booking_status', 'booked')
      .eq('reschedule_count', params.newRescheduleCount);

    if (error) {
      console.error('Generic reschedule: rollback failed');
      return false;
    }

    return true;
  },
  async updateCalendarSyncStatus(params) {
    const { error } = await getSupabase()
      .from('bookings')
      .update({
        calendar_sync_status: params.calendarSyncStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.bookingId)
      .eq('slot_start', params.slotStart)
      .eq('slot_end', params.slotEnd)
      .eq('booking_status', 'booked')
      .eq('reschedule_count', params.rescheduleCount)
      .eq('google_calendar_event_id', params.eventId);

    if (error) {
      console.error('Generic reschedule: failed to update calendar sync status');
      return false;
    }

    return true;
  },
  async sendRescheduleEmails(params) {
    try {
      return await sendGenericBookingReschedule({
        bookingId: params.bookingId,
        service: params.service,
        customerName: params.customerName,
        customerEmail: params.customerEmail,
        phone: params.phone,
        notes: params.notes,
        oldSlotStart: params.oldSlotStart,
        oldSlotEnd: params.oldSlotEnd,
        slotStart: params.newSlotStart,
        slotEnd: params.newSlotEnd,
        rescheduleCount: params.rescheduleCount,
      });
    } catch (err) {
      console.error('Generic reschedule: email failed');
      return { customer: false, admin: false };
    }
  },
  computeBlockedRange,
  getExpectedSlotEnd,
  getTokenExpiresAt: defaultGetTokenExpiresAt,
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
 * Reschedule a generic booking to a new slot.
 */
export async function rescheduleGenericBooking(
  params: RescheduleGenericBookingParams,
  deps: RescheduleBookingDeps = {},
): Promise<RescheduleGenericBookingOutcome> {
  const {
    lookupByTokenHash,
    loadServiceContext,
    isSlotValidAccordingToRules: checkRules,
    resolveAvailabilityProvider,
    checkSiteBookingConflict,
    updateBookingSlot,
    patchCalendarEvent,
    rollbackBookingSlot,
    updateCalendarSyncStatus,
    sendRescheduleEmails,
    computeBlockedRange: computeBlocked,
    getExpectedSlotEnd: computeExpectedEnd,
    getTokenExpiresAt,
    hashToken,
    verifyToken,
    now,
  } = { ...defaultDeps, ...deps };

  const { rawToken, expectedOldSlotStart, newSlotStart } = params;

  if (!isValidManagementTokenFormat(rawToken)) {
    return {
      success: false,
      error: 'not_found',
      message: 'Érvénytelen vagy lejárt link.',
    };
  }

  // 1. Token lookup + verify + expiry.
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

  // 2. Booking state.
  if (!['pending', 'booked'].includes(booking.booking_status)) {
    return {
      success: false,
      error: 'invalid_state',
      message: 'Ezt a foglalást nem lehet módosítani.',
    };
  }

  // 4. Service context (reschedule requires active service).
  let service: BookingServiceContext;
  try {
    service = await loadServiceContext(booking.service_id);
  } catch (err) {
    console.error('Generic reschedule: failed to load service context', err);
    return {
      success: false,
      error: 'service_unavailable',
      message: 'A foglalási szolgáltatás nem azonosítható.',
    };
  }

  const currentSlotStart = booking.slot_start;
  const currentSlotEnd = booking.slot_end;

  // 5. Optimistic concurrency guard (epoch-based comparison).
  if (toEpochMs(expectedOldSlotStart) !== toEpochMs(currentSlotStart)) {
    return {
      success: false,
      error: 'booking_changed',
      message:
        'A foglalás időközben megváltozott. Kérlek frissítsd az oldalt.',
    };
  }

  // 6. New slot duration must match the service configuration.
  let newSlotEnd: string;
  try {
    newSlotEnd = computeExpectedEnd(newSlotStart, service);
  } catch (err) {
    console.error('Generic reschedule: invalid new slot start', err);
    return {
      success: false,
      error: 'invalid_slot',
      message: 'A kiválasztott időpont érvénytelen.',
    };
  }

  // 7. Idempotency: same slot requested.
  if (
    toEpochMs(newSlotStart) === toEpochMs(currentSlotStart) &&
    toEpochMs(newSlotEnd) === toEpochMs(currentSlotEnd)
  ) {
    return {
      success: true,
      bookingId: booking.id,
      oldSlotStart: currentSlotStart,
      oldSlotEnd: currentSlotEnd,
      newSlotStart: currentSlotStart,
      newSlotEnd: currentSlotEnd,
      rescheduleCount: booking.reschedule_count,
      idempotent: true,
    };
  }

  // 8. Availability rules.
  let followsRules: boolean;
  try {
    followsRules = await checkRules(newSlotStart, newSlotEnd, service, nowDate);
  } catch (err) {
    console.error('Generic reschedule: availability rule check failed', err);
    return {
      success: false,
      error: 'service_unavailable',
      message: 'A foglalási időpontok átmenetileg nem ellenőrizhetők.',
    };
  }

  if (!followsRules) {
    return {
      success: false,
      error: 'invalid_slot',
      message: 'A kiválasztott időpont nem felel meg a foglalási szabályoknak.',
    };
  }

  // 9. Reschedule cutoff.
  const slotStartMs = toEpochMs(currentSlotStart);
  const nowMs = nowDate.getTime();
  const cutoffMs = slotStartMs - service.rescheduleCutoffHours * 60 * 60 * 1000;

  if (nowMs > cutoffMs) {
    return {
      success: false,
      error: 'cutoff_passed',
      message:
        'A módosítási határidő lejárt. Kérlek válaszolj az eredeti emailre, és személyesen intézkedünk.',
    };
  }

  // 10. Max reschedules.
  if (booking.reschedule_count >= service.maxReschedules) {
    return {
      success: false,
      error: 'max_reschedules_reached',
      message: 'További módosításhoz válaszolj a visszaigazoló emailre.',
    };
  }

  // 11. Compute blocked intervals including buffers.
  const { blockedStart: newBlockedStart, blockedEnd: newBlockedEnd } =
    computeBlocked(
      newSlotStart,
      newSlotEnd,
      service.bufferBeforeMinutes,
      service.bufferAfterMinutes,
    );

  const { blockedStart: currentBlockedStart, blockedEnd: currentBlockedEnd } =
    computeBlocked(
      currentSlotStart,
      currentSlotEnd,
      service.bufferBeforeMinutes,
      service.bufferAfterMinutes,
    );

  // 12. Site-level booking conflict check (own booking excluded).
  let hasSiteConflict: boolean;
  try {
    hasSiteConflict = await checkSiteBookingConflict(
      booking.site_id,
      newBlockedStart,
      newBlockedEnd,
      booking.id,
    );
  } catch (err) {
    console.error('Generic reschedule: site conflict check failed', err);
    return {
      success: false,
      error: 'service_unavailable',
      message: 'A foglalási időpontok átmenetileg nem ellenőrizhetők.',
    };
  }

  if (hasSiteConflict) {
    return {
      success: false,
      error: 'slot_taken',
      message:
        'Az új időpontot épp lefoglalták. Kérlek válassz másik időpontot.',
    };
  }

  // 13. Tenant Calendar freeBusy check.
  let provider: GenericCalendarProvider;
  try {
    provider = await resolveAvailabilityProvider(
      service.siteId,
      service.siteSlug,
    );
  } catch (err) {
    console.error(
      'Generic reschedule: failed to resolve availability provider',
    );
    return {
      success: false,
      error: 'service_unavailable',
      message: 'A foglalási időpontok átmenetileg nem ellenőrizhetők.',
    };
  }

  try {
    const getFreeBusy = bindGetFreeBusy(provider);
    const busySlots = await getFreeBusy(newBlockedStart, newBlockedEnd);

    const hasCalendarConflict = busySlots.some((busy) =>
      intervalsOverlap(
        newBlockedStart,
        newBlockedEnd,
        busy.start,
        busy.end,
      ),
    );

    if (hasCalendarConflict) {
      return {
        success: false,
        error: 'slot_taken',
        message:
          'Az új időpontot épp lefoglalták. Kérlek válassz másik időpontot.',
      };
    }
  } catch (err) {
    console.error('Generic reschedule: freeBusy check failed', err);
    return {
      success: false,
      error: 'service_unavailable',
      message: 'A foglalási időpontok átmenetileg nem ellenőrizhetők.',
    };
  }

  // 14. Atomic DB update.
  const currentRescheduleCount = booking.reschedule_count;
  const newRescheduleCount = currentRescheduleCount + 1;
  const rescheduledAt = nowDate.toISOString();
  // Token expiry follows the same rule as createBooking.ts: slotEnd + 30 days.
  const tokenExpiresAt = getTokenExpiresAt(newSlotEnd);

  const updateResult = await updateBookingSlot({
    bookingId: booking.id,
    currentSlotStart,
    currentSlotEnd,
    currentStatus: booking.booking_status as 'pending' | 'booked',
    currentRescheduleCount,
    newSlotStart,
    newSlotEnd,
    newBlockedStart,
    newBlockedEnd,
    newRescheduleCount,
    rescheduledAt,
    tokenExpiresAt,
  });

  if (!updateResult.ok) {
    if (updateResult.errorCode === '23P01') {
      return {
        success: false,
        error: 'slot_taken',
        message:
          'Az új időpontot épp lefoglalták. Kérlek válassz másik időpontot.',
      };
    }

    console.error('Generic reschedule DB update failed');
    return {
      success: false,
      error:
        updateResult.errorCode === 'NO_ROWS' ? 'booking_changed' : 'db_error',
      message:
        updateResult.errorCode === 'NO_ROWS'
          ? 'A foglalás időközben megváltozott. Kérlek frissítsd az oldalt.'
          : 'Something went wrong. Please try again.',
    };
  }

  // 15. Patch the tenant Calendar event when one exists.
  const eventId = booking.google_calendar_event_id;
  if (eventId) {
    let patchOk: boolean;
    try {
      const patchResult = await patchCalendarEvent(provider, eventId, {
        start: newSlotStart,
        end: newSlotEnd,
        timeZone: service.timezone,
      });
      patchOk = patchResult.ok;
    } catch (err) {
      console.error('Generic reschedule: calendar patch failed');
      patchOk = false;
    }

    if (patchOk) {
      const marked = await updateCalendarSyncStatus({
        bookingId: booking.id,
        eventId,
        slotStart: newSlotStart,
        slotEnd: newSlotEnd,
        rescheduleCount: newRescheduleCount,
        calendarSyncStatus: 'synced',
      });

      if (!marked) {
        console.error('Generic reschedule: failed to mark calendar sync status');
      }
    } else {
      const rolledBack = await rollbackBookingSlot({
        bookingId: booking.id,
        newSlotStart,
        newSlotEnd,
        newRescheduleCount,
        previousSlotStart: currentSlotStart,
        previousSlotEnd: currentSlotEnd,
        previousBlockedStart: currentBlockedStart,
        previousBlockedEnd: currentBlockedEnd,
        previousRescheduleCount: currentRescheduleCount,
        tokenExpiresAt: getTokenExpiresAt(currentSlotEnd),
        rolledBackAt: nowDate.toISOString(),
      });

      if (!rolledBack) {
        console.error('Generic reschedule: rollback after calendar patch failed');
        const marked = await updateCalendarSyncStatus({
          bookingId: booking.id,
          eventId,
          slotStart: newSlotStart,
          slotEnd: newSlotEnd,
          rescheduleCount: newRescheduleCount,
          calendarSyncStatus: 'failed',
        });

        if (!marked) {
          console.error('Generic reschedule: failed to mark calendar sync failed');
        }

        return {
          success: false,
          error: 'service_unavailable',
          message:
            'Az időpontmódosítás sikertelen volt, és az állapot helyreállítása sem sikerült. Kérlek válaszolj az eredeti emailre.',
        };
      }

      return {
        success: false,
        error: 'service_unavailable',
        message:
          'Az időpontmódosítás sikertelen volt. Kérlek próbáld újra.',
      };
    }
  }

  // 16. Send tenant reschedule emails. Email failure is isolated and does not
  //     roll back the successful DB + Calendar patch.
  try {
    await sendRescheduleEmails({
      bookingId: updateResult.booking.id,
      service,
      customerName: updateResult.booking.customer_name,
      customerEmail: updateResult.booking.customer_email,
      phone: updateResult.booking.customer_phone ?? undefined,
      notes: updateResult.booking.customer_notes ?? undefined,
      oldSlotStart: currentSlotStart,
      oldSlotEnd: currentSlotEnd,
      newSlotStart,
      newSlotEnd,
      rescheduleCount: updateResult.booking.reschedule_count,
    });
  } catch (err) {
    console.error('Generic reschedule: email failed');
  }

  return {
    success: true,
    bookingId: updateResult.booking.id,
    oldSlotStart: currentSlotStart,
    oldSlotEnd: currentSlotEnd,
    newSlotStart,
    newSlotEnd,
    rescheduleCount: updateResult.booking.reschedule_count,
  };
}
