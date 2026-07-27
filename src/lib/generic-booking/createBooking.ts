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
// - Creates a tenant Calendar event and links it to the booking.
//   Fail-closed: if the Calendar provider is unavailable or the event
//   creation fails, the booking is compensated (cancelled) so the slot
//   does not remain blocked.
// ============================================================

import { getSupabase } from '../supabase';
import {
  generateManagementToken,
  hashManagementToken,
  encryptManagementToken,
} from '../tokens/crypto';
import {
  isSlotValidAccordingToRules as defaultIsSlotValidAccordingToRules,
} from '../booking/validateSlot';
import type { BookingServiceContext } from '../booking-service/types';
import { computeBlockedRange, getExpectedSlotEnd } from '../booking/intervals';
import { resolveGenericAvailabilityProvider } from '../calendar/genericAvailabilityProvider';
import type { GenericCalendarProvider } from '../calendar/genericAvailabilityResolver';
import type { CreateEventParams, CreateEventResult } from '../calendar/types';
import { sendGenericBookingConfirmation } from '../email/generic/index.ts';
import {
  resolveSiteEmailConfig,
  type SiteEmailConfig,
} from '../email/generic/resolver.ts';
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

function buildEventSummary(service: BookingServiceContext): string {
  return `${service.siteName} — ${service.serviceName}`;
}

function buildEventDescription(input: GenericBookingInput): string {
  return [
    `Név: ${input.name}`,
    `Email: ${input.email}`,
    input.phone ? `Telefon: ${input.phone}` : undefined,
    input.notes ? `Megjegyzés: ${input.notes}` : undefined,
  ]
    .filter((line): line is string => typeof line === 'string')
    .join('\n');
}

export interface CreateBookingDeps {
  isSlotValidAccordingToRules?: (
    slotStart: string,
    slotEnd: string,
    service: BookingServiceContext,
  ) => Promise<boolean>;
  resolveSiteEmailConfig?: (
    siteId: string,
  ) => Promise<SiteEmailConfig>;
  resolveCalendarProvider?: (
    siteId: string,
    siteSlug: string,
  ) => Promise<GenericCalendarProvider>;
  insertBooking?: (params: {
    siteId: string;
    serviceId: string;
    input: GenericBookingInput;
    blockedStart: string;
    blockedEnd: string;
    tokenHash: string;
    tokenEncrypted: string;
    tokenExpiresAt: string;
  }) => Promise<
    | { ok: true; booking: { id: string; slot_start: string; slot_end: string } }
    | { ok: false; errorCode: string }
  >;
  createCalendarEvent?: (
    provider: GenericCalendarProvider,
    params: CreateEventParams,
  ) => Promise<CreateEventResult>;
  updateBookingCalendarSync?: (params: {
    bookingId: string;
    googleCalendarEventId: string;
  }) => Promise<boolean>;
  cancelBookingById?: (bookingId: string) => Promise<boolean>;
  sendConfirmationEmails?: (params: {
    bookingId: string;
    service: BookingServiceContext;
    input: GenericBookingInput;
    manageToken: string;
    slotStart: string;
    slotEnd: string;
  }) => Promise<{ customer: boolean; admin: boolean }>;
}

