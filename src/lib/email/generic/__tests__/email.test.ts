// ============================================================
// Generic booking email — unit tests
//
// Tests tenant config resolution, template content, notification
// idempotency, and sender error isolation.
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GenericEmailResolverError,
  resolveSiteEmailConfig,
} from '../resolver.ts';
import {
  buildCustomerConfirmationEmail,
  buildAdminConfirmationEmail,
  buildCustomerCancellationEmail,
  buildAdminCancellationEmail,
  buildCustomerRescheduleEmail,
  buildAdminRescheduleEmail,
} from '../templates.ts';
import { sendNotification } from '../notifications.ts';
import type { GenericEmailSendOutcome, SiteEmailConfig } from '../types.ts';

const baseConfig: SiteEmailConfig = {
  id: 'cfg-123',
  siteId: 'site-123',
  displayName: 'Demo Site',
  notificationEmail: 'admin@example.com',
  replyToEmail: 'hello@example.com',
  siteUrl: 'https://demo.example.com',
  locale: 'hu',
  isActive: true,
};

const baseParams = {
  siteConfig: baseConfig,
  timeZone: 'Europe/Budapest',
  serviceName: 'Demo Service',
  customerName: 'Teszt Elek',
  customerEmail: 'customer@example.com',
  slot: { start: '2025-09-01T10:00:00.000Z', end: '2025-09-01T11:00:00.000Z' },
};

describe('resolveSiteEmailConfig', () => {
  it('resolves a valid config and validates emails/site_url', async () => {
    const config = await resolveSiteEmailConfig(
      '11111111-1111-1111-1111-111111111111',
      {
        loadConfigs: async () => [{
          id: 'cfg-1',
          site_id: '11111111-1111-1111-1111-111111111111',
          display_name: 'Demo',
          notification_email: 'admin@example.com',
          reply_to_email: 'hello@example.com',
          site_url: 'https://demo.example.com',
          locale: 'hu',
          is_active: true,
        }],
      },
    );

    assert.equal(config.notificationEmail, 'admin@example.com');
    assert.equal(config.siteUrl, 'https://demo.example.com');
  });

  it('rejects when no active config exists', async () => {
    await assert.rejects(
      resolveSiteEmailConfig('site-123', { loadConfigs: async () => [] }),
      (err: unknown) =>
        err instanceof GenericEmailResolverError &&
        err.code === 'email_unconfigured',
    );
  });

  it('rejects when multiple active configs exist', async () => {
    await assert.rejects(
      resolveSiteEmailConfig('site-123', {
        loadConfigs: async () => [
          { id: 'cfg-1', site_id: 'site-123', display_name: 'A', notification_email: 'a@example.com', reply_to_email: 'a@example.com', site_url: 'https://a.com', locale: 'hu', is_active: true },
          { id: 'cfg-2', site_id: 'site-123', display_name: 'B', notification_email: 'b@example.com', reply_to_email: 'b@example.com', site_url: 'https://b.com', locale: 'hu', is_active: true },
        ],
      }),
      (err: unknown) =>
        err instanceof GenericEmailResolverError &&
        err.code === 'email_ambiguous',
    );
  });

  it('rejects an invalid notification email', async () => {
    await assert.rejects(
      resolveSiteEmailConfig('site-123', {
        loadConfigs: async () => [{
          id: 'cfg-1',
          site_id: 'site-123',
          display_name: 'Demo',
          notification_email: 'not-an-email',
          reply_to_email: 'hello@example.com',
          site_url: 'https://demo.example.com',
          locale: 'hu',
          is_active: true,
        }],
      }),
      (err: unknown) =>
        err instanceof GenericEmailResolverError &&
        err.code === 'email_invalid_config',
    );
  });

  it('rejects a non-HTTPS site url', async () => {
    await assert.rejects(
      resolveSiteEmailConfig('site-123', {
        loadConfigs: async () => [{
          id: 'cfg-1',
          site_id: 'site-123',
          display_name: 'Demo',
          notification_email: 'admin@example.com',
          reply_to_email: 'hello@example.com',
          site_url: 'http://demo.example.com',
          locale: 'hu',
          is_active: true,
        }],
      }),
      (err: unknown) =>
        err instanceof GenericEmailResolverError &&
        err.code === 'email_invalid_config',
    );
  });
});

