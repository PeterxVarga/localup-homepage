// ============================================================
// Generic booking email orchestrator
//
// High-level helpers that resolve the tenant config, build the
// appropriate templates, and send customer + admin notifications
// idempotently. Email failures are isolated: they never throw or
// roll back a successful booking/Calendar operation.
// ============================================================

import type { BookingServiceContext } from '../../booking-service/types';
import { resolveSiteEmailConfig } from './resolver';
import { sendGenericEmail } from './sender';
import { sendNotification } from './notifications';
import {
  buildCustomerConfirmationEmail,
  buildAdminConfirmationEmail,
  buildCustomerCancellationEmail,
  buildAdminCancellationEmail,
  buildCustomerRescheduleEmail,
  buildAdminRescheduleEmail,
} from './templates';
import type {
  GenericBookingNotificationType,
  GenericBookingRecipientType,
  GenericEmailSendOutcome,
} from './types';

export { GenericEmailResolverError } from './resolver';
export type { SiteEmailConfig } from './types';

export type {
  GenericBookingNotificationType,
  GenericBookingRecipientType,
} from './types';

interface SendGenericBookingEmailDeps {
  resolveSiteEmailConfig?: (siteId: string) => ReturnType<typeof resolveSiteEmailConfig>;
  sendEmail?: typeof sendGenericEmail;
  sendNotification?: typeof sendNotification;
}

interface CustomerAndAdminParams {
  bookingId: string;
  service: BookingServiceContext;
  customerName: string;
  customerEmail: string;
  phone?: string;
  notes?: string;
  slotStart: string;
  slotEnd: string;
}

interface ConfirmationEmailParams extends CustomerAndAdminParams {
  manageToken: string;
}

interface CancellationEmailParams extends CustomerAndAdminParams {}

interface RescheduleEmailParams extends CustomerAndAdminParams {
  oldSlotStart: string;
  oldSlotEnd: string;
  rescheduleCount: number;
}

const defaultDeps: Required<SendGenericBookingEmailDeps> = {
  resolveSiteEmailConfig,
  sendEmail: sendGenericEmail,
  sendNotification,
};

function buildEventKey(
  notificationType: GenericBookingNotificationType,
  rescheduleCount?: number,
): string {
  if (notificationType === 'reschedule') {
    return `reschedule:${rescheduleCount ?? 0}`;
  }
  return notificationType;
}

async function sendCustomerAndAdmin(params: {
  type: GenericBookingNotificationType;
  bookingId: string;
  service: BookingServiceContext;
  customerEmail: string;
  rescheduleCount?: number;
  buildCustomerPayload: (config: Awaited<ReturnType<typeof resolveSiteEmailConfig>>) => {
    to: string;
    subject: string;
    text: string;
    replyTo: string;
  };
  buildAdminPayload: (config: Awaited<ReturnType<typeof resolveSiteEmailConfig>>) => {
    to: string;
    subject: string;
    text: string;
    replyTo: string;
  };
  deps: Required<SendGenericBookingEmailDeps>;
}): Promise<{ customer: boolean; admin: boolean }> {
  let config: Awaited<ReturnType<typeof resolveSiteEmailConfig>>;
  try {
    config = await params.deps.resolveSiteEmailConfig(params.service.siteId);
  } catch (err) {
    console.error('Generic email: failed to resolve tenant config');
    return { customer: false, admin: false };
  }

  const eventKey = buildEventKey(params.type, params.rescheduleCount);

  const send = async (
    recipientType: GenericBookingRecipientType,
    recipientEmail: string,
    buildPayload: () => { to: string; subject: string; text: string; replyTo: string },
  ): Promise<boolean> => {
    return params.deps.sendNotification({
      bookingId: params.bookingId,
      notificationType: params.type,
      recipientType,
      eventKey,
      recipientEmail,
      buildPayload,
      sendEmail: params.deps.sendEmail,
    });
  };

  const customerPayload = params.buildCustomerPayload(config);
  const adminPayload = params.buildAdminPayload(config);

  const [customer, admin] = await Promise.all([
    send('customer', customerPayload.to, () => customerPayload),
    send('admin', adminPayload.to, () => adminPayload),
  ]);

  return { customer, admin };
}

