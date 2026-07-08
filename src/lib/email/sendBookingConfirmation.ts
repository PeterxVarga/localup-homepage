// ============================================================
// User confirmation email
// ============================================================

import { getResend, isConfigured } from './client';
import { env, siteUrl } from '../env';

interface BookingConfirmationParams {
  email: string;
  businessName: string;
  date: string; // formatted date string
  timeRange: string; // e.g. "10:00 AM – 10:30 AM"
  goals: string[];
  meetLink?: string;
  manageToken: string;
}

export async function sendBookingConfirmation(
  params: BookingConfirmationParams,
): Promise<void> {
  if (!isConfigured()) {
    console.warn('Resend not configured — skipping user email');
    return;
  }

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
        `  Date: ${params.date}`,
        `  Time: ${params.timeRange}`,
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
