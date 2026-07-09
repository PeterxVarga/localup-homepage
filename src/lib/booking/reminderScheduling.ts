// ============================================================
// Reminder scheduling — domain layer
// Creates, reschedules, and cancels booking reminder records.
//
// Reminders are stored in public.booking_notifications and processed
// by the Supabase Cron → /api/cron/audit-reminders worker.
// ============================================================

import { getSupabase } from '../supabase';

const REMINDER_TYPES = ['reminder_24h', 'reminder_1h'] as const;
type ReminderType = (typeof REMINDER_TYPES)[number];

interface ReminderSpec {
  type: ReminderType;
  offsetMinutes: number;
}

const REMINDER_SPECS: ReminderSpec[] = [
  { type: 'reminder_24h', offsetMinutes: 24 * 60 },
  { type: 'reminder_1h', offsetMinutes: 60 },
];

function computeScheduledFor(slotStart: string, offsetMinutes: number): Date {
  return new Date(
    new Date(slotStart).getTime() - offsetMinutes * 60 * 1000,
  );
}

/**
 * Create pending reminder records for a newly confirmed booking.
 * Skips reminders whose scheduled_for is already in the past.
 * Safe to call multiple times (ON CONFLICT DO NOTHING).
 */
export async function scheduleBookingReminders(
  bookingId: string,
): Promise<void> {
  const { data: booking, error } = await getSupabase()
    .from('audit_bookings')
    .select('selected_slot_start, reschedule_count')
    .eq('id', bookingId)
    .single();

  if (error || !booking) {
    console.error('scheduleBookingReminders: booking lookup failed', error);
    return;
  }

  const slotVersion = booking.reschedule_count ?? 0;
  const now = new Date();
  const reminders = REMINDER_SPECS
    .map((spec) => ({
      booking_id: bookingId,
      notification_type: spec.type,
      slot_version: slotVersion,
      scheduled_for: computeScheduledFor(
        booking.selected_slot_start,
        spec.offsetMinutes,
      ).toISOString(),
      status: 'pending' as const,
    }))
    .filter((r) => new Date(r.scheduled_for) > now);

  if (reminders.length === 0) return;

  const { error: insertError } = await getSupabase()
    .from('booking_notifications')
    .upsert(reminders, {
      onConflict: 'booking_id,notification_type,slot_version',
      ignoreDuplicates: true,
    });

  if (insertError) {
    console.error('scheduleBookingReminders: insert failed', insertError);
  }
}

/**
 * Called after a successful reschedule.
 * Cancels pending/failed reminders for old slot versions and creates
 * fresh reminders for the new slot.
 */
export async function rescheduleBookingReminders(
  bookingId: string,
): Promise<void> {
  // 1. Cancel non-sent reminders for any slot version.
  const { error: cancelError } = await getSupabase()
    .from('booking_notifications')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('booking_id', bookingId)
    .in('status', ['pending', 'failed']);

  if (cancelError) {
    console.error('rescheduleBookingReminders: cancel failed', cancelError);
  }

  // 2. Create reminders for the current slot.
  await scheduleBookingReminders(bookingId);
}

/**
 * Called after a successful cancellation.
 * Marks all non-sent reminders as cancelled.
 */
export async function cancelBookingReminders(bookingId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('booking_notifications')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('booking_id', bookingId)
    .in('status', ['pending', 'processing', 'failed']);

  if (error) {
    console.error('cancelBookingReminders: update failed', error);
  }
}

/**
 * Repair missing reminders for upcoming booked+synced bookings.
 * Idempotent: uses ON CONFLICT DO NOTHING.
 * Should be called at the start of each cron run to recover from
 * transient scheduling failures.
 */
export async function repairUpcomingReminders(
  hoursAhead = 48,
): Promise<void> {
  const now = new Date().toISOString();
  const upperBound = new Date(
    Date.now() + hoursAhead * 60 * 60 * 1000,
  ).toISOString();

  const { data: bookings, error } = await getSupabase()
    .from('audit_bookings')
    .select('id, selected_slot_start, reschedule_count')
    .eq('booking_status', 'booked')
    .eq('calendar_sync_status', 'synced')
    .gt('selected_slot_start', now)
    .lte('selected_slot_start', upperBound);

  if (error) {
    console.error('repairUpcomingReminders: lookup failed', error);
    return;
  }

  for (const booking of bookings ?? []) {
    const slotVersion = booking.reschedule_count ?? 0;
    const reminders = REMINDER_SPECS
      .map((spec) => ({
        booking_id: booking.id,
        notification_type: spec.type,
        slot_version: slotVersion,
        scheduled_for: computeScheduledFor(
          booking.selected_slot_start,
          spec.offsetMinutes,
        ).toISOString(),
        status: 'pending' as const,
      }))
      .filter((r) => new Date(r.scheduled_for) > new Date(now));

    if (reminders.length === 0) continue;

    const { error: upsertError } = await getSupabase()
      .from('booking_notifications')
      .upsert(reminders, {
        onConflict: 'booking_id,notification_type,slot_version',
        ignoreDuplicates: true,
      });

    if (upsertError) {
      console.error(
        'repairUpcomingReminders: upsert failed for booking',
        booking.id,
        upsertError,
      );
    }
  }
}
