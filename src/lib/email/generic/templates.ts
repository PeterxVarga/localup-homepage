// ============================================================
// Generic booking email templates — tenant-aware, locale-aware
//
// Uses the tenant timezone for display. The management token only
// appears in the customer confirmation email; it never appears in admin
// emails, notification records, logs, or API responses.
// ============================================================

import type { SiteEmailConfig } from './types';

interface Slot {
  start: string; // ISO 8601
  end: string; // ISO 8601
}

interface CommonTemplateParams {
  siteConfig: SiteEmailConfig;
  timeZone: string;
  serviceName: string;
  customerName: string;
  customerEmail: string;
  slot: Slot;
  phone?: string;
  notes?: string;
}

interface ConfirmationParams extends CommonTemplateParams {
  manageToken: string;
}

interface CancellationParams extends CommonTemplateParams {}

interface RescheduleParams extends CommonTemplateParams {
  oldSlot: Slot;
  rescheduleCount: number;
}

const TRANSLATIONS = {
  hu: {
    confirmationSubject: (displayName: string) =>
      `Foglalás visszaigazolás — ${displayName}`,
    cancellationSubject: (displayName: string) =>
      `Foglalás lemondva — ${displayName}`,
    rescheduleSubject: (displayName: string) =>
      `Foglalás módosítva — ${displayName}`,
    greeting: (name: string) => `Kedves ${name}!`,
    confirmationIntro: (displayName: string) =>
      `Köszönjük a foglalást a(z) ${displayName} oldalán.`,
    cancellationIntro: 'A foglalásodat sikeresen lemondtuk.',
    rescheduleIntro: 'A foglalásod időpontját sikeresen módosítottuk.',
    serviceLabel: 'Szolgáltatás',
    dateTimeLabel: 'Időpont',
    oldDateTimeLabel: 'Korábbi időpont',
    newDateTimeLabel: 'Új időpont',
    manageLabel: 'Foglalás kezelése',
    manageNote: 'Ha módosítani vagy lemondani szeretnél, használd a fenti linket.',
    notesLabel: 'Megjegyzés',
    phoneLabel: 'Telefon',
    adminSubjectConfirmation: (displayName: string, customer: string) =>
      `Új foglalás — ${displayName} — ${customer}`,
    adminSubjectCancellation: (displayName: string, customer: string) =>
      `Foglalás lemondva — ${displayName} — ${customer}`,
    adminSubjectReschedule: (displayName: string, customer: string) =>
      `Foglalás módosítva — ${displayName} — ${customer}`,
    adminIntro: 'Értesítés egy foglalásról.',
    customerEmailLabel: 'Ügyfél email',
    rescheduleCountLabel: 'Módosítások száma',
    closing: 'Üdvözlettel,',
    teamSuffix: (displayName: string) => `${displayName} csapata`,
  },
  en: {
    confirmationSubject: (displayName: string) =>
      `Booking confirmation — ${displayName}`,
    cancellationSubject: (displayName: string) =>
      `Booking cancelled — ${displayName}`,
    rescheduleSubject: (displayName: string) =>
      `Booking rescheduled — ${displayName}`,
    greeting: (name: string) => `Dear ${name},`,
    confirmationIntro: (displayName: string) =>
      `Thank you for booking with ${displayName}.`,
    cancellationIntro: 'Your booking has been successfully cancelled.',
    rescheduleIntro: 'Your booking has been successfully rescheduled.',
    serviceLabel: 'Service',
    dateTimeLabel: 'Date and time',
    oldDateTimeLabel: 'Previous date and time',
    newDateTimeLabel: 'New date and time',
    manageLabel: 'Manage booking',
    manageNote: 'Use the link above to modify or cancel your booking.',
    notesLabel: 'Notes',
    phoneLabel: 'Phone',
    adminSubjectConfirmation: (displayName: string, customer: string) =>
      `New booking — ${displayName} — ${customer}`,
    adminSubjectCancellation: (displayName: string, customer: string) =>
      `Booking cancelled — ${displayName} — ${customer}`,
    adminSubjectReschedule: (displayName: string, customer: string) =>
      `Booking rescheduled — ${displayName} — ${customer}`,
    adminIntro: 'Notification about a booking.',
    customerEmailLabel: 'Customer email',
    rescheduleCountLabel: 'Reschedule count',
    closing: 'Best regards,',
    teamSuffix: (displayName: string) => `The ${displayName} team`,
  },
};

function formatSlot(
  slot: Slot,
  timeZone: string,
  locale: 'hu' | 'en',
): string {
  const start = new Date(slot.start);
  const end = new Date(slot.end);
  const dateFormatter = new Intl.DateTimeFormat(locale === 'hu' ? 'hu-HU' : 'en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeFormatter = new Intl.DateTimeFormat(locale === 'hu' ? 'hu-HU' : 'en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  });

  const date = dateFormatter.format(start);
  const startTime = timeFormatter.format(start);
  const endTime = timeFormatter.format(end);
  return `${date}, ${startTime}–${endTime}`;
}

function getTexts(locale: 'hu' | 'en') {
  return TRANSLATIONS[locale];
}

function buildManageUrl(siteUrl: string, manageToken: string): string {
  return `${siteUrl}/booking/manage/${encodeURIComponent(manageToken)}`;
}