describe('email templates', () => {
  it('customer confirmation contains the management link', () => {
    const { text } = buildCustomerConfirmationEmail({
      ...baseParams,
      manageToken: 'secret-token-123',
    });

    assert.ok(text.includes('https://demo.example.com/booking/manage/secret-token-123'));
    assert.ok(text.includes('Teszt Elek'));
  });

  it('admin confirmation does not contain the management link', () => {
    const { text } = buildAdminConfirmationEmail(baseParams);

    assert.ok(!text.includes('secret-token-123'));
    assert.ok(!text.includes('/booking/manage/'));
    assert.ok(text.includes('Teszt Elek'));
    assert.ok(text.includes('customer@example.com'));
  });

  it('customer cancellation has no manage link', () => {
    const { text } = buildCustomerCancellationEmail(baseParams);

    assert.ok(!text.includes('/booking/manage/'));
    assert.ok(text.includes('lemondtuk'));
  });

  it('reschedule email shows old and new slots', () => {
    const { text } = buildCustomerRescheduleEmail({
      ...baseParams,
      oldSlot: { start: '2025-09-01T08:00:00.000Z', end: '2025-09-01T09:00:00.000Z' },
      rescheduleCount: 1,
    });

    assert.ok(text.includes('Korábbi időpont'));
    assert.ok(text.includes('Új időpont'));
  });

  it('uses English text for en locale', () => {
    const { text, subject } = buildCustomerConfirmationEmail({
      ...baseParams,
      siteConfig: { ...baseConfig, locale: 'en' },
      manageToken: 'tok',
    });

    assert.ok(subject.includes('Booking confirmation'));
    assert.ok(text.includes('Thank you'));
    assert.ok(text.includes('https://demo.example.com/booking/manage/tok'));
  });

  it('formats slots in the tenant timezone', () => {
    const { text } = buildCustomerConfirmationEmail({
      ...baseParams,
      timeZone: 'America/New_York',
      slot: { start: '2025-09-01T10:00:00.000Z', end: '2025-09-01T11:00:00.000Z' },
      manageToken: 'tok',
    });

    assert.ok(text.includes('2025'));
    assert.ok(text.includes(':00'));
  });
});

