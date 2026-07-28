// ============================================================
// Booking pricing — query layer
//
// Loads active option groups and options for a service/site pair.
// Tenant-isolated: always filters by site_id and service_id.
// Never resolves by slug alone.
// Fail-closed on ambiguous or inconsistent data.
// ============================================================

import { getSupabase } from '../supabase';
import type {
  BookingServiceOption,
  BookingServiceOptionGroup,
} from './types';
import { BookingPricingError } from './types';

interface OptionGroupRow {
  id: string;
  site_id: string;
  service_id: string;
  slug: string;
  label: string;
  selection_mode: string;
  is_required: boolean;
  min_selections: number;
  max_selections: number;
  sort_order: number;
  is_active: boolean;
}

interface OptionRow {
  id: string;
  site_id: string;
  service_id: string;
  option_group_id: string;
  slug: string;
  label: string;
  price_delta_minor: number;
  duration_delta_minutes: number;
  sort_order: number;
  is_active: boolean;
}

function mapOptionGroupRow(row: OptionGroupRow): BookingServiceOptionGroup {
  if (row.selection_mode !== 'single' && row.selection_mode !== 'multiple') {
    throw new BookingPricingError(
      `Invalid selection_mode for group ${row.id}: ${row.selection_mode}`,
      'invalid_group_configuration',
    );
  }

  return {
    id: row.id,
    siteId: row.site_id,
    serviceId: row.service_id,
    slug: row.slug,
    label: row.label,
    selectionMode: row.selection_mode,
    isRequired: row.is_required,
    minSelections: row.min_selections,
    maxSelections: row.max_selections,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

function mapOptionRow(row: OptionRow): BookingServiceOption {
  return {
    id: row.id,
    siteId: row.site_id,
    serviceId: row.service_id,
    optionGroupId: row.option_group_id,
    slug: row.slug,
    label: row.label,
    priceDeltaMinor: row.price_delta_minor,
    durationDeltaMinutes: row.duration_delta_minutes,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

/**
 * Load active option groups and options for a service.
 *
 * @throws BookingPricingError if the query fails or returns inconsistent data.
 */
export async function loadBookingServiceOptions(
  siteId: string,
  serviceId: string,
): Promise<{ groups: BookingServiceOptionGroup[]; options: BookingServiceOption[] }> {
  const supabase = getSupabase();

  const [groupsRes, optionsRes] = await Promise.all([
    supabase
      .from('booking_service_option_groups')
      .select(
        'id, site_id, service_id, slug, label, selection_mode, is_required, min_selections, max_selections, sort_order, is_active',
      )
      .eq('site_id', siteId)
      .eq('service_id', serviceId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true }),
    supabase
      .from('booking_service_options')
      .select(
        'id, site_id, service_id, option_group_id, slug, label, price_delta_minor, duration_delta_minutes, sort_order, is_active',
      )
      .eq('site_id', siteId)
      .eq('service_id', serviceId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true }),
  ]);

  if (groupsRes.error) {
    console.error('Failed to load booking service option groups:', groupsRes.error);
    throw new BookingPricingError(
      'Failed to load booking service option groups',
      'option_groups_load_failed',
    );
  }

  if (optionsRes.error) {
    console.error('Failed to load booking service options:', optionsRes.error);
    throw new BookingPricingError(
      'Failed to load booking service options',
      'options_load_failed',
    );
  }

  const groupRows = (groupsRes.data ?? []) as unknown as OptionGroupRow[];
  const optionRows = (optionsRes.data ?? []) as unknown as OptionRow[];

  const groups = groupRows.map(mapOptionGroupRow);
  const options = optionRows.map(mapOptionRow);

  // Fail-closed: every option must belong to an active group owned by the
  // same service and site. The FK on the table already enforces this at
  // insert time, but the calculator relies on this invariant.
  const groupIds = new Set(groups.map((g) => g.id));
  for (const option of options) {
    if (!groupIds.has(option.optionGroupId)) {
      throw new BookingPricingError(
        `Option ${option.id} references an inactive or missing group`,
        'inconsistent_options',
      );
    }
  }

  return { groups, options };
}
