// ============================================================
// Reminder emails (Hungarian)
// Sent 24h and 1h before the audit slot.
// ============================================================

import { getResend, isConfigured } from './client';
import { env, siteUrl } from '../env';

const DISPLAY_TIMEZONE = 'Europe/Budapest';

export interface ReminderEmailParams {
  bookingId: string;
  email: string;
  name: string;
  businessName: string;
  slotStart: string; // ISO 8601
  slotEnd: string; // ISO 8601
  meetLink?: string;
  manageToken: string;
  type: 'reminder_24h' | 'reminder_1h';
  slotVersion: number;
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
    weekday: 'long',
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

function subjectLine(type: ReminderEmailParams['type']): string {
  return type === 'reminder_24h'
    ? 'Emlékeztető: holnap lesz a LocalUp auditod'
    : 'Egy óra múlva kezdődik a LocalUp auditod';
}

function openingLine(type: ReminderEmailParams['type']): string {
  return type === 'reminder_24h'
    ? 'Holnap lesz a LocalUp auditod.'
    : 'Egy óra múlva kezdődik a LocalUp auditod.';
}

export async function sendReminderEmail(
  params: ReminderEmailParams,
): Promise<EmailSendResult | EmailSendError> {
  if (!isConfigured()) {
    return { success: false, error: 'Resend not configured' };
  }

  const slotText = formatSlot(params.slotStart, params.slotEnd);
  const manageUrl = `${siteUrl()}/audit/manage/${params.manageToken}`;
  const idempotencyKey = `audit-reminder/${params.bookingId}/${params.type}/${params.slotVersion}`;

  try {
    const { data, error } = await getResend().emails.send(
      {
        from: env.emailFrom,
        replyTo: env.emailReplyTo,
        to: params.email,
        subject: subjectLine(params.type),
        text: [
          `Szia ${params.name}!`,
          '',
          openingLine(params.type),
          '',
          `Vállalkozás: ${params.businessName}`,
          `Időpont: ${slotText}`,
          '',
          ...(params.meetLink
            ? [
                'Csatlakozz a Google Meet híváshoz:',
                `  ${params.meetLink}`,
                '',
              ]
            : []),
          'Ha módosítani vagy lemondani szeretnéd az időpontot:',
          `  ${manageUrl}`,
          '',
          'Felkészülési tipp: gondold át, melyik területeken szeretnél előrébb jutni a helyi láthatósággal, értékesítéssel és bizalomépítéssel kapcsolatban.',
          '',
          '— LocalUp csapat',
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
