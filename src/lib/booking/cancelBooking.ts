// ============================================================
// Cancel booking — framework-neutral
// Validates token, checks cutoff, atomically cancels, deletes calendar event
// ============================================================

import { getSupabase } from '../supabase';
import { env } from '../env';
import { hashManagementToken } from '../tokens/crypto';
import { googleCalendarProvider } from '../calendar/provider/google';
import { trackEvent } from './trackEvent';

export interface CancelBookingResult {
  success: true;
  status: 'cancelled';
  alreadyCancelled?: boolean;
  calendarDeleted: boolean;
}

export interface CancelBookingError {
  success: false;
  error: string;
  message: string;
  status?: number;
}

export type CancelBookingOutcome = CancelBookingResult | CancelBookingError;

/**
 * Cancel a booking using a raw management token.
 */
export async function cancelBooking(
  rawToken: string,
  reason?: string,
): Promise<CancelBookingOutcome> {
  const tokenHash = hashManagementToken(rawToken);

  // 1. Lookup booking by token hash
  const { data: booking, error: lookupError } = await getSupabase()
    .from('audit_bookings')
    .select('*')
    .eq('management_token_hash', tokenHash)
    .maybeSingle();

  if (lookupError) {
    console.error('Cancel booking lookup failed:', lookupError);
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

  // 2. Check token expiry
  const now = new Date();
  const expiresAt = booking.management_token_expires_at
    ? new Date(booking.management_token_expires_at)
    : null;
  if (expiresAt && now > expiresAt) {
    return {
      success: false,
      error: 'token_expired',
      message: 'Ez a link lejárt. Kérlek válaszolj az eredeti emailre.',
      status: 410,
    };
  }

  // 3. Idempotency: already cancelled
  if (booking.booking_status === 'cancelled') {
    return {
      success: true,
      status: 'cancelled',
      alreadyCancelled: true,
      calendarDeleted: true,
    };
  }

  // 4. Validate state transition
  if (booking.booking_status !== 'booked' && booking.booking_status !== 'pending') {
    return {
      success: false,
      error: 'invalid_state',
      message: 'Ezt a foglalást nem lehet lemondani.',
      status: 409,
    };
  }

  // 5. Check cutoff time
  const slotStart = new Date(booking.selected_slot_start);
  const cutoffHours = Number.isFinite(env.auditCancelCutoffHours)
    ? env.auditCancelCutoffHours
    : 12;
  const cutoffTime = new Date(
    slotStart.getTime() - cutoffHours * 60 * 60 * 1000,
  );

  if (now > cutoffTime) {
    return {
      success: false,
      error: 'cutoff_passed',
      message:
        'A lemondási határidő lejárt. Kérlek válaszolj az emailre, és személyesen intézkedünk.',
      status: 403,
    };
  }

  // 6. Atomically cancel in DB
  const { data: updated, error: updateError } = await getSupabase()
    .from('audit_bookings')
    .update({
      booking_status: 'cancelled',
      calendar_sync_status: 'pending',
      cancelled_at: now.toISOString(),
      cancel_reason: reason || null,
      updated_at: now.toISOString(),
    })
    .eq('id', booking.id)
    .eq('booking_status', booking.booking_status)
    .select('*')
    .single();

  if (updateError || !updated) {
    // Could be race: another request changed status in between
    const { data: current } = await getSupabase()
      .from('audit_bookings')
      .select('booking_status')
      .eq('id', booking.id)
      .single();

    if (current?.booking_status === 'cancelled') {
      return {
        success: true,
        status: 'cancelled',
        alreadyCancelled: true,
        calendarDeleted: true,
      };
    }

    console.error('Cancel booking update failed:', updateError);
    return {
      success: false,
      error: 'db_error',
      message: 'Something went wrong. Please try again.',
      status: 500,
    };
  }

  // 7. Audit log
  await trackEvent({
    eventName: 'booking_cancelled',
    sessionId: booking.session_id,
    bookingId: booking.id,
    metadata: { reason: reason || null },
  });

  // 8. Delete Google Calendar event
  let calendarDeleted = false;
  const eventId = booking.google_calendar_event_id;

  if (eventId && googleCalendarProvider.deleteEvent) {
    try {
      const deleteResult = await googleCalendarProvider.deleteEvent(eventId);
      calendarDeleted = deleteResult.ok;

      if (!deleteResult.ok) {
        console.error('Calendar event deletion failed:', deleteResult.error);
        await getSupabase()
          .from('audit_bookings')
          .update({ calendar_sync_status: 'failed' })
          .eq('id', booking.id);

        await trackEvent({
          eventName: 'booking_cancel_failed',
          sessionId: booking.session_id,
          bookingId: booking.id,
          metadata: { reason: 'calendar_delete_failed', error: deleteResult.error },
        });
      } else {
        await getSupabase()
          .from('audit_bookings')
          .update({ calendar_sync_status: 'synced' })
          .eq('id', booking.id);
      }
    } catch (err) {
      console.error('Calendar event deletion threw:', err);
      await getSupabase()
        .from('audit_bookings')
        .update({ calendar_sync_status: 'failed' })
        .eq('id', booking.id);

      await trackEvent({
        eventName: 'booking_cancel_failed',
        sessionId: booking.session_id,
        bookingId: booking.id,
        metadata: { reason: 'calendar_delete_exception' },
      });
    }
  } else {
    // No event to delete — treat as synced
    await getSupabase()
      .from('audit_bookings')
      .update({ calendar_sync_status: 'synced' })
      .eq('id', booking.id);
    calendarDeleted = true;
  }

  return {
    success: true,
    status: 'cancelled',
    calendarDeleted,
  };
}
