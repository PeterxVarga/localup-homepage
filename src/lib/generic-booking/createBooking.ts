// ============================================================
// Generic booking — create
//
// - Receives the service context from the server; never trusts client-side
//   site/service identity.
// - Verifies the submitted slot end matches the service duration.
// - Validates the slot against the same service-aware availability rules
//   used by the public slot list.
// - Computes blocked_start / blocked_end from service buffers.
// - Creates a management token but does NOT expose it to the caller.
// - Does not create Calendar events or send emails in this slice.
// ============================================================

import { getSupabase } from '../supabase';
import {
  generateManagementToken,
  hashManagementToken,
  encryptManagementToken,
} from '../tokens/crypto';
import { isSlotValidAccordingToRules } from '../booking/validateSlot';
import type { BookingServiceContext } from '../booking-service/types';
import { computeBlockedRange, getExpectedSlotEnd } from '../booking/intervals';
import type {
  GenericBookingInput,
  GenericBookingOutcome,
} from './types';

const TOKEN_TTL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function getTokenExpiresAt(slotEnd: string): string {
  return new Date(
    new Date(slotEnd).getTime() + TOKEN_TTL_DAYS * DAY_MS,
  ).toISOString();
}

export async function createGenericBooking(
  input: GenericBookingInput,
  service: BookingServiceContext,
): Promise<GenericBookingOutcome> {
  // 1. Duration must match the service configuration exactly.
  const expectedEnd = getExpectedSlotEnd(input.slotStart, service.durationMinutes);
  const requestedEnd = new Date(input.slotEnd).toISOString();
  if (expectedEnd !== requestedEnd) {
    return {
      success: false,
      error: 'invalid_slot',
      message: 'Slot duration does not match the service configuration.',
    };
  }

  // 2. Validate against the same availability rules as the public slot list.
  const followsRules = await isSlotValidAccordingToRules(
    input.slotStart,
    input.slotEnd,
    service,
  );
  if (!followsRules) {
    return {
      success: false,
      error: 'invalid_slot',
      message: 'The selected slot is not available.',
    };
  }

  // 3. Compute the blocked interval including service buffers.
  const { blockedStart, blockedEnd } = computeBlockedRange(
    input.slotStart,
    input.slotEnd,
    service.bufferBeforeMinutes,
    service.bufferAfterMinutes,
  );

  // 4. Management token (stored, never returned).
  const managementToken = generateManagementToken();
  const tokenHash = hashManagementToken(managementToken);
  const tokenEncrypted = encryptManagementToken(managementToken);

  // 5. Insert with explicit tenant/service identity.
  const { data, error } = await getSupabase()
    .from('bookings')
    .insert({
      site_id: service.siteId,
      service_id: service.serviceId,
      customer_name: input.name,
      customer_email: input.email,
      customer_phone: input.phone || null,
      customer_notes: input.notes || null,
      slot_start: input.slotStart,
      slot_end: input.slotEnd,
      blocked_start: blockedStart,
      blocked_end: blockedEnd,
      booking_status: 'booked',
      calendar_sync_status: 'pending',
      management_token_hash: tokenHash,
      management_token_encrypted: tokenEncrypted,
      management_token_expires_at: getTokenExpiresAt(input.slotEnd),
      locale: input.locale || 'hu',
      source: 'website',
    })
    .select('id, slot_start, slot_end')
    .single();

  if (error) {
    // Exclusion violation => another active booking already blocks this slot.
    if (error.code === '23P01') {
      return {
        success: false,
        error: 'slot_taken',
        message:
          'That time was just taken. Please choose another available slot.',
      };
    }

    // Any other database error is surfaced as a generic DB failure so callers
    // do not mask real problems as slot conflicts.
    console.error('Generic booking insert failed:', error);
    return {
      success: false,
      error: 'db_error',
      message: 'Something went wrong while creating the booking.',
    };
  }

  return {
    success: true,
    bookingId: data.id,
    slotStart: data.slot_start,
    slotEnd: data.slot_end,
  };
}
