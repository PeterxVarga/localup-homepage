// ============================================================
// Booking intake — query layer
//
// Loads active intake fields for a service/site pair.
// Tenant-isolated: always filters by site_id and service_id.
// Fail-closed on inconsistent data.
// ============================================================

import { getSupabase } from '../supabase';
import type { BookingServiceIntakeField } from './types';
import { BookingIntakeError } from './types';

interface IntakeFieldRow {
  id: string;
  site_id: string;
  service_id: string;
  slug: string;
  label: string;
  field_type: string;
  is_required: boolean;
  min_length: number;
  max_length: number;
  sort_order: number;
  is_active: boolean;
}

function mapIntakeFieldRow(row: IntakeFieldRow): BookingServiceIntakeField {
  if (row.field_type !== 'text' && row.field_type !== 'textarea') {
    throw new BookingIntakeError(
      `Invalid field_type for intake field ${row.id}: ${row.field_type}`,
      'invalid_intake_configuration',
    );
  }

  return {
    id: row.id,
    siteId: row.site_id,
    serviceId: row.service_id,
    slug: row.slug,
    label: row.label,
    fieldType: row.field_type,
    isRequired: row.is_required,
    minLength: row.min_length,
    maxLength: row.max_length,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

/**
 * Load active intake fields for a service.
 *
 * @throws BookingIntakeError if the query fails or returns inconsistent data.
 */
export async function loadBookingServiceIntakeFields(
  siteId: string,
  serviceId: string,
): Promise<BookingServiceIntakeField[]> {
  const { data, error } = await getSupabase()
    .from('booking_service_intake_fields')
    .select(
      'id, site_id, service_id, slug, label, field_type, is_required, min_length, max_length, sort_order, is_active',
    )
    .eq('site_id', siteId)
    .eq('service_id', serviceId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    console.error('Failed to load booking service intake fields:', error);
    throw new BookingIntakeError(
      'Failed to load booking service intake fields',
      'intake_fields_load_failed',
    );
  }

  const rows = (data ?? []) as unknown as IntakeFieldRow[];
  return rows.map(mapIntakeFieldRow);
}
