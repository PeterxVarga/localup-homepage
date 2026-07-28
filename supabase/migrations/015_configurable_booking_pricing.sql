-- ============================================================
-- Configurable booking pricing/duration foundation
--
-- Adds:
--   * pricing columns to public.booking_services
--   * public.booking_service_option_groups
--   * public.booking_service_options
--   * snapshot columns on public.bookings
--
-- Rules:
--   * Immediate booking only; no request/approval lifecycle.
--   * pricing_mode is 'fixed' or 'estimated' and only changes the
--     semantic meaning of the price, not the booking lifecycle.
--   * Existing services keep pricing_mode='fixed', base_price_minor=NULL,
--     currency='HUF' and continue to work unchanged.
--   * No dog grooming site/service/option seeding.
--
-- Security:
--   * RLS enabled on the two new config tables.
--   * No policies for anon/authenticated.
--   * service_role only.
--
-- This is a normal, one-time, additive Supabase migration.
-- Do not apply directly to production.
-- ============================================================

BEGIN;

-- ----------------------------------------------------------------
-- 1. Extend public.booking_services
-- ----------------------------------------------------------------
ALTER TABLE public.booking_services
  ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS base_price_minor integer,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'HUF';

ALTER TABLE public.booking_services
  DROP CONSTRAINT IF EXISTS booking_services_pricing_mode_check,
  ADD CONSTRAINT booking_services_pricing_mode_check
    CHECK (pricing_mode IN ('fixed', 'estimated'));

ALTER TABLE public.booking_services
  DROP CONSTRAINT IF EXISTS booking_services_base_price_minor_check,
  ADD CONSTRAINT booking_services_base_price_minor_check
    CHECK (base_price_minor IS NULL OR base_price_minor >= 0);

ALTER TABLE public.booking_services
  DROP CONSTRAINT IF EXISTS booking_services_currency_check,
  ADD CONSTRAINT booking_services_currency_check
    CHECK (currency ~ '^[A-Z]{3}$');

-- ----------------------------------------------------------------
-- 2. Snapshot columns on public.bookings
-- ----------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS calculated_price_minor integer,
  ADD COLUMN IF NOT EXISTS price_mode text,
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS intake_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pricing_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_calculated_price_minor_check,
  ADD CONSTRAINT bookings_calculated_price_minor_check
    CHECK (calculated_price_minor IS NULL OR calculated_price_minor >= 0);

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_price_mode_check,
  ADD CONSTRAINT bookings_price_mode_check
    CHECK (price_mode IS NULL OR price_mode IN ('fixed', 'estimated'));

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_currency_check,
  ADD CONSTRAINT bookings_currency_check
    CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$');

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_intake_data_object_check,
  ADD CONSTRAINT bookings_intake_data_object_check
    CHECK (jsonb_typeof(intake_data) = 'object');

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_pricing_snapshot_object_check,
  ADD CONSTRAINT bookings_pricing_snapshot_object_check
    CHECK (jsonb_typeof(pricing_snapshot) = 'object');

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_price_consistency_check,
  ADD CONSTRAINT bookings_price_consistency_check
    CHECK (
      (calculated_price_minor IS NULL AND price_mode IS NULL AND currency IS NULL)
      OR
      (calculated_price_minor IS NOT NULL AND price_mode IS NOT NULL AND currency IS NOT NULL)
    );