const defaultDeps: Required<CreateBookingDeps> = {
  isSlotValidAccordingToRules: defaultIsSlotValidAccordingToRules,
  resolveSiteEmailConfig,
  async resolveCalendarProvider(siteId, siteSlug) {
    return resolveGenericAvailabilityProvider(siteId, siteSlug);
  },
  async insertBooking(params) {
    const { data, error } = await getSupabase()
      .from('bookings')
      .insert({
        site_id: params.siteId,
        service_id: params.serviceId,
        customer_name: params.input.name,
        customer_email: params.input.email,
        customer_phone: params.input.phone || null,
        customer_notes: params.input.notes || null,
        slot_start: params.input.slotStart,
        slot_end: params.input.slotEnd,
        blocked_start: params.blockedStart,
        blocked_end: params.blockedEnd,
        booking_status: 'booked',
        calendar_sync_status: 'pending',
        management_token_hash: params.tokenHash,
        management_token_encrypted: params.tokenEncrypted,
        management_token_expires_at: params.tokenExpiresAt,
        locale: params.input.locale || 'hu',
        source: 'website',
      })
      .select('id, slot_start, slot_end')
      .single();

    if (error) {
      console.error('Generic booking insert failed:', error);
      return { ok: false, errorCode: error.code };
    }

    return {
      ok: true,
      booking: data as { id: string; slot_start: string; slot_end: string },
    };
  },
  async createCalendarEvent(provider, params) {
    return provider.createEvent(params);
  },
  async updateBookingCalendarSync({ bookingId, googleCalendarEventId }) {
    const { data, error } = await getSupabase()
      .from('bookings')
      .update({
        google_calendar_event_id: googleCalendarEventId,
        calendar_sync_status: 'synced',
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .eq('booking_status', 'booked')
      .eq('calendar_sync_status', 'pending')
      .is('google_calendar_event_id', null)
      .select('id');

    if (error) {
      console.error('Generic create: failed to finalize calendar sync');
      return false;
    }

    if (!data || data.length === 0) {
      // Another concurrent finalization may have already written this event.
      // Re-read the row before deciding the Calendar event is orphaned.
      const { data: current, error: readError } = await getSupabase()
        .from('bookings')
        .select('google_calendar_event_id, calendar_sync_status')
        .eq('id', bookingId)
        .maybeSingle();

      if (readError) {
        console.error('Generic create: failed to re-read booking after finalize miss');
        return false;
      }

      return (
        current?.calendar_sync_status === 'synced' &&
        current?.google_calendar_event_id === googleCalendarEventId
      );
    }

    return true;
  },
  async cancelBookingById(bookingId) {
    const { error } = await getSupabase()
      .from('bookings')
      .update({
        booking_status: 'cancelled',
        calendar_sync_status: 'failed',
        cancelled_at: new Date().toISOString(),
        cancel_reason: 'calendar_sync_failed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .eq('booking_status', 'booked')
      .eq('calendar_sync_status', 'pending');

    if (error) {
      console.error('Generic create: failed to cancel booking after sync failure');
      return false;
    }

    return true;
  },
  async sendConfirmationEmails(params) {
    try {
      return await sendGenericBookingConfirmation({
        bookingId: params.bookingId,
        service: params.service,
        customerName: params.input.name,
        customerEmail: params.input.email,
        phone: params.input.phone,
        notes: params.input.notes,
        slotStart: params.slotStart,
        slotEnd: params.slotEnd,
        manageToken: params.manageToken,
      });
    } catch (err) {
      console.error('Generic create: confirmation email failed');
      return { customer: false, admin: false };
    }
  },
};

export async function createGenericBooking(
  input: GenericBookingInput,
  service: BookingServiceContext,
  deps: CreateBookingDeps = {},
): Promise<GenericBookingOutcome> {
  const {
    isSlotValidAccordingToRules: checkRules,
    resolveSiteEmailConfig: resolveEmailConfig,
    resolveCalendarProvider,
    insertBooking,
    createCalendarEvent,
    updateBookingCalendarSync,
    cancelBookingById,
    sendConfirmationEmails,
  } = { ...defaultDeps, ...deps };

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
  const followsRules = await checkRules(
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

  // 4. Resolve the tenant Calendar provider before creating the booking.
  //    If the provider is unavailable, no booking is created.
  let provider: GenericCalendarProvider;
  try {
    provider = await resolveCalendarProvider(service.siteId, service.siteSlug);
  } catch (err) {
    console.error('Generic create: failed to resolve calendar provider');
    return {
      success: false,
      error: 'service_unavailable',
      message:
        'A foglalási időpontok átmenetileg nem kezelhetők. Kérlek próbáld újra.',
    };
  }

  // 5. Resolve and validate the tenant email config before creating the booking.
  //    Missing or invalid tenant email config blocks the create flow.
  try {
    await resolveEmailConfig(service.siteId);
  } catch (err) {
    console.error('Generic create: failed to resolve tenant email config');
    return {
      success: false,
      error: 'service_unavailable',
      message:
        'A foglalás jelenleg nem kezelhető online. Kérlek próbáld újra később.',
    };
  }

  // 6. Management token (stored, never returned).
  const managementToken = generateManagementToken();
  const tokenHash = hashManagementToken(managementToken);
  const tokenEncrypted = encryptManagementToken(managementToken);

  // 6. Insert with explicit tenant/service identity and pending sync status.
  const tokenExpiresAt = getTokenExpiresAt(input.slotEnd);
  const data = await insertBooking({
    siteId: service.siteId,
    serviceId: service.serviceId,
    input,
    blockedStart,
    blockedEnd,
    tokenHash,
    tokenEncrypted,
    tokenExpiresAt,
  });

  if (!data.ok) {
    if (data.errorCode === '23P01') {
      return {
        success: false,
        error: 'slot_taken',
        message:
          'That time was just taken. Please choose another available slot.',
      };
    }

    return {
      success: false,
      error: 'db_error',
      message: 'Something went wrong while creating the booking.',
    };
  }

  const bookingId = data.booking.id;

  // 7. Create the tenant Calendar event.
  let calendarResult: CreateEventResult;
  try {
    calendarResult = await createCalendarEvent(provider, {
      summary: buildEventSummary(service),
      description: buildEventDescription(input),
      start: input.slotStart,
      end: input.slotEnd,
      timeZone: service.timezone,
      attendeeEmail: input.email,
    });
  } catch (err) {
    console.error('Generic create: calendar event creation failed');
    await cancelBookingById(bookingId);
    return {
      success: false,
      error: 'service_unavailable',
      message:
        'A foglalás naptárba írása sikertelen. Kérlek próbáld újra.',
    };
  }

  if (!calendarResult.ok) {
    console.error('Generic create: calendar provider returned failure');
    await cancelBookingById(bookingId);
    return {
      success: false,
      error: 'service_unavailable',
      message:
        'A foglalás naptárba írása sikertelen. Kérlek próbáld újra.',
    };
  }

  // 8. Persist the Calendar event ID and mark the booking as synced.
  const synced = await updateBookingCalendarSync({
    bookingId,
    googleCalendarEventId: calendarResult.eventId,
  });

  if (!synced) {
    // The Calendar event exists but the DB finalize failed. Best-effort
    // cleanup: delete the orphan Calendar event and cancel the booking so
    // the slot is not left blocked.
    try {
      await provider.deleteEvent(calendarResult.eventId);
    } catch {
      console.error('Generic create: failed to clean up orphan calendar event');
    }

    await cancelBookingById(bookingId);

    return {
      success: false,
      error: 'db_error',
      message: 'Something went wrong while finalizing the booking.',
    };
  }

  // 9. Send tenant confirmation emails. Email failure is isolated and does
  //    not roll back the successful booking + Calendar sync.
  try {
    await sendConfirmationEmails({
      bookingId: data.booking.id,
      service,
      input,
      manageToken: managementToken,
      slotStart: data.booking.slot_start,
      slotEnd: data.booking.slot_end,
    });
  } catch (err) {
    console.error('Generic create: confirmation email failed');
  }

  return {
    success: true,
    bookingId: data.booking.id,
    slotStart: data.booking.slot_start,
    slotEnd: data.booking.slot_end,
  };
}
