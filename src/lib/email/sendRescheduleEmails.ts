// ============================================================
// Reschedule emails (Hungarian)
// ============================================================

import { getResend, isConfigured } from './client';
import { env, siteUrl } from '../env';

interface RescheduleEmailParams {
  bookingId: string;
  businessName: string;
  name: string;
  email: string;
  oldSlotStart: string;
  oldSlotEnd: string;
  newSlotStart: string;
  newSlotEnd: string;
  meetLink?: string;
  manageToken: string;
  rescheduleCount: number;
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
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const startTime = startDate.toLocaleTimeString('hu-HU', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const endTime = endDate.toLocaleTimeString('hu-HU', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${dateStr}, ${startTime}–${endTime}`;
}

export async function sendUserRescheduleEmail(
  params: RescheduleEmailParams,
): Promise<EmailSendResult | EmailSendError> {
  if (!isConfigured()) {
    return { success: false, error: 'Resend not configured' };
  }

  const oldSlotText = formatSlot(params.oldSlotStart, params.oldSlotEnd);
  const newSlotText = formatSlot(params.newSlotStart, params.newSlotEnd);
  const manageUrl = `${siteUrl()}/audit/manage/${params.manageToken}`;

  try {
    const { data, error } = await getResend().emails.send({
      from: env.emailFrom,
      replyTo: env.emailReplyTo,
      to: params.email,
      subject: 'A LocalUp audit időpontod módosult',
      text: [
        `Szia ${params.name}!`,
        '',
        'A LocalUp audit időpontodat sikeresen módosítottuk.',
        '',
        `Korábbi időpont: ${oldSlotText}`,
        `Új időpont: ${newSlotText}`,
        '',
        params.meetLink ? `Google Meet:\n  ${params.meetLink}` : '',
        '',
        'Foglalás kezelése:',
        `  ${manageUrl}`,
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

export async function sendAdminRescheduleEmail(
  params: RescheduleEmailParams,
): Promise<EmailSendResult | EmailSendError> {
  if (!isConfigured()) {
    return { success: false, error: 'Resend not configured' };
  }

  const oldSlotText = formatSlot(params.oldSlotStart, params.oldSlotEnd);
  const newSlotText = formatSlot(params.newSlotStart, params.newSlotEnd);

  try {
    const { data, error } = await getResend().emails.send({
      from: env.emailFrom,
      replyTo: env.emailReplyTo,
      to: env.adminEmail,
      subject: `Audit időpont módosult — ${params.businessName}`,
      text: [
        'Egy audit foglalás időpontja módosult.',
        '',
        `Ügyfél: ${params.name}`,
        `Email: ${params.email}`,
        `Vállalkozás: ${params.businessName}`,
        '',
        `Korábbi időpont: ${oldSlotText}`,
        `Új időpont: ${newSlotText}`,
        '',
        `Módosítások száma: ${params.rescheduleCount}`,
        `Google Meet: ${params.meetLink ?? 'nincs'}`,
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
