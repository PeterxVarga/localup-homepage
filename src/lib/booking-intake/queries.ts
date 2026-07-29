// ============================================================
// Booking intake — query layer
//
// Loads active intake fields (with their choice options) for a
// service/site pair. Tenant-isolated: always filters by site_id and
// service_id. Fail-closed on inconsistent data.
// ============================================================

import { getSupabase } from '../supabase';
import type {
  BookingServiceIntakeField,
  BookingServiceIntakeFieldOption,
  BookingIntakeFieldType,
} from './types';
import { BookingIntakeError } from './types';

const VALID_FIELD_TYPES: Set<BookingIntakeFieldType> = new Set([
  'text',
  'textarea',
  'number',
  'single_choice',
  'multiple_choice',
]);

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
  min_value: number | null;
  max_value: number | null;
  min_selections: number;
  max_selections: number;
  sort_order: number;
  is_active: boolean;
}

interface IntakeFieldOptionRow {
  id: string;
  site_id: string;
  service_id: string;
  intake_field_id: string;
  slug: string;
  label: string;
  sort_order: number;
  is_active: boolean;
}

function mapIntakeFieldType(raw: string): BookingIntakeFieldType {
  if (!VALID_FIELD_TYPES.has(raw as BookingIntakeFieldType)) {
    throw new BookingIntakeError(
      `Invalid field_type: ${raw}`,
      'invalid_intake_configuration',
    );
  }
  return raw as BookingIntakeFieldType;
}

function mapIntakeFieldRow(
  row: IntakeFieldRow,
  options: BookingServiceIntakeFieldOption[],
): BookingServiceIntakeField {
  return {
    id: row.id,
    siteId: row.site_id,
    serviceId: row.service_id,
    slug: row.slug,
    label: row.label,
    fieldType: mapIntakeFieldType(row.field_type),
    isRequired: row.is_required,
    minLength: row.min_length,
    maxLength: row.max_length,
    minValue: row.min_value,
    maxValue: row.max_value,
    minSelections: row.min_selections,
    maxSelections: row.max_selections,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    options: options
      .filter((o) => o.intakeFieldId === row.id)
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder;
        }
        return a.id.localeCompare(b.id);
      }),
  };
}

function mapIntakeFieldOptionRow(row: IntakeFieldOptionRow): BookingServiceIntakeFieldOption {
  return {
    id: row.id,
    siteId: row.site_id,
    serviceId: row.service_id,
    intakeFieldId: row.intake_field_id,
    slug: row.slug,
    label: row.label,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

/**
 * Load active intake fields (with choice options) for a service.
 *
 * @throws BookingIntakeError if the query fails or returns inconsistent data.
 */
export async function loadBookingServiceIntakeFields(
  siteId: string,
  serviceId: string,
): Promise<BookingServiceIntakeField[]> {
  const supabase = getSupabase();

  const { data: fieldRows, error: fieldsError } = await supabase
    .from('booking_service_intake_fields')
    .select(
      'id, site_id, service_id, slug, label, field_type, is_required, min_length, max_length, min_value, max_value, min_selections, max_selections, sort_order, is_active',
    )
    .eq('site_id', siteId)
    .eq('service_id', serviceId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });

  if (fieldsError) {
    console.error('Failed to load booking service intake fields:', fieldsError);
    throw new BookingIntakeError(
      'Failed to load booking service intake fields',
      'intake_fields_load_failed',
    );
  }

  const fields = (fieldRows ?? []) as unknown as IntakeFieldRow[];

  if (fields.length === 0) {
    return [];
  }

  const fieldIds = fields.map((f) => f.id);

  const { data: optionRows, error: optionsError } = await supabase
    .from('booking_service_intake_field_options')
    .select(
      'id, site_id, service_id, intake_field_id, slug, label, sort_order, is_active',
    )
    .eq('site_id', siteId)
    .eq('service_id', serviceId)
    .eq('is_active', true)
    .in('intake_field_id', fieldIds)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });

  if (optionsError) {
    console.error('Failed to load booking service intake field options:', optionsError);
    throw new BookingIntakeError(
      'Failed to load booking service intake field options',
      'intake_field_options_load_failed',
    );
  }

  const options = ((optionRows ?? []) as unknown as IntakeFieldOptionRow[]).map(
    mapIntakeFieldOptionRow,
  );

  return fields.map((row) => mapIntakeFieldRow(row, options));
}
