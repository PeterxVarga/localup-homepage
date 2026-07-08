// ============================================================
// Create booking — framework-neutral
// Validates, checks slot availability, inserts into Supabase
// ============================================================

import { getSupabase } from '../supabase';
import type { AuditBookingInput } from '../audit/validation';

export interface CreateBookingResult {
  success: true;
  bookingId: string;
  slotStart: string;
  slotEnd: string;
}

export interface CreateBookingError {
  success: false;
  error: string;
  message: string;
}

/**
 * Insert a new booking with status 'calendar_pending'.
 * The caller is responsible for:
 *   - Zod validation (already done before calling this)
 *   - Google Calendar event creation (after insert)
 *   - Updating status to 'booked' or 'calendar_failed'
 */
export async function createBooking(
  input: AuditBookingInput,
): Promise<CreateBookingResult | CreateBookingError> {
  // 1. Re-check slot availability (race condition protection)
  const { data: conflict } = await getSupabase()
    .from('audit_bookings')
    .select('id')
    .in('status', ['calendar_pending', 'booked', 'calendar_failed'])
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

  // 2. Insert booking
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
      status: 'calendar_pending',
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
  };
}

/**
 * Update booking status after calendar provider sync attempt.
 *
 * TODO V2: replace google_calendar_event_id column with a separate
 * calendar_sync_events table supporting multiple providers:
 *   provider | provider_event_id | status | synced_at
 */
export async function updateBookingStatus(
  bookingId: string,
  status: 'booked' | 'calendar_failed',
  googleCalendarEventId?: string,
): Promise<void> {
  await getSupabase()
    .from('audit_bookings')
    .update({
      status,
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
