// ============================================================
// User confirmation email
// ============================================================

import { getResend, isConfigured } from './client';
import { env, siteUrl } from '../env';

const DISPLAY_TIMEZONE = 'Europe/Budapest';

interface BookingConfirmationParams {
  email: string;
  businessName: string;
  slotStart: string; // ISO 8601
  slotEnd: string; // ISO 8601
  goals: string[];
  meetLink?: string;
  manageToken: string;
}

function formatSlot(start: string, end: string): { date: string; timeRange: string } {
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
  return { date: dateStr, timeRange: `${startTime}–${endTime}` };
}

export async function sendBookingConfirmation(
  params: BookingConfirmationParams,
): Promise<void> {
  if (!isConfigured()) {
    console.warn('Resend not configured — skipping user email');
    return;
  }

  const { date, timeRange } = formatSlot(params.slotStart, params.slotEnd);
  const goalsText = params.goals.map((g) => `• ${g}`).join('\n');
  const manageUrl = `${siteUrl()}/audit/manage/${params.manageToken}`;

  try {
    await getResend().emails.send({
      from: env.emailFrom,
      replyTo: env.emailReplyTo,
      to: params.email,
      subject: 'Your LocalUp audit call is booked',
      text: [
        `Thanks for booking your free LocalUp audit, ${params.businessName}!`,
        '',
        `We'll review your website, local visibility, and trust signals before the call.`,
        '',
        'Booking details:',
        `  Date: ${date}`,
        `  Time: ${timeRange}`,
        `  Business: ${params.businessName}`,
        '',
        'Goals selected:',
        goalsText,
        '',
        ...(params.meetLink
          ? ['Join Google Meet:', `  ${params.meetLink}`, '']
          : []),
        'Manage your booking:',
        `  ${manageUrl}`,
        '',
        "If you need to change or cancel, just reply to this email or use the link above.",
        '',
        '— The LocalUp team',
      ].join('\n'),
    });
  } catch (err) {
    console.error('User confirmation email failed:', err);
  }
}
