// ============================================================
// Admin notification email
// ============================================================

import { getResend, isConfigured } from './client';
import { env } from '../env';

const DISPLAY_TIMEZONE = 'Europe/Budapest';

interface AdminNotificationParams {
  businessName: string;
  name: string;
  email: string;
  phone?: string;
  websiteUrl?: string;
  city: string;
  businessType: string;
  goals: string[];
  notes?: string;
  slotStart: string; // ISO 8601
  slotEnd: string; // ISO 8601
  ctaLocation?: string;
  status: string;
  bookingId?: string;
  meetLink?: string;
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

export async function sendAdminNotification(
  params: AdminNotificationParams,
): Promise<void> {
  if (!isConfigured()) {
    console.warn('Resend not configured — skipping admin email');
    return;
  }

  const goalsText = params.goals.map((g) => `• ${g}`).join('\n');
  const bookingIdShort = params.bookingId ? params.bookingId.slice(0, 8) : '';
  const slotText = formatSlot(params.slotStart, params.slotEnd);

  try {
    await getResend().emails.send({
      from: env.emailFrom,
      replyTo: env.emailReplyTo,
      to: env.adminEmail,
      subject: `New LocalUp audit booking — ${params.businessName}`,
      text: [
        `Status: ${params.status}`,
        params.bookingId ? `Booking ID: ${params.bookingId}` : '',
        '',
        '— Contact —',
        `  Name: ${params.name}`,
        `  Email: ${params.email}`,
        `  Phone: ${params.phone || '—'}`,
        '',
        '— Business —',
        `  Name: ${params.businessName}`,
        `  Website: ${params.websiteUrl || '—'}`,
        `  City: ${params.city}`,
        `  Type: ${params.businessType}`,
        '',
        '— Goals —',
        goalsText,
        '',
        params.notes ? `— Notes —\n${params.notes}\n` : '',
        '— Slot —',
        `  ${slotText}`,
        '',
        params.meetLink ? `— Google Meet —\n  ${params.meetLink}\n` : '',
        params.bookingId ? `— Booking —\n  ID: ${params.bookingId}\n  Short: ${bookingIdShort}\n` : '',
        params.ctaLocation
          ? `— CTA location —\n  ${params.ctaLocation}\n`
          : '',
      ].join('\n'),
    });
  } catch (err) {
    console.error('Admin notification email failed:', err);
  }
}