-- ----------------------------------------------------------------
-- 3. public.booking_service_option_groups
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.booking_service_option_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  service_id uuid NOT NULL,
  slug text NOT NULL,
  label text NOT NULL,
  selection_mode text NOT NULL,
  is_required boolean NOT NULL DEFAULT false,
  min_selections integer NOT NULL DEFAULT 0,
  max_selections integer NOT NULL DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT booking_service_option_groups_selection_mode_check
    CHECK (selection_mode IN ('single', 'multiple')),
  CONSTRAINT booking_service_option_groups_slug_not_empty_check
    CHECK (length(trim(slug)) > 0),
  CONSTRAINT booking_service_option_groups_label_not_empty_check
    CHECK (length(trim(label)) > 0),
  CONSTRAINT booking_service_option_groups_min_selections_nonneg_check
    CHECK (min_selections >= 0),
  CONSTRAINT booking_service_option_groups_min_max_check
    CHECK (min_selections <= max_selections),
  CONSTRAINT booking_service_option_groups_max_selections_range_check
    CHECK (max_selections BETWEEN 1 AND 20),
  CONSTRAINT booking_service_option_groups_single_max_one_check
    CHECK (selection_mode <> 'single' OR max_selections = 1),
  CONSTRAINT booking_service_option_groups_required_single_min_one_check
    CHECK (NOT (selection_mode = 'single' AND is_required) OR min_selections = 1),
  CONSTRAINT booking_service_option_groups_optional_single_min_check
    CHECK (NOT (selection_mode = 'single' AND NOT is_required) OR min_selections IN (0, 1)),
  CONSTRAINT booking_service_option_groups_required_multiple_min_one_check
    CHECK (NOT (selection_mode = 'multiple' AND is_required) OR min_selections >= 1),
  CONSTRAINT booking_service_option_groups_required_min_selections_check
    CHECK (
      (is_required = true AND min_selections >= 1)
      OR
      (is_required = false AND min_selections = 0)
    ),
  CONSTRAINT booking_service_option_groups_sort_order_nonneg_check
    CHECK (sort_order >= 0),

  CONSTRAINT booking_service_option_groups_service_site_fk
    FOREIGN KEY (service_id, site_id) REFERENCES public.booking_services(id, site_id)
      ON DELETE CASCADE,

  UNIQUE (service_id, slug),
  UNIQUE (id, service_id, site_id)
);

ALTER TABLE public.booking_service_option_groups ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.booking_service_option_groups FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_service_option_groups TO service_role;

DROP TRIGGER IF EXISTS booking_service_option_groups_touch
  ON public.booking_service_option_groups;
CREATE TRIGGER booking_service_option_groups_touch
  BEFORE UPDATE ON public.booking_service_option_groups
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ----------------------------------------------------------------
-- 4. public.booking_service_options
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.booking_service_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  service_id uuid NOT NULL,
  option_group_id uuid NOT NULL,
  slug text NOT NULL,
  label text NOT NULL,
  price_delta_minor integer NOT NULL DEFAULT 0,
  duration_delta_minutes integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT booking_service_options_slug_not_empty_check
    CHECK (length(trim(slug)) > 0),
  CONSTRAINT booking_service_options_label_not_empty_check
    CHECK (length(trim(label)) > 0),
  CONSTRAINT booking_service_options_duration_delta_step_check
    CHECK (duration_delta_minutes % 5 = 0),
  CONSTRAINT booking_service_options_duration_delta_range_check
    CHECK (duration_delta_minutes BETWEEN -475 AND 475),
  CONSTRAINT booking_service_options_price_delta_range_check
    CHECK (price_delta_minor BETWEEN -100000000 AND 100000000),
  CONSTRAINT booking_service_options_sort_order_nonneg_check
    CHECK (sort_order >= 0),

  CONSTRAINT booking_service_options_group_service_site_fk
    FOREIGN KEY (option_group_id, service_id, site_id)
      REFERENCES public.booking_service_option_groups(id, service_id, site_id)
      ON DELETE CASCADE,

  UNIQUE (option_group_id, slug)
);

ALTER TABLE public.booking_service_options ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.booking_service_options FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_service_options TO service_role;

DROP TRIGGER IF EXISTS booking_service_options_touch
  ON public.booking_service_options;
CREATE TRIGGER booking_service_options_touch
  BEFORE UPDATE ON public.booking_service_options
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ----------------------------------------------------------------
-- 5. Indexes
-- ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_booking_service_option_groups_service_active_sort
  ON public.booking_service_option_groups (service_id, is_active, sort_order);

CREATE INDEX IF NOT EXISTS idx_booking_service_options_group_active_sort
  ON public.booking_service_options (option_group_id, is_active, sort_order);

CREATE INDEX IF NOT EXISTS idx_booking_service_options_service_site
  ON public.booking_service_options (service_id, site_id);

-- ----------------------------------------------------------------
-- 6. Schema grant
-- ----------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO service_role;

COMMIT;