export async function sendGenericBookingConfirmation(
  params: ConfirmationEmailParams,
  deps: SendGenericBookingEmailDeps = {},
): Promise<{ customer: boolean; admin: boolean }> {
  const d = { ...defaultDeps, ...deps };

  return sendCustomerAndAdmin({
    type: 'confirmation',
    bookingId: params.bookingId,
    service: params.service,
    customerEmail: params.customerEmail,
    buildCustomerPayload: (config) => {
      const { subject, text } = buildCustomerConfirmationEmail({
        siteConfig: config,
        timeZone: params.service.timezone,
        serviceName: params.service.serviceName,
        customerName: params.customerName,
        customerEmail: params.customerEmail,
        phone: params.phone,
        notes: params.notes,
        slot: { start: params.slotStart, end: params.slotEnd },
        manageToken: params.manageToken,
      });
      return { to: params.customerEmail, subject, text, replyTo: config.replyToEmail };
    },
    buildAdminPayload: (config) => {
      const { subject, text } = buildAdminConfirmationEmail({
        siteConfig: config,
        timeZone: params.service.timezone,
        serviceName: params.service.serviceName,
        customerName: params.customerName,
        customerEmail: params.customerEmail,
        phone: params.phone,
        notes: params.notes,
        slot: { start: params.slotStart, end: params.slotEnd },
      });
      return { to: config.notificationEmail, subject, text, replyTo: config.replyToEmail };
    },
    deps: d,
  });
}

export async function sendGenericBookingCancellation(
  params: CancellationEmailParams,
  deps: SendGenericBookingEmailDeps = {},
): Promise<{ customer: boolean; admin: boolean }> {
  const d = { ...defaultDeps, ...deps };

  return sendCustomerAndAdmin({
    type: 'cancellation',
    bookingId: params.bookingId,
    service: params.service,
    customerEmail: params.customerEmail,
    buildCustomerPayload: (config) => {
      const { subject, text } = buildCustomerCancellationEmail({
        siteConfig: config,
        timeZone: params.service.timezone,
        serviceName: params.service.serviceName,
        customerName: params.customerName,
        customerEmail: params.customerEmail,
        phone: params.phone,
        notes: params.notes,
        slot: { start: params.slotStart, end: params.slotEnd },
      });
      return { to: params.customerEmail, subject, text, replyTo: config.replyToEmail };
    },
    buildAdminPayload: (config) => {
      const { subject, text } = buildAdminCancellationEmail({
        siteConfig: config,
        timeZone: params.service.timezone,
        serviceName: params.service.serviceName,
        customerName: params.customerName,
        customerEmail: params.customerEmail,
        phone: params.phone,
        notes: params.notes,
        slot: { start: params.slotStart, end: params.slotEnd },
      });
      return { to: config.notificationEmail, subject, text, replyTo: config.replyToEmail };
    },
    deps: d,
  });
}

export async function sendGenericBookingReschedule(
  params: RescheduleEmailParams,
  deps: SendGenericBookingEmailDeps = {},
): Promise<{ customer: boolean; admin: boolean }> {
  const d = { ...defaultDeps, ...deps };

  return sendCustomerAndAdmin({
    type: 'reschedule',
    bookingId: params.bookingId,
    service: params.service,
    customerEmail: params.customerEmail,
    rescheduleCount: params.rescheduleCount,
    buildCustomerPayload: (config) => {
      const { subject, text } = buildCustomerRescheduleEmail({
        siteConfig: config,
        timeZone: params.service.timezone,
        serviceName: params.service.serviceName,
        customerName: params.customerName,
        customerEmail: params.customerEmail,
        phone: params.phone,
        notes: params.notes,
        slot: { start: params.slotStart, end: params.slotEnd },
        oldSlot: { start: params.oldSlotStart, end: params.oldSlotEnd },
        rescheduleCount: params.rescheduleCount,
      });
      return { to: params.customerEmail, subject, text, replyTo: config.replyToEmail };
    },
    buildAdminPayload: (config) => {
      const { subject, text } = buildAdminRescheduleEmail({
        siteConfig: config,
        timeZone: params.service.timezone,
        serviceName: params.service.serviceName,
        customerName: params.customerName,
        customerEmail: params.customerEmail,
        phone: params.phone,
        notes: params.notes,
        slot: { start: params.slotStart, end: params.slotEnd },
        oldSlot: { start: params.oldSlotStart, end: params.oldSlotEnd },
        rescheduleCount: params.rescheduleCount,
      });
      return { to: config.notificationEmail, subject, text, replyTo: config.replyToEmail };
    },
    deps: d,
  });
}
