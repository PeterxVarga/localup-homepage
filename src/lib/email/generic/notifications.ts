// ============================================================
// Generic booking email notifications — atomic claim + idempotent send
//
// Uses INSERT as a distributed claim: the first caller that successfully
// inserts the (booking_id, notification_type, recipient_type, event_key)
// row is the only one allowed to send that email. A unique violation means
// another process already claimed it; we skip sending.
//
// Email failures are recorded with stable, non-sensitive error codes.
// Provider error messages, tokens and payloads never leak into the row
// or logs.
// ============================================================

import { getSupabase } from '../../supabase';
import type {
  GenericBookingNotificationType,
  GenericBookingRecipientType,
  GenericEmailSendOutcome,
  NotificationRecord,
} from './types';

function buildIdempotencyKey(params: {
  bookingId: string;
  notificationType: GenericBookingNotificationType;
  recipientType: GenericBookingRecipientType;
  eventKey: string;
}): string {
  return [
    params.bookingId,
    params.notificationType,
    params.recipientType,
    params.eventKey,
  ].join(':');
}

export async function claimNotificationPending(params: {
  bookingId: string;
  notificationType: GenericBookingNotificationType;
  recipientType: GenericBookingRecipientType;
  eventKey: string;
  recipientEmail: string;
}): Promise<NotificationRecord | null> {
  const { data, error } = await getSupabase()
    .from('generic_booking_notifications')
    .insert({
      booking_id: params.bookingId,
      notification_type: params.notificationType,
      recipient_type: params.recipientType,
      event_key: params.eventKey,
      recipient_email: params.recipientEmail,
      delivery_status: 'pending',
    })
    .select(
      'id, booking_id, notification_type, recipient_type, event_key, recipient_email, delivery_status, provider_message_id, attempt_count, last_error_code, sent_at',
    )
    .single();

  if (error) {
    // Unique violation => another process already claimed this version.
    if (error.code === '23505') {
      return null;
    }

    console.error('Failed to claim pending generic notification');
    return null;
  }

  return mapNotificationRow(data);
}

