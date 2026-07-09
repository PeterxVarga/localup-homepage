// ============================================================
// Admin alert for permanently failed reminder emails.
// ============================================================

import { getResend, isConfigured } from './client';
import { env } from '../env';

export interface ReminderFailureAdminEmailParams {
  bookingId: string;
  notificationId: string;
  notificationType: string;
  slotStart: string;
  email: string;
  attempts: number;
  lastError: string;
}

export interface EmailSendResult {
  success: true;
  emailId: string;
}

export interface EmailSendError {
  success: false;
  error: string;
}

export async function sendReminderFailureAdminEmail(
  params: ReminderFailureAdminEmailParams,
): Promise<EmailSendResult | EmailSendError> {
  if (!isConfigured()) {
    return { success: false, error: 'Resend not configured' };
  }

  const idempotencyKey = `audit-reminder-failure/${params.notificationId}`;

  try {
    const { data, error } = await getResend().emails.send(
      {
        from: env.emailFrom,
        replyTo: env.emailReplyTo,
        to: env.adminEmail,
        subject: `⚠️ Manual action: reminder permanently failed — ${params.bookingId.slice(0, 8)}`,
        text: [
          'A booking reminder could not be delivered after all retry attempts.',
          '',
          `Booking ID: ${params.bookingId}`,
          `Notification ID: ${params.notificationId}`,
          `Type: ${params.notificationType}`,
          `Customer email: ${params.email}`,
          `Slot start: ${params.slotStart}`,
          `Attempts: ${params.attempts}`,
          `Last error: ${params.lastError}`,
          '',
          'Please follow up manually if needed.',
          '',
          '— LocalUp booking system',
        ].join('\n'),
      },
      { idempotencyKey },
    );

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, emailId: data?.id ?? 'unknown' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
