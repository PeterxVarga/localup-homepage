// ============================================================
// Generic booking email sender
//
// Sends tenant-branded emails through the global Resend client.
// The global env.emailFrom remains the actual sender; tenant config
// provides reply-to, display name (via subject/body), and admin address.
//
// Passes a deterministic idempotency key to Resend (via the SDK's
// CreateEmailRequestOptions.idempotencyKey) so a duplicate request with the
// same key does not create a second email. If the DB status update crashes
// after Resend accepts the request, the idempotency key prevents a re-send
// on retry.
//
// Errors are logged generically; API keys and provider error objects
// never leak to callers or logs.
// ============================================================

import { getResend, isConfigured } from '../client';
import { env } from '../../env';
import type {
  GenericEmailPayload,
  GenericEmailSendOutcome,
} from './types';

export interface SendGenericEmailPayload extends GenericEmailPayload {
  idempotencyKey: string;
}

export async function sendGenericEmail(
  payload: SendGenericEmailPayload,
): Promise<GenericEmailSendOutcome> {
  if (!isConfigured()) {
    console.warn('Resend not configured — skipping generic email');
    return { ok: false, error: 'email_provider_unconfigured' };
  }

  try {
    const { data, error } = await getResend().emails.send(
      {
        from: env.emailFrom,
        replyTo: payload.replyTo,
        to: payload.to,
        subject: payload.subject,
        text: payload.text,
      },
      {
        idempotencyKey: payload.idempotencyKey,
      },
    );

    if (error) {
      console.error('Generic email send failed');
      return { ok: false, error: 'email_provider_error' };
    }

    return {
      ok: true,
      providerMessageId: data?.id ?? undefined,
    };
  } catch (err) {
    console.error('Generic email send failed with exception');
    return { ok: false, error: 'email_provider_error' };
  }
}