describe('sendNotification atomic claim', () => {
  it('sends only when it successfully claims the notification row', async () => {
    let sendCount = 0;
    const result = await sendNotification({
      bookingId: 'b-1',
      notificationType: 'confirmation',
      recipientType: 'customer',
      eventKey: 'confirmation',
      recipientEmail: 'customer@example.com',
      buildPayload: () => ({ to: 'customer@example.com', subject: 'S', text: 'T', replyTo: 'r@example.com' }),
      sendEmail: async () => {
        sendCount++;
        return { ok: true, providerMessageId: 'msg-1' } as GenericEmailSendOutcome;
      },
    }, {
      claimPending: async () => ({
        id: 'n-1',
        bookingId: 'b-1',
        notificationType: 'confirmation',
        recipientType: 'customer',
        eventKey: 'confirmation',
        recipientEmail: 'customer@example.com',
        deliveryStatus: 'pending',
        providerMessageId: null,
        attemptCount: 0,
        lastErrorCode: null,
        sentAt: null,
      }),
      recordSent: async () => true,
      recordFailed: async () => true,
      loadByUniqueKey: async () => null,
    });

    assert.equal(result, true);
    assert.equal(sendCount, 1);
  });

  it('does not send when another process already claimed the row and it is sent', async () => {
    let sendCount = 0;
    const result = await sendNotification({
      bookingId: 'b-1',
      notificationType: 'confirmation',
      recipientType: 'customer',
      eventKey: 'confirmation',
      recipientEmail: 'customer@example.com',
      buildPayload: () => ({ to: 'customer@example.com', subject: 'S', text: 'T', replyTo: 'r@example.com' }),
      sendEmail: async () => {
        sendCount++;
        return { ok: true, providerMessageId: 'msg-1' } as GenericEmailSendOutcome;
      },
    }, {
      claimPending: async () => null,
      recordSent: async () => true,
      recordFailed: async () => true,
      loadByUniqueKey: async () => ({
        id: 'n-1',
        bookingId: 'b-1',
        notificationType: 'confirmation',
        recipientType: 'customer',
        eventKey: 'confirmation',
        recipientEmail: 'customer@example.com',
        deliveryStatus: 'sent',
        providerMessageId: 'msg-1',
        attemptCount: 1,
        lastErrorCode: null,
        sentAt: '2025-01-01T00:00:00Z',
      }),
    });

    assert.equal(result, true);
    assert.equal(sendCount, 0);
  });

  it('records failed status and attempt count when send fails', async () => {
    let recordedError: string | null = null;
    const result = await sendNotification({
      bookingId: 'b-1',
      notificationType: 'confirmation',
      recipientType: 'customer',
      eventKey: 'confirmation',
      recipientEmail: 'customer@example.com',
      buildPayload: () => ({ to: 'customer@example.com', subject: 'S', text: 'T', replyTo: 'r@example.com' }),
      sendEmail: async () => ({ ok: false, error: 'email_provider_error' }),
    }, {
      claimPending: async () => ({
        id: 'n-1',
        bookingId: 'b-1',
        notificationType: 'confirmation',
        recipientType: 'customer',
        eventKey: 'confirmation',
        recipientEmail: 'customer@example.com',
        deliveryStatus: 'pending',
        providerMessageId: null,
        attemptCount: 0,
        lastErrorCode: null,
        sentAt: null,
      }),
      recordSent: async () => true,
      recordFailed: async ({ errorCode }) => {
        recordedError = errorCode;
        return true;
      },
      loadByUniqueKey: async () => null,
    });

    assert.equal(result, false);
    assert.equal(recordedError, 'email_provider_error');
  });

  it('passes a deterministic idempotency key to the sender', async () => {
    let receivedKey: string | null = null;
    await sendNotification({
      bookingId: 'b-1',
      notificationType: 'reschedule',
      recipientType: 'customer',
      eventKey: 'reschedule:2',
      recipientEmail: 'customer@example.com',
      buildPayload: () => ({ to: 'customer@example.com', subject: 'S', text: 'T', replyTo: 'r@example.com' }),
      sendEmail: async (payload) => {
        receivedKey = payload.idempotencyKey;
        return { ok: true, providerMessageId: 'msg-1' };
      },
    }, {
      claimPending: async () => ({
        id: 'n-1',
        bookingId: 'b-1',
        notificationType: 'reschedule',
        recipientType: 'customer',
        eventKey: 'reschedule:2',
        recipientEmail: 'customer@example.com',
        deliveryStatus: 'pending',
        providerMessageId: null,
        attemptCount: 0,
        lastErrorCode: null,
        sentAt: null,
      }),
      recordSent: async () => true,
      recordFailed: async () => true,
      loadByUniqueKey: async () => null,
    });

    assert.equal(receivedKey, 'b-1:reschedule:customer:reschedule:2');
  });

  it('allows reschedule:1 and reschedule:2 but blocks duplicate event keys', async () => {
    let firstSendCount = 0;
    let secondSendCount = 0;

    await sendNotification({
      bookingId: 'b-1',
      notificationType: 'reschedule',
      recipientType: 'customer',
      eventKey: 'reschedule:1',
      recipientEmail: 'customer@example.com',
      buildPayload: () => ({ to: 'customer@example.com', subject: 'S', text: 'T', replyTo: 'r@example.com' }),
      sendEmail: async () => {
        firstSendCount++;
        return { ok: true, providerMessageId: 'msg-1' };
      },
    }, {
      claimPending: async () => ({
        id: 'n-1',
        bookingId: 'b-1',
        notificationType: 'reschedule',
        recipientType: 'customer',
        eventKey: 'reschedule:1',
        recipientEmail: 'customer@example.com',
        deliveryStatus: 'pending',
        providerMessageId: null,
        attemptCount: 0,
        lastErrorCode: null,
        sentAt: null,
      }),
      recordSent: async () => true,
      recordFailed: async () => true,
      loadByUniqueKey: async () => null,
    });

    await sendNotification({
      bookingId: 'b-1',
      notificationType: 'reschedule',
      recipientType: 'customer',
      eventKey: 'reschedule:2',
      recipientEmail: 'customer@example.com',
      buildPayload: () => ({ to: 'customer@example.com', subject: 'S', text: 'T', replyTo: 'r@example.com' }),
      sendEmail: async () => {
        secondSendCount++;
        return { ok: true, providerMessageId: 'msg-2' };
      },
    }, {
      claimPending: async () => ({
        id: 'n-2',
        bookingId: 'b-1',
        notificationType: 'reschedule',
        recipientType: 'customer',
        eventKey: 'reschedule:2',
        recipientEmail: 'customer@example.com',
        deliveryStatus: 'pending',
        providerMessageId: null,
        attemptCount: 0,
        lastErrorCode: null,
        sentAt: null,
      }),
      recordSent: async () => true,
      recordFailed: async () => true,
      loadByUniqueKey: async () => null,
    });

    await sendNotification({
      bookingId: 'b-1',
      notificationType: 'reschedule',
      recipientType: 'customer',
      eventKey: 'reschedule:1',
      recipientEmail: 'customer@example.com',
      buildPayload: () => ({ to: 'customer@example.com', subject: 'S', text: 'T', replyTo: 'r@example.com' }),
      sendEmail: async () => {
        firstSendCount++;
        return { ok: true, providerMessageId: 'msg-3' };
      },
    }, {
      claimPending: async () => null,
      recordSent: async () => true,
      recordFailed: async () => true,
      loadByUniqueKey: async () => ({
        id: 'n-1',
        bookingId: 'b-1',
        notificationType: 'reschedule',
        recipientType: 'customer',
        eventKey: 'reschedule:1',
        recipientEmail: 'customer@example.com',
        deliveryStatus: 'sent',
        providerMessageId: 'msg-1',
        attemptCount: 1,
        lastErrorCode: null,
        sentAt: '2025-01-01T00:00:00Z',
      }),
    });

    assert.equal(firstSendCount, 1);
    assert.equal(secondSendCount, 1);
  });
});
