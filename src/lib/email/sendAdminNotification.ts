// ============================================================
// Admin notification email
// ============================================================

import { getResend, isConfigured } from './client';
import { env, siteUrl } from '../env';

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
  slotStart: string;
  slotEnd: string;
  ctaLocation?: string;
  status: string;
  bookingId?: string;
}

export async function sendAdminNotification(
  params: AdminNotificationParams,
): Promise<void> {
  if (!isConfigured()) {
    console.warn('Resend not configured — skipping admin email');
    return;
  }

  const goalsText = params.goals.map((g) => `• ${g}`).join('\n');
  const dashboardLink = `${siteUrl()}/dashboard`;
  const bookingLink = params.bookingId
    ? `${siteUrl()}/audit/booking/${params.bookingId}`
    : dashboardLink;

  try {
    await getResend().emails.send({
      from: env.emailFrom,
      replyTo: env.emailReplyTo,
      to: env.adminEmail,
      subject: `New LocalUp audit booking — ${params.businessName}`,
      text: [
        `Status: ${params.status}`,
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
        `  Start: ${params.slotStart}`,
        `  End: ${params.slotEnd}`,
        '',
        params.ctaLocation
          ? `— CTA location —\n  ${params.ctaLocation}\n`
          : '',
        '—',
        `Booking details: ${bookingLink}`,
        `Dashboard: ${dashboardLink}`,
      ].join('\n'),
    });
  } catch (err) {
    console.error('Admin notification email failed:', err);
  }
}