export async function recordNotificationSent(params: {
  bookingId: string;
  notificationType: GenericBookingNotificationType;
  recipientType: GenericBookingRecipientType;
  eventKey: string;
  providerMessageId?: string;
}): Promise<boolean> {
  const { error } = await getSupabase()
    .from('generic_booking_notifications')
    .update({
      delivery_status: 'sent',
      provider_message_id: params.providerMessageId ?? null,
      attempt_count: 1,
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('booking_id', params.bookingId)
    .eq('notification_type', params.notificationType)
    .eq('recipient_type', params.recipientType)
    .eq('event_key', params.eventKey)
    .eq('delivery_status', 'pending');

  if (error) {
    console.error('Failed to record generic notification as sent');
    return false;
  }

  return true;
}

export async function recordNotificationFailed(params: {
  bookingId: string;
  notificationType: GenericBookingNotificationType;
  recipientType: GenericBookingRecipientType;
  eventKey: string;
  errorCode: string;
}): Promise<boolean> {
  const { error } = await getSupabase()
    .from('generic_booking_notifications')
    .update({
      delivery_status: 'failed',
      last_error_code: params.errorCode,
      attempt_count: 1,
      updated_at: new Date().toISOString(),
    })
    .eq('booking_id', params.bookingId)
    .eq('notification_type', params.notificationType)
    .eq('recipient_type', params.recipientType)
    .eq('event_key', params.eventKey)
    .eq('delivery_status', 'pending');

  if (error) {
    console.error('Failed to record generic notification as failed');
    return false;
  }

  return true;
}

export async function loadNotificationByUniqueKey(params: {
  bookingId: string;
  notificationType: GenericBookingNotificationType;
  recipientType: GenericBookingRecipientType;
  eventKey: string;
}): Promise<NotificationRecord | null> {
  const { data, error } = await getSupabase()
    .from('generic_booking_notifications')
    .select(
      'id, booking_id, notification_type, recipient_type, event_key, recipient_email, delivery_status, provider_message_id, attempt_count, last_error_code, sent_at',
    )
    .eq('booking_id', params.bookingId)
    .eq('notification_type', params.notificationType)
    .eq('recipient_type', params.recipientType)
    .eq('event_key', params.eventKey)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return mapNotificationRow(data);
}

export interface NotificationDeps {
  claimPending: typeof claimNotificationPending;
  recordSent: typeof recordNotificationSent;
  recordFailed: typeof recordNotificationFailed;
  loadByUniqueKey: typeof loadNotificationByUniqueKey;
}

function buildNaturalKey(params: {
  bookingId: string;
  notificationType: GenericBookingNotificationType;
  recipientType: GenericBookingRecipientType;
  eventKey: string;
}) {
  return {
    bookingId: params.bookingId,
    notificationType: params.notificationType,
    recipientType: params.recipientType,
    eventKey: params.eventKey,
  };
}

const defaultNotificationDeps: NotificationDeps = {
  claimPending: claimNotificationPending,
  recordSent: recordNotificationSent,
  recordFailed: recordNotificationFailed,
  loadByUniqueKey: loadNotificationByUniqueKey,
};

export async function sendNotification(
  params: {
    bookingId: string;
    notificationType: GenericBookingNotificationType;
    recipientType: GenericBookingRecipientType;
    eventKey: string;
    recipientEmail: string;
    buildPayload: () => { to: string; subject: string; text: string; replyTo: string };
    sendEmail: (payload: {
      to: string;
      subject: string;
      text: string;
      replyTo: string;
      idempotencyKey: string;
    }) => Promise<GenericEmailSendOutcome>;
  },
  deps: Partial<NotificationDeps> = {},
): Promise<boolean> {
  const { claimPending, recordSent, recordFailed, loadByUniqueKey } = {
    ...defaultNotificationDeps,
    ...deps,
  };

  // 1. Try to atomically claim the notification row.
  let notification = await claimPending({
    bookingId: params.bookingId,
    notificationType: params.notificationType,
    recipientType: params.recipientType,
    eventKey: params.eventKey,
    recipientEmail: params.recipientEmail,
  });

  if (!notification) {
    // Another process claimed it. Load the existing row to decide whether
    // this call should be considered already sent.
    const existing = await loadByUniqueKey({
      bookingId: params.bookingId,
      notificationType: params.notificationType,
      recipientType: params.recipientType,
      eventKey: params.eventKey,
    });

    return existing?.deliveryStatus === 'sent';
  }

  if (notification.deliveryStatus !== 'pending') {
    return notification.deliveryStatus === 'sent';
  }

  // 2. We hold the claim: send the email with a deterministic idempotency key.
  const idempotencyKey = buildIdempotencyKey({
    bookingId: params.bookingId,
    notificationType: params.notificationType,
    recipientType: params.recipientType,
    eventKey: params.eventKey,
  });

  const result = await params.sendEmail({
    ...params.buildPayload(),
    idempotencyKey,
  });

  if (result.ok) {
    await recordSent({
      ...buildNaturalKey({
        bookingId: params.bookingId,
        notificationType: params.notificationType,
        recipientType: params.recipientType,
        eventKey: params.eventKey,
      }),
      providerMessageId: result.providerMessageId,
    });
    return true;
  }

  await recordFailed({
    ...buildNaturalKey({
      bookingId: params.bookingId,
      notificationType: params.notificationType,
      recipientType: params.recipientType,
      eventKey: params.eventKey,
    }),
    errorCode: result.error,
  });
  return false;
}

function mapNotificationRow(data: unknown): NotificationRecord {
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    bookingId: String(row.booking_id),
    notificationType: String(row.notification_type) as GenericBookingNotificationType,
    recipientType: String(row.recipient_type) as GenericBookingRecipientType,
    eventKey: String(row.event_key),
    recipientEmail: String(row.recipient_email),
    deliveryStatus: String(row.delivery_status) as 'pending' | 'sent' | 'failed',
    providerMessageId: row.provider_message_id ? String(row.provider_message_id) : null,
    attemptCount: Number(row.attempt_count),
    lastErrorCode: row.last_error_code ? String(row.last_error_code) : null,
    sentAt: row.sent_at ? String(row.sent_at) : null,
  };
}
