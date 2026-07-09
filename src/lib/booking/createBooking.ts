// ============================================================
// Create booking — framework-neutral
// Validates, checks slot availability, inserts into Supabase
// ============================================================

import { getSupabase } from '../supabase';
import type { AuditBookingInput } from '../audit/validation';
import {
  generateManagementToken,
  hashManagementToken,
  encryptManagementToken,
} from '../tokens/crypto';
import { toLegacyStatus } from './legacyStatusMapper';

export interface CreateBookingResult {
  success: true;
  bookingId: string;
  slotStart: string;
  slotEnd: string;
  managementToken: string;
}

export interface CreateBookingError {
  success: false;
  error: string;
  message: string;
}

/**
 * Insert a new booking with lifecycle and calendar-sync statuses separated.
 * The caller is responsible for:
 *   - Zod validation (already done before calling this)
 *   - Google Calendar event creation (after insert)
 *   - Updating statuses after sync attempt
 */
export async function createBooking(
  input: AuditBookingInput,
): Promise<CreateBookingResult | CreateBookingError> {
  // 1. Re-check slot availability (race condition protection)
  const { data: conflict } = await getSupabase()
    .from('audit_bookings')
    .select('id')
    .in('booking_status', ['pending', 'booked'])
    .eq('selected_slot_start', input.slotStart)
    .maybeSingle();

  if (conflict) {
    return {
      success: false,
      error: 'slot_taken',
      message:
        'That time was just taken. Please choose another available slot.',
    };
  }

  // 2. Generate secure management token
  const managementToken = generateManagementToken();
  const tokenHash = hashManagementToken(managementToken);
  const tokenEncrypted = encryptManagementToken(managementToken);
  const tokenExpiresAt = new Date(
    new Date(input.slotEnd).getTime() + 30 * 24 * 60 * 60 * 1000,
  ).toISOString();

  // 3. Insert booking
  //    The legacy `status` column is written only through the compatibility
  //    mapper. All business logic uses booking_status and calendar_sync_status.
  const calendarSyncStatus: 'pending' = 'pending';
  const { data: booking, error: insertError } = await getSupabase()
    .from('audit_bookings')
    .insert({
      business_name: input.businessName,
      website_url: input.websiteUrl || null,
      no_website: input.noWebsite,
      city: input.city,
      business_type: input.businessType,
      goals: input.goals,
      notes: input.notes || null,
      name: input.name,
      email: input.email,
      phone: input.phone || null,
      selected_slot_start: input.slotStart,
      selected_slot_end: input.slotEnd,
      booking_status: 'booked',
      calendar_sync_status: calendarSyncStatus,
      status: toLegacyStatus(calendarSyncStatus),
      meet_link: null,
      management_token_hash: tokenHash,
      management_token_encrypted: tokenEncrypted,
      management_token_expires_at: tokenExpiresAt,
      booking_type: 'localup_audit',
      source: 'website',
      funnel: 'audit',
      session_id: input.sessionId || null,
      cta_location: input.ctaLocation || null,
      source_url: input.sourceUrl || null,
    })
    .select('id')
    .single();

  if (insertError) {
    console.error('Booking insert failed:', insertError);
    return {
      success: false,
      error: 'db_error',
      message: 'Something went wrong while booking. Please try again.',
    };
  }

  return {
    success: true,
    bookingId: booking.id,
    slotStart: input.slotStart,
    slotEnd: input.slotEnd,
    managementToken,
  };
}

/**
 * Update booking status after calendar provider sync attempt.
 * The legacy `status` column is kept in sync through the compatibility mapper.
 */
export async function updateBookingCalendarSync(
  bookingId: string,
  calendarSyncStatus: 'synced' | 'failed',
  googleCalendarEventId?: string,
  meetLink?: string,
): Promise<void> {
  await getSupabase()
    .from('audit_bookings')
    .update({
      calendar_sync_status: calendarSyncStatus,
      status: toLegacyStatus(calendarSyncStatus),
      ...(meetLink ? { meet_link: meetLink } : {}),
      ...(googleCalendarEventId
        ? { google_calendar_event_id: googleCalendarEventId }
        : {}),
    })
    .eq('id', bookingId);
}

/**
 * Get booking by ID (for confirmation screen)
 */
export async function getBookingById(bookingId: string) {
  const { data } = await getSupabase()
    .from('audit_bookings')
    .select('*')
    .eq('id', bookingId)
    .single();
  return data;
}

/**
 * Get booking by management token hash.
 * Does NOT decrypt or expose the raw token.
 */
export async function getBookingByTokenHash(tokenHash: string) {
  const { data } = await getSupabase()
    .from('audit_bookings')
    .select('*')
    .eq('management_token_hash', tokenHash)
    .maybeSingle();
  return data;
}


