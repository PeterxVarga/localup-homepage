// ============================================================
// User confirmation email
// ============================================================

import { getResend, isConfigured } from './client';
import { env } from '../env';

interface BookingConfirmationParams {
  email: string;
  businessName: string;
  date: string; // formatted date string
  timeRange: string; // e.g. "10:00 AM – 10:30 AM"
  goals: string[];
  bookingId?: string;
}

export async function sendBookingConfirmation(
  params: BookingConfirmationParams,
): Promise<void> {
  if (!isConfigured()) {
    console.warn('Resend not configured — skipping user email');
    return;
  }

  const goalsText = params.goals.map((g) => `• ${g}`).join('\n');

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
        "If you need to change or cancel, just reply to this email and we'll take care of it.",
        '',
        '— The LocalUp team',
      ].join('\n'),
    });
  } catch (err) {
    console.error('User confirmation email failed:', err);
  }
}