function buildCommonLines(
  params: CommonTemplateParams,
  texts: ReturnType<typeof getTexts>,
): string[] {
  const slotText = formatSlot(params.slot, params.timeZone, params.siteConfig.locale);

  return [
    `${texts.serviceLabel}: ${params.serviceName}`,
    `${texts.dateTimeLabel}: ${slotText}`,
    params.phone ? `${texts.phoneLabel}: ${params.phone}` : undefined,
    params.notes ? `${texts.notesLabel}: ${params.notes}` : undefined,
  ].filter((line): line is string => typeof line === 'string');
}

export function buildCustomerConfirmationEmail(
  params: ConfirmationParams,
): { subject: string; text: string } {
  const texts = getTexts(params.siteConfig.locale);
  const manageUrl = buildManageUrl(params.siteConfig.siteUrl, params.manageToken);

  const lines = [
    texts.greeting(params.customerName),
    '',
    texts.confirmationIntro(params.siteConfig.displayName),
    '',
    ...buildCommonLines(params, texts),
    '',
    `${texts.manageLabel}:`,
    `  ${manageUrl}`,
    '',
    texts.manageNote,
    '',
    texts.closing,
    texts.teamSuffix(params.siteConfig.displayName),
  ];

  return {
    subject: texts.confirmationSubject(params.siteConfig.displayName),
    text: lines.join('\n'),
  };
}

export function buildAdminConfirmationEmail(
  params: CommonTemplateParams,
): { subject: string; text: string } {
  const texts = getTexts(params.siteConfig.locale);

  const lines = [
    texts.adminIntro,
    '',
    `${texts.serviceLabel}: ${params.serviceName}`,
    `${texts.customerEmailLabel}: ${params.customerEmail}`,
    `${params.customerName}`,
    ...buildCommonLines(params, texts),
    '',
    texts.closing,
    texts.teamSuffix(params.siteConfig.displayName),
  ];

  return {
    subject: texts.adminSubjectConfirmation(
      params.siteConfig.displayName,
      params.customerName,
    ),
    text: lines.join('\n'),
  };
}

export function buildCustomerCancellationEmail(
  params: CancellationParams,
): { subject: string; text: string } {
  const texts = getTexts(params.siteConfig.locale);

  const lines = [
    texts.greeting(params.customerName),
    '',
    texts.cancellationIntro,
    '',
    ...buildCommonLines(params, texts),
    '',
    texts.closing,
    texts.teamSuffix(params.siteConfig.displayName),
  ];

  return {
    subject: texts.cancellationSubject(params.siteConfig.displayName),
    text: lines.join('\n'),
  };
}

export function buildAdminCancellationEmail(
  params: CancellationParams,
): { subject: string; text: string } {
  const texts = getTexts(params.siteConfig.locale);

  const lines = [
    texts.adminIntro,
    '',
    `${texts.serviceLabel}: ${params.serviceName}`,
    `${texts.customerEmailLabel}: ${params.customerEmail}`,
    `${params.customerName}`,
    ...buildCommonLines(params, texts),
    '',
    texts.closing,
    texts.teamSuffix(params.siteConfig.displayName),
  ];

  return {
    subject: texts.adminSubjectCancellation(
      params.siteConfig.displayName,
      params.customerName,
    ),
    text: lines.join('\n'),
  };
}

export function buildCustomerRescheduleEmail(
  params: RescheduleParams,
): { subject: string; text: string } {
  const texts = getTexts(params.siteConfig.locale);
  const oldSlotText = formatSlot(params.oldSlot, params.timeZone, params.siteConfig.locale);
  const newSlotText = formatSlot(params.slot, params.timeZone, params.siteConfig.locale);

  const lines = [
    texts.greeting(params.customerName),
    '',
    texts.rescheduleIntro,
    '',
    `${texts.serviceLabel}: ${params.serviceName}`,
    `${texts.oldDateTimeLabel}: ${oldSlotText}`,
    `${texts.newDateTimeLabel}: ${newSlotText}`,
    params.phone ? `${texts.phoneLabel}: ${params.phone}` : undefined,
    params.notes ? `${texts.notesLabel}: ${params.notes}` : undefined,
    '',
    texts.closing,
    texts.teamSuffix(params.siteConfig.displayName),
  ];

  return {
    subject: texts.rescheduleSubject(params.siteConfig.displayName),
    text: lines.filter((line): line is string => typeof line === 'string').join('\n'),
  };
}

export function buildAdminRescheduleEmail(
  params: RescheduleParams,
): { subject: string; text: string } {
  const texts = getTexts(params.siteConfig.locale);
  const oldSlotText = formatSlot(params.oldSlot, params.timeZone, params.siteConfig.locale);
  const newSlotText = formatSlot(params.slot, params.timeZone, params.siteConfig.locale);

  const lines = [
    texts.adminIntro,
    '',
    `${texts.serviceLabel}: ${params.serviceName}`,
    `${texts.customerEmailLabel}: ${params.customerEmail}`,
    `${texts.oldDateTimeLabel}: ${oldSlotText}`,
    `${texts.newDateTimeLabel}: ${newSlotText}`,
    `${texts.rescheduleCountLabel}: ${params.rescheduleCount}`,
    '',
    texts.closing,
    texts.teamSuffix(params.siteConfig.displayName),
  ];

  return {
    subject: texts.adminSubjectReschedule(
      params.siteConfig.displayName,
      params.customerName,
    ),
    text: lines.join('\n'),
  };
}
