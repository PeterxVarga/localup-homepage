// ============================================================
// Cancellation emails
// ============================================================

import { getResend, isConfigured } from './client';
import { env } from '../env';

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

function formatSlot(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const dateStr = startDate.toLocaleDateString('hu-HU', {
    weekday: 'long',
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

export async function sendUserCancellationEmail(
  params: CancellationParams,
): Promise<void> {
  if (!isConfigured()) {
    console.warn('Resend not configured — skipping user cancellation email');
    return;
  }

  const slotText = formatSlot(params.slotStart, params.slotEnd);

  try {
    await getResend().emails.send({
      from: env.emailFrom,
      replyTo: env.emailReplyTo,
      to: params.email,
      subject: 'Your LocalUp audit call has been cancelled',
      text: [
        `Hi ${params.name},`,
        '',
        `Your LocalUp audit call for ${params.businessName} has been cancelled.`,
        '',
        'Cancelled slot:',
        `  ${slotText}`,
        params.reason ? `\nReason: ${params.reason}` : '',
        '',
        params.calendarDeleted
          ? 'The calendar event has been removed.'
          : 'We are removing the calendar event; if it still appears, it will be handled manually.',
        '',
        'If you change your mind, reply to this email and we will find a new time.',
        '',
        '— The LocalUp team',
      ].join('\n'),
    });
  } catch (err) {
    console.error('User cancellation email failed:', err);
  }
}

export async function sendAdminCancellationEmail(
  params: CancellationParams,
): Promise<void> {
  if (!isConfigured()) {
    console.warn('Resend not configured — skipping admin cancellation email');
    return;
  }

  const slotText = formatSlot(params.slotStart, params.slotEnd);

  try {
    await getResend().emails.send({
      from: env.emailFrom,
      replyTo: env.emailReplyTo,
      to: env.adminEmail,
      subject: `Audit cancelled — ${params.businessName}`,
      text: [
        `A booking has been cancelled.`,
        '',
        `Booking ID: ${params.bookingId}`,
        `Business: ${params.businessName}`,
        `Name: ${params.name}`,
        `Email: ${params.email}`,
        `Cancelled slot: ${slotText}`,
        params.reason ? `Reason: ${params.reason}` : '',
        '',
        `Calendar event removed: ${params.calendarDeleted ? 'Yes' : 'No — manual cleanup needed'}`,
        '',
        '— LocalUp booking system',
      ].join('\n'),
    });
  } catch (err) {
    console.error('Admin cancellation email failed:', err);
  }
}

