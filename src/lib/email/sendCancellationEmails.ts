// ============================================================
// Cancellation emails (Hungarian)
// ============================================================

import { getResend, isConfigured } from './client';
import { env, siteUrl } from '../env';

const DISPLAY_TIMEZONE = 'Europe/Budapest';

interface CancellationParams {
  bookingId: string;
  businessName: string;
  name: string;
  email: string;
  slotStart: string;
  slotEnd: string;
  reason?: string;
  calendarDeleted: boolean;
}

export interface EmailSendResult {
  success: true;
  emailId: string;
}

export interface EmailSendError {
  success: false;
  error: string;
}

function formatSlot(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const dateStr = startDate.toLocaleDateString('hu-HU', {
    timeZone: DISPLAY_TIMEZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const startTime = startDate.toLocaleTimeString('hu-HU', {
    timeZone: DISPLAY_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  });
  const endTime = endDate.toLocaleTimeString('hu-HU', {
    timeZone: DISPLAY_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${dateStr}, ${startTime}–${endTime}`;
}

function formatCancelledAt(): string {
  return new Date().toLocaleString('hu-HU', {
    timeZone: DISPLAY_TIMEZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Send a short confirmation to the customer that the cancellation succeeded.
 * No manage link — only a CTA to book a new slot.
 */
export async function sendUserCancellationEmail(
  params: CancellationParams,
): Promise<EmailSendResult | EmailSendError> {
  if (!isConfigured()) {
    return { success: false, error: 'Resend not configured' };
  }

  const slotText = formatSlot(params.slotStart, params.slotEnd);
  const bookNewUrl = `${siteUrl()}/audit`;

  try {
    const { data, error } = await getResend().emails.send({
      from: env.emailFrom,
      replyTo: env.emailReplyTo,
      to: params.email,
      subject: 'Az időpontodat sikeresen lemondtuk',
      text: [
        `Szia ${params.name}!`,
        '',
        'Az időpontodat sikeresen lemondtuk.',
        '',
        `Foglalás: LocalUp audit`,
        `Időpont: ${slotText}`,
        '',
        'Ha új időpontot szeretnél, foglalj itt:',
        `  ${bookNewUrl}`,
        '',
        '— LocalUp csapat',
      ].join('\n'),
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, emailId: data?.id ?? 'unknown' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Send detailed cancellation notification to the admin.
 * Highlights manual action if the calendar event could not be deleted.
 */
export async function sendAdminCancellationEmail(
  params: CancellationParams,
): Promise<EmailSendResult | EmailSendError> {
  if (!isConfigured()) {
    return { success: false, error: 'Resend not configured' };
  }

  const slotText = formatSlot(params.slotStart, params.slotEnd);
  const cancelledAt = formatCancelledAt();
  const needsManualAction = !params.calendarDeleted;

  const subject = needsManualAction
    ? `⚠️ Manual action required: calendar event deletion failed — ${params.businessName}`
    : `Foglalás lemondva — ${params.businessName}`;

  try {
    const { data, error } = await getResend().emails.send({
      from: env.emailFrom,
      replyTo: env.emailReplyTo,
      to: env.adminEmail,
      subject,
      text: [
        needsManualAction
          ? '⚠️ MANUAL ACTION REQUIRED: a booking was cancelled but the Google Calendar event could not be deleted.'
          : 'Egy foglalás le lett mondva.',
        '',
        `Ügyfél: ${params.name}`,
        `Email: ${params.email}`,
        `Vállalkozás: ${params.businessName}`,
        '',
        `Eredeti időpont: ${slotText}`,
        `Lemondás ideje: ${cancelledAt}`,
        params.reason ? `Lemondás oka: ${params.reason}` : 'Lemondás oka: nincs megadva',
        '',
        `Google Calendar esemény törölve: ${params.calendarDeleted ? 'Igen' : 'Nem — kérlek töröld kézzel'}`,
        `Slot felszabadult: Igen`,
        '',
        `Booking ID: ${params.bookingId}`,
        '',
        '— LocalUp booking system',
      ].join('\n'),
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, emailId: data?.id ?? 'unknown' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
