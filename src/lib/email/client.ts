// ============================================================
// Resend email — shared client (lazy)
// ============================================================

import { Resend } from 'resend';
import { env } from '../env';

let resend: Resend | undefined;

export function isConfigured(): boolean {
  return !!env.resendApiKey;
}

/**
 * Returns the shared Resend client.
 * Throws if Resend is not configured — call isConfigured() first.
 */
export function getResend(): Resend {
  if (!isConfigured()) {
    throw new Error('Resend is not configured. Set RESEND_API_KEY.');
  }

  if (!resend) {
    resend = new Resend(env.resendApiKey);
  }

  return resend;
}
