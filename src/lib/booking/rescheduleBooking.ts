// ============================================================
// Reschedule booking — framework-neutral
// Validates token, reserves new slot, patches Google Calendar event,
// and rolls back safely if the patch definitely failed.
// ============================================================

import { getSupabase } from '../supabase';
import { env } from '../env';
import { hashManagementToken, decryptManagementToken } from '../tokens/crypto';
import { googleCalendarProvider } from '../calendar/provider/google';
import { isSlotAvailable } from '../calendar/syncBookingToCalendar';
import { trackEvent } from './trackEvent';
import { rescheduleBookingReminders } from './reminderScheduling';
import {
  isSlotValidAccordingToRules,
  getExpectedSlotEnd,
  isSameSlot,
} from './validateSlot';

export interface RescheduleBookingParams {
  rawToken: string;
  expectedOldSlotStart: string;
  newSlotStart: string;
}

export interface RescheduleBookingSuccess {
  success: true;
  bookingId: string;
  businessName: string;
  name: string;
  email: string;
  oldSlotStart: string;
  oldSlotEnd: string;
  newSlotStart: string;
  newSlotEnd: string;
  meetLink?: string;
  rescheduleCount: number;
  calendarPatched: boolean;
  idempotent?: boolean;
}

export interface RescheduleBookingError {
  success: false;
  error: string;
  message: string;
  status: number;
}

export type RescheduleBookingResult =
  RescheduleBookingSuccess | RescheduleBookingError;

function getCutoffTime(slotStart: string): Date {
  const start = new Date(slotStart);
  const cutoffHours = Number.isFinite(env.auditRescheduleCutoffHours)
    ? env.auditRescheduleCutoffHours
    : 12;
  return new Date(start.getTime() - cutoffHours * 60 * 60 * 1000);
}

function getTokenExpiry(selectedSlotEnd: string): Date {
  return new Date(
    new Date(selectedSlotEnd).getTime() + 30 * 24 * 60 * 60 * 1000,
  );
}

