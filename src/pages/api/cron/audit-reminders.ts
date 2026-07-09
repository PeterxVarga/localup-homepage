// ============================================================
// POST /api/cron/audit-reminders
// Called by Supabase Cron every 5 minutes.
// Claims due reminder notifications, verifies booking state,
// sends emails, and finalizes the queue records.
//
// Security:
// - Requires Authorization: Bearer <REMINDER_CRON_SECRET>
// - The secret is read from process.env (Vercel env).
// - The Supabase Cron uses the same secret stored in Vault.
// ============================================================

import type { APIRoute } from 'astro';
import { env } from '../../../lib/env';
import { getSupabase, isSupabaseConfigured } from '../../../lib/supabase';
import { decryptManagementToken } from '../../../lib/tokens/crypto';
import { sendReminderEmail } from '../../../lib/email/sendReminderEmail';
import { sendReminderFailureAdminEmail } from '../../../lib/email/sendReminderFailureAdminEmail';
import { trackEvent } from '../../../lib/booking/trackEvent';
import { repairUpcomingReminders } from '../../../lib/booking/reminderScheduling';

const BATCH_SIZE = 20;
const PROCESSING_TIMEOUT_MINUTES = 15;
const MAX_ATTEMPTS = 5;

interface ClaimedReminder {
  id: string;
  booking_id: string;
  notification_type: 'reminder_24h' | 'reminder_1h';
  slot_version: number;
  scheduled_for: string;
  attempts: number;
  lock_token: string;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

/** Timing-safe comparison of two strings. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function computeNextAttemptAt(attempts: number): Date {
  const now = new Date();
  switch (attempts) {
    case 1:
      return new Date(now.getTime() + 5 * 60 * 1000);
    case 2:
      return new Date(now.getTime() + 15 * 60 * 1000);
    case 3:
      return new Date(now.getTime() + 30 * 60 * 1000);
    case 4:
      return new Date(now.getTime() + 60 * 60 * 1000);
    default:
      return new Date(now.getTime() + 60 * 60 * 1000);
  }
}

export const POST: APIRoute = async ({ request }) => {
  // 1. Validate cron secret.
  const authHeader = request.headers.get('authorization') ?? '';
  const providedSecret = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : '';

  const expectedSecret = env.reminderCronSecret;
  if (!expectedSecret || !timingSafeEqual(providedSecret, expectedSecret)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  // 2. Service guard.
  if (!isSupabaseConfigured()) {
    return jsonResponse({ error: 'service_unavailable' }, 503);
  }

  // 3. Repair missing reminders for upcoming bookings (idempotent).
  await repairUpcomingReminders(48);

  // 4. Claim due reminders.
  const { data: claimed, error: claimError } = await getSupabase().rpc(
    'claim_due_reminders',
    {
      p_batch_size: BATCH_SIZE,
      p_processing_timeout_minutes: PROCESSING_TIMEOUT_MINUTES,
      p_max_attempts: MAX_ATTEMPTS,
    },
  );

  if (claimError) {
    console.error('claim_due_reminders failed:', claimError);
    return jsonResponse({ error: 'claim_failed' }, 500);
  }

  const reminders = (claimed ?? []) as ClaimedReminder[];
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const notification of reminders) {
    // 4. Re-read booking and verify pre-send conditions.
    const { data: booking, error: bookingError } = await getSupabase()
      .from('audit_bookings')
      .select(
        'selected_slot_start, selected_slot_end, booking_status, calendar_sync_status, reschedule_count, meet_link, name, email, business_name, management_token_encrypted',
      )
      .eq('id', notification.booking_id)
      .single();

    if (bookingError || !booking) {
      console.error('Reminder booking lookup failed:', bookingError);
      await finalizeFailure(notification, 'booking_lookup_failed', true);
      failed++;
      continue;
    }

    const slotStart = new Date(booking.selected_slot_start);
    const now = new Date();

    const shouldSkip =
      booking.booking_status !== 'booked' ||
      booking.calendar_sync_status !== 'synced' ||
      (booking.reschedule_count ?? 0) !== notification.slot_version ||
      slotStart <= now;

    if (shouldSkip) {
      const reason =
        booking.booking_status !== 'booked'
          ? 'booking_cancelled'
          : booking.calendar_sync_status !== 'synced'
            ? 'booking_not_synced'
            : (booking.reschedule_count ?? 0) !== notification.slot_version
              ? 'stale_slot_version'
              : slotStart <= now
                ? 'appointment_passed'
                : 'presend_check_failed';

      await finalizeCancelled(notification, reason);
      skipped++;
      continue;
    }

    // 5. Decrypt management token for manage URL.
    let manageToken: string;
    try {
      if (!booking.management_token_encrypted) {
        throw new Error('missing encrypted token');
      }
      manageToken = decryptManagementToken(booking.management_token_encrypted);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Reminder token decryption failed:', message);
      await finalizeFailure(notification, `token_decryption_failed: ${message}`, true);
      failed++;
      continue;
    }

    // 6. Send reminder email.
    const sendResult = await sendReminderEmail({
      bookingId: notification.booking_id,
      email: booking.email,
      name: booking.name,
      businessName: booking.business_name,
      slotStart: booking.selected_slot_start,
      slotEnd: booking.selected_slot_end,
      meetLink: booking.meet_link || undefined,
      manageToken,
      type: notification.notification_type,
      slotVersion: notification.slot_version,
    });

    if (sendResult.success) {
      const finalized = await getSupabase().rpc('finalize_reminder_sent', {
        p_notification_id: notification.id,
        p_lock_token: notification.lock_token,
        p_provider_message_id: sendResult.emailId,
      });

      if (finalized) {
        sent++;
      } else {
        // Another worker finalized it; idempotency key prevented double send.
        skipped++;
      }
    } else {
      const isFinal = notification.attempts >= MAX_ATTEMPTS;
      await finalizeFailure(notification, sendResult.error, isFinal);
      failed++;
    }
  }

  return jsonResponse(
    {
      claimed: reminders.length,
      sent,
      failed,
      skipped,
    },
    200,
  );
};

async function finalizeCancelled(
  notification: ClaimedReminder,
  reason: string,
): Promise<void> {
  const finalized = await getSupabase().rpc('finalize_reminder_cancelled', {
    p_notification_id: notification.id,
    p_lock_token: notification.lock_token,
    p_reason: reason,
  });

  if (!finalized) {
    // Another worker already finalized this row.
    return;
  }

  await trackEvent({
    eventName: 'reminder_cancelled',
    sessionId: '',
    bookingId: notification.booking_id,
    metadata: {
      notification_id: notification.id,
      notification_type: notification.notification_type,
      reason,
    },
  });
}

async function finalizeFailure(
  notification: ClaimedReminder,
  error: string,
  isFinal: boolean,
): Promise<void> {
  const nextAttemptAt = isFinal ? null : computeNextAttemptAt(notification.attempts);

  const finalized = await getSupabase().rpc('finalize_reminder_failed', {
    p_notification_id: notification.id,
    p_lock_token: notification.lock_token,
    p_error: error,
    p_next_attempt_at: nextAttemptAt?.toISOString() ?? null,
    p_max_attempts: MAX_ATTEMPTS,
  });

  if (!finalized) {
    // Lock token mismatch: another worker already finalized.
    return;
  }

  if (isFinal) {
    // Fetch booking details for admin alert.
    const { data: booking } = await getSupabase()
      .from('audit_bookings')
      .select('selected_slot_start, email')
      .eq('id', notification.booking_id)
      .single();

    await sendReminderFailureAdminEmail({
      bookingId: notification.booking_id,
      notificationId: notification.id,
      notificationType: notification.notification_type,
      slotStart: booking?.selected_slot_start ?? notification.scheduled_for,
      email: booking?.email ?? 'unknown',
      attempts: notification.attempts,
      lastError: error,
    });

    await getSupabase()
      .from('booking_notifications')
      .update({ admin_alerted_at: new Date().toISOString() })
      .eq('id', notification.id);

    await trackEvent({
      eventName: 'reminder_permanently_failed',
      sessionId: '',
      bookingId: notification.booking_id,
      metadata: {
        notification_id: notification.id,
        notification_type: notification.notification_type,
        error,
      },
    });
  }
}
