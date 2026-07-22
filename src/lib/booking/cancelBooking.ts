// ============================================================
// Cancel booking — framework-neutral
// Validates token, checks cutoff, atomically cancels, deletes calendar event
// ============================================================

import { getSupabase } from '../supabase';
import { hashManagementToken } from '../tokens/crypto';
import { googleCalendarProvider } from '../calendar/provider/google';
import { trackEvent } from './trackEvent';
import { cancelBookingReminders } from './reminderScheduling';
import { getBookingServiceContextById } from '../booking-service/queries';

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
 * Delete a calendar event via the configured provider.
 * Updates the booking's calendar_sync_status and returns whether deletion succeeded.
 */
async function deleteCalendarEvent(
  bookingId: string,
  eventId: string,
  sessionId: string | null,
): Promise<boolean> {
  if (!googleCalendarProvider.deleteEvent) {
    console.error('Calendar provider does not support deletion');
    await getSupabase()
      .from('audit_bookings')
      .update({ calendar_sync_status: 'failed' })
      .eq('id', bookingId);

    await trackEvent({
      eventName: 'booking_cancel_failed',
      sessionId: sessionId || '',
      bookingId,
      metadata: { reason: 'provider_delete_unsupported' },
    });
    return false;
  }

  try {
    console.log('Attempting calendar event deletion');
    const deleteResult = await googleCalendarProvider.deleteEvent(eventId);

    if (deleteResult.ok) {
      console.log('Calendar event deletion succeeded');
      await getSupabase()
        .from('audit_bookings')
        .update({ calendar_sync_status: 'synced' })
        .eq('id', bookingId);
      return true;
    }

    console.error('Calendar event deletion failed:', deleteResult.code, deleteResult.error);
    await getSupabase()
      .from('audit_bookings')
      .update({ calendar_sync_status: 'failed' })
      .eq('id', bookingId);

    await trackEvent({
      eventName: 'booking_cancel_failed',
      sessionId: sessionId || '',
      bookingId,
      metadata: { reason: 'calendar_delete_failed', code: deleteResult.code, error: deleteResult.error },
    });
    return false;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('Calendar event deletion threw:', errorMessage);
    await getSupabase()
      .from('audit_bookings')
      .update({ calendar_sync_status: 'failed' })
      .eq('id', bookingId);

    await trackEvent({
      eventName: 'booking_cancel_failed',
      sessionId: sessionId || '',
      bookingId,
      metadata: { reason: 'calendar_delete_exception', error: errorMessage },
    });
    return false;
  }
}

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

  console.log('Cancel: booking lookup', lookupError ? 'failed' : 'completed');

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

  console.log('Cancel: booking found');
  console.log('Cancel: calendar event ID present:', !!booking.google_calendar_event_id);
  console.log('Cancel: calendar provider delete configured:', !!googleCalendarProvider.deleteEvent);

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
  // If a previous cancellation failed to delete the Calendar event, retry deletion.
  if (booking.booking_status === 'cancelled') {
    const eventId = booking.google_calendar_event_id;
    const needsRetry =
      !!eventId &&
      booking.calendar_sync_status === 'failed' &&
      googleCalendarProvider.deleteEvent;

    if (needsRetry) {
      console.log('Cancel: retrying calendar deletion for already cancelled booking');
      const calendarDeleted = await deleteCalendarEvent(
        booking.id,
        eventId,
        booking.session_id,
      );
      return {
        success: true,
        status: 'cancelled',
        alreadyCancelled: true,
        calendarDeleted,
      };
    }

    return {
      success: true,
      status: 'cancelled',
      alreadyCancelled: true,
      calendarDeleted: booking.calendar_sync_status === 'synced',
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

  // 2b. Load service context for cancel policy.
  if (!booking.service_id) {
    return {
      success: false,
      error: 'service_unavailable',
      message: 'A foglalási szolgáltatás nem azonosítható.',
      status: 503,
    };
  }

  let service;
  try {
    service = await getBookingServiceContextById(booking.service_id);
  } catch (err) {
    console.error('Cancel: failed to load service context', err);
    return {
      success: false,
      error: 'service_unavailable',
      message: 'A foglalási szolgáltatás nem azonosítható.',
      status: 503,
    };
  }

  // 5. Check cutoff time
  const slotStart = new Date(booking.selected_slot_start);
  const cutoffTime = new Date(
    slotStart.getTime() - service.cancelCutoffHours * 60 * 60 * 1000,
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
      .select('booking_status, calendar_sync_status, google_calendar_event_id, session_id')
      .eq('id', booking.id)
      .single();

    if (current?.booking_status === 'cancelled') {
      const eventId = current.google_calendar_event_id;
      const needsRetry =
        !!eventId &&
        current.calendar_sync_status === 'failed' &&
        googleCalendarProvider.deleteEvent;

      if (needsRetry) {
        console.log('Cancel: race resolved to cancelled; retrying calendar deletion');
        const calendarDeleted = await deleteCalendarEvent(
          booking.id,
          eventId,
          current.session_id,
        );
        return {
          success: true,
          status: 'cancelled',
          alreadyCancelled: true,
          calendarDeleted,
        };
      }

      return {
        success: true,
        status: 'cancelled',
        alreadyCancelled: true,
        calendarDeleted: current.calendar_sync_status === 'synced',
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
    sessionId: updated.session_id,
    bookingId: updated.id,
    metadata: { reason: reason || null },
  });

  // 8. Delete Google Calendar event
  const eventId = updated.google_calendar_event_id;
  let calendarDeleted = false;

  if (eventId) {
    if (!googleCalendarProvider.deleteEvent) {
      console.error('Cancel: event ID present but provider does not support deletion');
      await getSupabase()
        .from('audit_bookings')
        .update({ calendar_sync_status: 'failed' })
        .eq('id', updated.id);

      await trackEvent({
        eventName: 'booking_cancel_failed',
        sessionId: updated.session_id || '',
        bookingId: updated.id,
        metadata: { reason: 'provider_delete_unsupported' },
      });

      return {
        success: true,
        status: 'cancelled',
        calendarDeleted: false,
      };
    }

    calendarDeleted = await deleteCalendarEvent(
      updated.id,
      eventId,
      updated.session_id,
    );
  } else {
    // No event to delete — treat as synced
    console.log('Cancel: no calendar event ID; marking synced');
    await getSupabase()
      .from('audit_bookings')
      .update({ calendar_sync_status: 'synced' })
      .eq('id', updated.id);
    calendarDeleted = true;
  }

  await cancelBookingReminders(updated.id);

  return {
    success: true,
    status: 'cancelled',
    calendarDeleted,
  };
}
