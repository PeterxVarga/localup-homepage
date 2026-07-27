// ============================================================
// Generic booking email — domain types
// ============================================================

export interface SiteEmailConfig {
  id: string;
  siteId: string;
  displayName: string;
  notificationEmail: string;
  replyToEmail: string;
  siteUrl: string;
  locale: 'hu' | 'en';
  isActive: boolean;
}

export interface GenericEmailPayload {
  to: string;
  subject: string;
  text: string;
  replyTo: string;
}

export interface GenericEmailSendResult {
  ok: true;
  providerMessageId?: string;
}

export interface GenericEmailSendError {
  ok: false;
  error: string;
}

export type GenericEmailSendOutcome =
  | GenericEmailSendResult
  | GenericEmailSendError;

export type GenericBookingNotificationType =
  | 'confirmation'
  | 'cancellation'
  | 'reschedule';

export type GenericBookingRecipientType = 'customer' | 'admin';

export interface NotificationRecord {
  id: string;
  bookingId: string;
  notificationType: GenericBookingNotificationType;
  recipientType: GenericBookingRecipientType;
  eventKey: string;
  recipientEmail: string;
  deliveryStatus: 'pending' | 'sent' | 'failed';
  providerMessageId: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
  sentAt: string | null;
}
