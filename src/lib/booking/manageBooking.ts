// ============================================================
// Manage booking lookup
// Framework-neutral helper used by both API and page routes.
// ============================================================

import { getSupabase } from '../supabase';
import {
  hashManagementToken,
  decryptManagementToken,
} from '../tokens/crypto';

export interface ManageBookingDetails {
  bookingId: string;
  businessName: string;
  name: string;
  email: string;
  slotStart: string;
  slotEnd: string;
  meetLink?: string;
  isCancelled: boolean;
  isExpired: boolean;
  cancelCutoffPassed: boolean;
  rescheduleCutoffPassed: boolean;
  rescheduleCount: number;
  maxReschedules: number;
}

export type ManageLookupResult =
  | { found: true; details: ManageBookingDetails }
  | { found: false; reason: 'not_found' | 'expired' };

/**
 * Look up a booking by raw management token.
 * Verifies token integrity and expiry.
 * Does NOT perform any mutation.
 */
export async function getManageBookingDetails(
  rawToken: string,
): Promise<ManageLookupResult> {
  const tokenHash = hashManagementToken(rawToken);

  const { data: booking, error } = await getSupabase()
    .from('audit_bookings')
    .select('*')
    .eq('management_token_hash', tokenHash)
    .maybeSingle();

  if (error) {
    console.error('Manage booking lookup failed:', error);
    return { found: false, reason: 'not_found' };
  }

  if (!booking) {
    return { found: false, reason: 'not_found' };
  }

  // Verify the encrypted token matches the raw token (defense in depth)
  const encryptedToken = booking.management_token_encrypted;
  if (!encryptedToken) {
    return { found: false, reason: 'not_found' };
  }

  try {
    const decrypted = decryptManagementToken(encryptedToken);
    if (decrypted !== rawToken) {
      return { found: false, reason: 'not_found' };
    }
  } catch {
    return { found: false, reason: 'not_found' };
  }

  const now = new Date();
  const expiresAt = booking.management_token_expires_at
    ? new Date(booking.management_token_expires_at)
    : null;
  const isExpired = expiresAt ? now > expiresAt : false;

  const slotStart = new Date(booking.selected_slot_start);
  const cutoffHours = 12;
  const cancelCutoffTime = new Date(
    slotStart.getTime() - cutoffHours * 60 * 60 * 1000,
  );
  const rescheduleCutoffTime = new Date(
    slotStart.getTime() - cutoffHours * 60 * 60 * 1000,
  );

  return {
    found: true,
    details: {
      bookingId: booking.id,
      businessName: booking.business_name,
      name: booking.name,
      email: booking.email,
      slotStart: booking.selected_slot_start,
      slotEnd: booking.selected_slot_end,
      meetLink: booking.meet_link || undefined,
      isCancelled: booking.booking_status === 'cancelled',
      isExpired,
      cancelCutoffPassed: now > cancelCutoffTime,
      rescheduleCutoffPassed: now > rescheduleCutoffTime,
      rescheduleCount: booking.reschedule_count,
      maxReschedules: 2,
    },
  };
}