export async function rescheduleBooking(
  params: RescheduleBookingParams,
): Promise<RescheduleBookingResult> {
  const { rawToken, expectedOldSlotStart, newSlotStart } = params;

  // 1. Lookup booking by token hash
  const tokenHash = hashManagementToken(rawToken);
  const { data: booking, error: lookupError } = await getSupabase()
    .from('audit_bookings')
    .select('*')
    .eq('management_token_hash', tokenHash)
    .maybeSingle();

  if (lookupError) {
    console.error('Reschedule booking lookup failed:', lookupError);
    return {
      success: false,
      error: 'db_error',
      message: 'Something went wrong. Please try again.',
      status: 500,
    };
  }

  if (!booking) {
    return {
      success: false,
      error: 'not_found',
      message: 'Érvénytelen vagy lejárt link.',
      status: 404,
    };
  }

  // 2. Verify encrypted token matches raw token
  if (!booking.management_token_encrypted) {
    return {
      success: false,
      error: 'not_found',
      message: 'Érvénytelen vagy lejárt link.',
      status: 404,
    };
  }

  try {
    const decrypted = decryptManagementToken(
      booking.management_token_encrypted,
    );
    if (decrypted !== rawToken) {
      return {
        success: false,
        error: 'not_found',
        message: 'Érvénytelen vagy lejárt link.',
        status: 404,
      };
    }
  } catch {
    return {
      success: false,
      error: 'not_found',
      message: 'Érvénytelen vagy lejárt link.',
      status: 404,
    };
  }

  // 3. Check token expiry
  const now = new Date();
  const expiresAt = booking.management_token_expires_at
    ? new Date(booking.management_token_expires_at)
    : null;
  if (expiresAt && now > expiresAt) {
    return {
      success: false,
      error: 'token_expired',
      message: 'Ez a link lejárt. Kérlek válaszolj az emailre.',
      status: 410,
    };
  }

  // 4. Check booking state
  if (booking.booking_status !== 'booked') {
    return {
      success: false,
      error: 'invalid_state',
      message: 'Ezt a foglalást nem lehet módosítani.',
      status: 409,
    };
  }

  const currentSlotStart = booking.selected_slot_start;
  const currentSlotEnd = booking.selected_slot_end;
  const bookingId = booking.id;

  // 5. Detect stale manage page (compare normalized timestamps)
  if (
    new Date(currentSlotStart).toISOString() !==
    new Date(expectedOldSlotStart).toISOString()
  ) {
    return {
      success: false,
      error: 'booking_changed',
      message: 'A foglalás időközben megváltozott. Kérlek frissítsd az oldalt.',
      status: 409,
    };
  }

  let newSlotEnd: string;
  try {
    newSlotEnd = await getExpectedSlotEnd(newSlotStart);
  } catch (error) {
    console.error('Availability schedule lookup failed:', error);
    return {
      success: false,
      error: 'service_unavailable',
      message: 'A foglalási időpontok átmenetileg nem ellenőrizhetők.',
      status: 503,
    };
  }

  // 6. Idempotency: same slot requested
  if (isSameSlot(currentSlotStart, currentSlotEnd, newSlotStart, newSlotEnd)) {
    return {
      success: true,
      bookingId,
      businessName: booking.business_name,
      name: booking.name,
      email: booking.email,
      oldSlotStart: new Date(currentSlotStart).toISOString(),
      oldSlotEnd: new Date(currentSlotEnd).toISOString(),
      newSlotStart: new Date(newSlotStart).toISOString(),
      newSlotEnd: new Date(newSlotEnd).toISOString(),
      meetLink: booking.meet_link ?? undefined,
      rescheduleCount: booking.reschedule_count,
      calendarPatched: true,
      idempotent: true,
    };
  }

  // 7. Validate new slot against scheduling rules
  let followsAvailabilityRules: boolean;
  try {
    followsAvailabilityRules = await isSlotValidAccordingToRules(
      newSlotStart,
      newSlotEnd,
    );
  } catch (error) {
    console.error('Availability rule validation failed:', error);
    return {
      success: false,
      error: 'service_unavailable',
      message: 'A foglalási időpontok átmenetileg nem ellenőrizhetők.',
      status: 503,
    };
  }

  if (!followsAvailabilityRules) {
    return {
      success: false,
      error: 'invalid_slot',
      message: 'A kiválasztott időpont nem felel meg a foglalási szabályoknak.',
      status: 400,
    };
  }

  // 8. Check reschedule cutoff
  if (now > getCutoffTime(currentSlotStart)) {
    return {
      success: false,
      error: 'cutoff_passed',
      message:
        'A módosítási határidő lejárt. Kérlek válaszolj az emailre, és személyesen intézkedünk.',
      status: 403,
    };
  }

  // 9. Check max reschedules
  const maxReschedules = Number.isFinite(env.auditMaxReschedules)
    ? env.auditMaxReschedules
    : 2;
  if (booking.reschedule_count >= maxReschedules) {
    return {
      success: false,
      error: 'max_reschedules_reached',
      message: 'További módosításhoz válaszolj a visszaigazoló emailre.',
      status: 403,
    };
  }

  // 10. Audit log: request is fully validated
  await trackEvent({
    eventName: 'booking_reschedule_requested',
    sessionId: booking.session_id,
    bookingId,
    metadata: {
      oldSlotStart: currentSlotStart,
      oldSlotEnd: currentSlotEnd,
      newSlotStart,
      newSlotEnd,
    },
  });

  // 11. Atomically reserve the new slot in DB
  const newTokenExpiry = getTokenExpiry(newSlotEnd).toISOString();
  const { data: updated, error: updateError } = await getSupabase()
    .from('audit_bookings')
    .update({
      previous_slot_start: currentSlotStart,
      previous_slot_end: currentSlotEnd,
      selected_slot_start: newSlotStart,
      selected_slot_end: newSlotEnd,
      calendar_sync_status: 'pending',
      rescheduled_at: now.toISOString(),
      reschedule_count: booking.reschedule_count + 1,
      management_token_expires_at: newTokenExpiry,
      updated_at: now.toISOString(),
    })
    .eq('id', bookingId)
    .eq('booking_status', 'booked')
    .eq('selected_slot_start', currentSlotStart)
    .select('*')
    .single();

  if (updateError || !updated) {
    // Could be a race or the slot is already taken via unique index
    const { data: current } = await getSupabase()
      .from('audit_bookings')
      .select('selected_slot_start, booking_status')
      .eq('id', bookingId)
      .single();

    if (current?.selected_slot_start !== currentSlotStart) {
      return {
        success: false,
        error: 'booking_changed',
        message:
          'A foglalás időközben megváltozott. Kérlek frissítsd az oldalt.',
        status: 409,
      };
    }

    console.error('Reschedule DB reservation failed:', updateError);
    return {
      success: false,
      error: 'slot_taken',
      message:
        'Az új időpontot épp lefoglalták. Kérlek válassz másik időpontot.',
      status: 409,
    };
  }

  const oldSlotStart = currentSlotStart;
  const oldSlotEnd = currentSlotEnd;
  const oldTokenExpiry = booking.management_token_expires_at;

  async function rollbackReservedSlot(): Promise<boolean> {
    const { error } = await getSupabase()
      .from('audit_bookings')
      .update({
        previous_slot_start: null,
        previous_slot_end: null,
        selected_slot_start: oldSlotStart,
        selected_slot_end: oldSlotEnd,
        calendar_sync_status: 'synced',
        rescheduled_at: null,
        reschedule_count: booking.reschedule_count,
        management_token_expires_at: oldTokenExpiry,
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .eq('selected_slot_start', newSlotStart);

    if (error) console.error('Reschedule availability rollback failed:', error);
    return !error;
  }

  // 12. Final freeBusy check on the new slot
  let slotAvailable: boolean;
  try {
    slotAvailable = await isSlotAvailable(newSlotStart, newSlotEnd);
  } catch (error) {
    console.error('Final freeBusy check failed:', error);
    const rolledBack = await rollbackReservedSlot();
    await trackEvent({
      eventName: 'booking_reschedule_failed',
      sessionId: booking.session_id,
      bookingId,
      metadata: {
        reason: rolledBack
          ? 'availability_check_failed'
          : 'availability_check_failed_rollback_failed',
      },
    });

    return {
      success: false,
      error: 'service_unavailable',
      message: rolledBack
        ? 'Az új időpont most nem ellenőrizhető. Az eredeti foglalás változatlan maradt.'
        : 'A naptár ellenőrzése sikertelen volt. Kérlek válaszolj a visszaigazoló emailre.',
      status: 503,
    };
  }

  if (!slotAvailable) {
    const rolledBack = await rollbackReservedSlot();

    await trackEvent({
      eventName: 'booking_reschedule_failed',
      sessionId: booking.session_id,
      bookingId,
      metadata: {
        reason: rolledBack
          ? 'freebusy_conflict'
          : 'freebusy_conflict_rollback_failed',
      },
    });

    if (!rolledBack) {
      return {
        success: false,
        error: 'calendar_sync_failed',
        message:
          'Az időpontütközés kezelése nem fejeződött be. Kérlek válaszolj a visszaigazoló emailre.',
        status: 500,
      };
    }

    return {
      success: false,
      error: 'slot_taken',
      message:
        'Az új időpontot épp lefoglalták. Kérlek válassz másik időpontot.',
      status: 409,
    };
  }

  // 13. Patch Google Calendar event
  const eventId = booking.google_calendar_event_id;
  let patchResult;
  let finalCalendarStatus: 'synced' | 'failed' = 'synced';
  let rollbackReason: string | null = null;

  if (eventId && googleCalendarProvider.patchEvent) {
    patchResult = await googleCalendarProvider.patchEvent(eventId, {
      start: newSlotStart,
      end: newSlotEnd,
    });

    if (!patchResult.ok) {
      // Patch failed — verify actual Calendar state before deciding
      if (googleCalendarProvider.getEvent) {
        const currentEvent = await googleCalendarProvider.getEvent(eventId);

        if (currentEvent.ok && currentEvent.start && currentEvent.end) {
          const eventStartMatchesNew =
            new Date(currentEvent.start).toISOString() === newSlotStart;

          if (eventStartMatchesNew) {
            // Patch actually succeeded; response was lost
            console.log(
              'Calendar patch reported failure but event is on new slot; treating as success',
            );
            finalCalendarStatus = 'synced';
          } else {
            // Event is still on old slot — safe to rollback DB
            rollbackReason = 'calendar_patch_failed';
          }
        } else {
          // Cannot verify Calendar state — do not blindly rollback
          rollbackReason = 'calendar_state_unverified';
        }
      } else {
        rollbackReason = 'calendar_state_unverified';
      }
    }
  } else {
    // No event to patch
    console.warn('No Google Calendar event ID to patch for booking', bookingId);
  }

  // 14. Handle rollback or finalize
  if (rollbackReason === 'calendar_patch_failed') {
    // Safe rollback to old slot
    const { error: rollbackError } = await getSupabase()
      .from('audit_bookings')
      .update({
        previous_slot_start: null,
        previous_slot_end: null,
        selected_slot_start: oldSlotStart,
        selected_slot_end: oldSlotEnd,
        calendar_sync_status: 'synced',
        rescheduled_at: null,
        reschedule_count: booking.reschedule_count,
        management_token_expires_at: oldTokenExpiry,
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId);

    if (rollbackError) {
      console.error('Reschedule rollback failed:', rollbackError);
      finalCalendarStatus = 'failed';
      rollbackReason = 'rollback_failed';
    } else {
      await trackEvent({
        eventName: 'booking_reschedule_failed',
        sessionId: booking.session_id,
        bookingId,
        metadata: { reason: rollbackReason },
      });

      return {
        success: false,
        error: 'calendar_sync_failed',
        message:
          'Nem sikerült frissíteni a naptárat, ezért az eredeti időpont maradt érvényben. Kérlek válaszolj az emailre.',
        status: 500,
      };
    }
  }

  // If we are here, either patch succeeded or state is unverified/rollback failed
  const dbUpdate: Record<string, unknown> = {
    calendar_sync_status: finalCalendarStatus,
    updated_at: new Date().toISOString(),
  };

  // On unverified/rollback-failed, keep the new slot but mark sync failed
  await getSupabase()
    .from('audit_bookings')
    .update(dbUpdate)
    .eq('id', bookingId);

  if (finalCalendarStatus === 'failed') {
    await trackEvent({
      eventName: 'booking_reschedule_failed',
      sessionId: booking.session_id,
      bookingId,
      metadata: {
        reason: rollbackReason,
        oldSlotStart,
        oldSlotEnd,
        newSlotStart,
        newSlotEnd,
      },
    });

    return {
      success: false,
      error: 'calendar_sync_failed',
      message:
        'A foglalás módosult, de a naptár szinkronizálása nem sikerült. Kérlek válaszolj az emailre.',
      status: 500,
    };
  }

  // 15. Success
  await rescheduleBookingReminders(bookingId);

  await trackEvent({
    eventName: 'booking_rescheduled',
    sessionId: booking.session_id,
    bookingId,
    metadata: {
      oldSlotStart,
      oldSlotEnd,
      newSlotStart,
      newSlotEnd,
      rescheduleCount: updated.reschedule_count,
    },
  });

  return {
    success: true,
    bookingId,
    businessName: updated.business_name,
    name: updated.name,
    email: updated.email,
    oldSlotStart: new Date(oldSlotStart).toISOString(),
    oldSlotEnd: new Date(oldSlotEnd).toISOString(),
    newSlotStart: new Date(newSlotStart).toISOString(),
    newSlotEnd: new Date(newSlotEnd).toISOString(),
    meetLink: updated.meet_link ?? undefined,
    rescheduleCount: updated.reschedule_count,
    calendarPatched: true,
  };
}
