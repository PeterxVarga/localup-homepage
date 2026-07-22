// ============================================================
// Booking service — query layer
//
// Resolves the active service context for a site/service slug pair.
// Fail-closed: missing or ambiguous data throws.
// ============================================================

import { getSupabase } from '../supabase';
import type {
  BookingServiceContext,
} from './types';
import { BookingServiceError } from './types';

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
}

interface SiteRow {
  id: string;
  slug: string;
  timezone: string;
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
].join(',');

function mapServiceRow(row: ServiceRow): Omit<BookingServiceContext, 'siteSlug' | 'timezone'> {
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
  };
}

async function loadServiceBySlug(
  serviceSlug: string,
): Promise<ServiceRow> {
  const { data, error } = await getSupabase()
    .from('booking_services')
    .select(SERVICE_FIELDS)
    .eq('slug', serviceSlug)
    .eq('is_active', true)
    .limit(2);

  if (error) {
    console.error('Failed to load booking service by slug:', error);
    throw new BookingServiceError(
      'Booking service lookup failed',
      'service_lookup_failed',
    );
  }

  if (!data || data.length === 0) {
    throw new BookingServiceError(
      `Booking service not found: ${serviceSlug}`,
      'service_not_found',
    );
  }

  if (data.length > 1) {
    throw new BookingServiceError(
      `Booking service is ambiguous: ${serviceSlug}`,
      'service_ambiguous',
    );
  }

  return data[0] as unknown as ServiceRow;
}

async function loadServiceById(
  serviceId: string,
): Promise<ServiceRow> {
  const { data, error } = await getSupabase()
    .from('booking_services')
    .select(SERVICE_FIELDS)
    .eq('id', serviceId)
    .eq('is_active', true)
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
  expectedSiteSlug?: string,
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
      .select('id, is_active')
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
      expectedSiteSlug
        ? `Active site not found: id=${siteId}, slug=${expectedSiteSlug}`
        : `Active site not found: id=${siteId}`,
      'site_not_found',
    );
  }

  const site = siteRes.data as unknown as SiteRow;

  if (expectedSiteSlug && site.slug !== expectedSiteSlug) {
    throw new BookingServiceError(
      `Site slug mismatch: expected ${expectedSiteSlug}, found ${site.slug}`,
      'site_slug_mismatch',
    );
  }

  if (!scheduleRes.data) {
    throw new BookingServiceError(
      `Active schedule not found: id=${scheduleId}`,
      'schedule_not_found',
    );
  }

  return { timezone: site.timezone, siteSlug: site.slug };
}

/**
 * Load the active booking service context by site and service slug.
 *
 * @throws BookingServiceError if the service is missing, inactive,
 *         or the relationship is ambiguous.
 */
export async function getBookingServiceContext(
  siteSlug: string,
  serviceSlug: string,
): Promise<BookingServiceContext> {
  const service = await loadServiceBySlug(serviceSlug);
  const { timezone, siteSlug: actualSiteSlug } = await loadSiteAndSchedule(
    service.site_id,
    service.schedule_id,
    siteSlug,
  );

  return {
    ...mapServiceRow(service),
    siteSlug: actualSiteSlug,
    timezone,
  };
}

/**
 * Load the active booking service context by service id.
 *
 * @throws BookingServiceError if the service is missing or inactive.
 */
export async function getBookingServiceContextById(
  serviceId: string,
): Promise<BookingServiceContext> {
  const service = await loadServiceById(serviceId);
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
