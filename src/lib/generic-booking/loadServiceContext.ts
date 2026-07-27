// ============================================================
// Generic booking — service context loader
//
// Management operations (view/cancel) must keep working even if the service
// is no longer actively bookable, because the booking already exists.
// Rescheduling, however, is only allowed on active services.
//
// This module mirrors the tenant-aware resolution from
// src/lib/booking-service/queries.ts but lets the caller decide whether to
// require an active booking_services row.
// ============================================================

import { getSupabase } from '../supabase';
import type { BookingServiceContext } from '../booking-service/types';
import { BookingServiceError } from '../booking-service/types';

interface SiteRow {
  id: string;
  slug: string;
  timezone: string;
  is_active: boolean;
}

interface ServiceRow {
  id: string;
  site_id: string;
  schedule_id: string;
  slug: string;
  duration_minutes: number;
  slot_interval_minutes: number;
  minimum_notice_minutes: number;
  booking_window_days: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  cancel_cutoff_hours: number;
  reschedule_cutoff_hours: number;
  max_reschedules: number;
  public_booking_enabled: boolean;
  is_active: boolean;
}

interface ScheduleRow {
  id: string;
  site_id: string;
  is_active: boolean;
}

const SERVICE_FIELDS = [
  'id',
  'site_id',
  'schedule_id',
  'slug',
  'duration_minutes',
  'slot_interval_minutes',
  'minimum_notice_minutes',
  'booking_window_days',
  'buffer_before_minutes',
  'buffer_after_minutes',
  'cancel_cutoff_hours',
  'reschedule_cutoff_hours',
  'max_reschedules',
  'public_booking_enabled',
  'is_active',
].join(',');

function mapServiceRow(
  row: ServiceRow,
): Omit<BookingServiceContext, 'siteSlug' | 'timezone'> {
  return {
    serviceId: row.id,
    serviceSlug: row.slug,
    siteId: row.site_id,
    scheduleId: row.schedule_id,
    durationMinutes: row.duration_minutes,
    slotIntervalMinutes: row.slot_interval_minutes,
    minimumNoticeMinutes: row.minimum_notice_minutes,
    bookingWindowDays: row.booking_window_days,
    bufferBeforeMinutes: row.buffer_before_minutes,
    bufferAfterMinutes: row.buffer_after_minutes,
    cancelCutoffHours: row.cancel_cutoff_hours,
    rescheduleCutoffHours: row.reschedule_cutoff_hours,
    maxReschedules: row.max_reschedules,
    publicBookingEnabled: row.public_booking_enabled,
  };
}

async function loadServiceRow(serviceId: string): Promise<ServiceRow> {
  const { data, error } = await getSupabase()
    .from('booking_services')
    .select(SERVICE_FIELDS)
    .eq('id', serviceId)
    .maybeSingle();

  if (error) {
    console.error('Failed to load booking service by id:', error);
    throw new BookingServiceError(
      'Booking service lookup failed',
      'service_lookup_failed',
    );
  }

  if (!data) {
    throw new BookingServiceError(
      `Booking service not found: id=${serviceId}`,
      'service_not_found',
    );
  }

  return data as unknown as ServiceRow;
}

async function loadSiteAndSchedule(
  siteId: string,
  scheduleId: string,
): Promise<{ timezone: string; siteSlug: string }> {
  const [siteRes, scheduleRes] = await Promise.all([
    getSupabase()
      .from('sites')
      .select('id, slug, timezone, is_active')
      .eq('id', siteId)
      .eq('is_active', true)
      .maybeSingle(),
    getSupabase()
      .from('availability_schedules')
      .select('id, site_id, is_active')
      .eq('id', scheduleId)
      .eq('is_active', true)
      .maybeSingle(),
  ]);

  if (siteRes.error || scheduleRes.error) {
    console.error('Failed to load site or schedule:', {
      siteError: siteRes.error,
      scheduleError: scheduleRes.error,
    });
    throw new BookingServiceError(
      'Booking service lookup failed',
      'service_lookup_failed',
    );
  }

  if (!siteRes.data) {
    throw new BookingServiceError(
      `Active site not found: id=${siteId}`,
      'site_not_found',
    );
  }

  const site = siteRes.data as unknown as SiteRow;

  if (!scheduleRes.data) {
    throw new BookingServiceError(
      `Active schedule not found: id=${scheduleId}`,
      'schedule_not_found',
    );
  }

  const schedule = scheduleRes.data as unknown as ScheduleRow;

  if (schedule.site_id !== siteId) {
    throw new BookingServiceError(
      `Schedule ${scheduleId} does not belong to site ${siteId}`,
      'schedule_site_mismatch',
    );
  }

  return { timezone: site.timezone, siteSlug: site.slug };
}

async function loadContext(
  serviceId: string,
  requireActive: boolean,
): Promise<BookingServiceContext> {
  const service = await loadServiceRow(serviceId);

  if (requireActive && !service.is_active) {
    throw new BookingServiceError(
      `Booking service is inactive: id=${serviceId}`,
      'service_inactive',
    );
  }

  const { timezone, siteSlug } = await loadSiteAndSchedule(
    service.site_id,
    service.schedule_id,
  );

  return {
    ...mapServiceRow(service),
    siteSlug,
    timezone,
  };
}

/**
 * Load service context for an existing booking management operation.
 * The service itself may be inactive; only the site and schedule must be
 * active so the customer can still view/cancel an already created booking.
 */
export async function loadBookingServiceContextForManagement(
  serviceId: string,
): Promise<BookingServiceContext> {
  return loadContext(serviceId, false);
}

/**
 * Load service context for reschedule. The service must still be active,
 * otherwise new slot generation and policy enforcement are not meaningful.
 */
export async function loadActiveBookingServiceContext(
  serviceId: string,
): Promise<BookingServiceContext> {
  return loadContext(serviceId, true);
}
