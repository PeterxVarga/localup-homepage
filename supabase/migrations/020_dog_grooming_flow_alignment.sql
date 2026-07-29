-- ============================================================
-- Dog Grooming flow alignment
--
-- Aligns the bundas-demo backend contract with the locked
-- five-step Dog Grooming booking flow:
--
--   1. Service
--   2. Kutyusod
--   3. Részletek
--   4. Időpont
--   5. Adatok
--
-- This migration is purely additive and safe:
--   * Updates existing full-grooming and bath-and-brush services in place
--     (same deterministic IDs) with the new contract.
--   * Adds the new trimming-special-care service.
--   * Deactivates the legacy nail-trimming and puppy-first-groom demos.
--   * Extends the configurable intake model with number, single_choice and
--     multiple_choice field types and a choice-options table.
--   * Adds the locked intake fields for the three active services.
--   * Adds the locked pricing option groups (coat-condition, desired-result)
--     and the size/add-on groups for trimming-special-care.
--
-- Security:
--   * RLS enabled on the new choice-options table.
--   * No policies for anon/authenticated.
--   * service_role only.
--
-- This is a normal, one-time, additive Supabase migration.
-- Do not apply directly to production.
-- ============================================================

BEGIN;

-- ----------------------------------------------------------------
-- 1. Extend intake field configuration
-- ----------------------------------------------------------------
ALTER TABLE public.booking_service_intake_fields
  ADD COLUMN IF NOT EXISTS min_value numeric,
  ADD COLUMN IF NOT EXISTS max_value numeric,
  ADD COLUMN IF NOT EXISTS min_selections integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_selections integer NOT NULL DEFAULT 0;

ALTER TABLE public.booking_service_intake_fields
  DROP CONSTRAINT IF EXISTS booking_service_intake_fields_field_type_check,
  ADD CONSTRAINT booking_service_intake_fields_field_type_check
    CHECK (field_type IN ('text', 'textarea', 'number', 'single_choice', 'multiple_choice'));

ALTER TABLE public.booking_service_intake_fields
  DROP CONSTRAINT IF EXISTS booking_service_intake_fields_min_value_check,
  ADD CONSTRAINT booking_service_intake_fields_min_value_check
    CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value);

ALTER TABLE public.booking_service_intake_fields
  DROP CONSTRAINT IF EXISTS booking_service_intake_fields_min_selections_nonneg_check,
  ADD CONSTRAINT booking_service_intake_fields_min_selections_nonneg_check
    CHECK (min_selections >= 0);

ALTER TABLE public.booking_service_intake_fields
  DROP CONSTRAINT IF EXISTS booking_service_intake_fields_max_selections_range_check,
  ADD CONSTRAINT booking_service_intake_fields_max_selections_range_check
    CHECK (max_selections BETWEEN 0 AND 200);

ALTER TABLE public.booking_service_intake_fields
  DROP CONSTRAINT IF EXISTS booking_service_intake_fields_selections_order_check,
  ADD CONSTRAINT booking_service_intake_fields_selections_order_check
    CHECK (min_selections <= max_selections);

ALTER TABLE public.booking_service_intake_fields
  DROP CONSTRAINT IF EXISTS booking_service_intake_fields_required_choice_check,
  ADD CONSTRAINT booking_service_intake_fields_required_choice_check
    CHECK (
      NOT is_required
      OR field_type NOT IN ('single_choice', 'multiple_choice')
      OR min_selections >= 1
    );

ALTER TABLE public.booking_service_intake_fields
  DROP CONSTRAINT IF EXISTS booking_service_intake_fields_optional_choice_check,
  ADD CONSTRAINT booking_service_intake_fields_optional_choice_check
    CHECK (
      is_required
      OR field_type NOT IN ('single_choice', 'multiple_choice')
      OR min_selections = 0
    );

ALTER TABLE public.booking_service_intake_fields
  DROP CONSTRAINT IF EXISTS booking_service_intake_fields_number_bounds_check,
  ADD CONSTRAINT booking_service_intake_fields_number_bounds_check
    CHECK (
      field_type = 'number'
      OR (min_value IS NULL AND max_value IS NULL)
    );

ALTER TABLE public.booking_service_intake_fields
  DROP CONSTRAINT IF EXISTS booking_service_intake_fields_single_choice_max_one,
  ADD CONSTRAINT booking_service_intake_fields_single_choice_max_one
    CHECK (field_type <> 'single_choice' OR max_selections = 1);

-- ----------------------------------------------------------------
-- 2. Intake field choice options table
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.booking_service_intake_field_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  service_id uuid NOT NULL,
  intake_field_id uuid NOT NULL,
  slug text NOT NULL,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT booking_service_intake_field_options_slug_not_empty_check
    CHECK (length(trim(slug)) > 0),
  CONSTRAINT booking_service_intake_field_options_slug_format_check
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT booking_service_intake_field_options_label_not_empty_check
    CHECK (length(trim(label)) > 0),
  CONSTRAINT booking_service_intake_field_options_sort_order_nonneg_check
    CHECK (sort_order >= 0),

  CONSTRAINT booking_service_intake_field_options_field_service_site_fk
    FOREIGN KEY (intake_field_id, service_id, site_id)
      REFERENCES public.booking_service_intake_fields(id, service_id, site_id)
      ON DELETE CASCADE,

  UNIQUE (intake_field_id, slug),
  UNIQUE (id, service_id, site_id)
);

CREATE INDEX IF NOT EXISTS idx_booking_service_intake_field_options_field_service_site
  ON public.booking_service_intake_field_options (intake_field_id, service_id, site_id);

CREATE INDEX IF NOT EXISTS idx_booking_service_intake_field_options_service_active_sort
  ON public.booking_service_intake_field_options (service_id, is_active, sort_order);

ALTER TABLE public.booking_service_intake_field_options ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.booking_service_intake_field_options
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.booking_service_intake_field_options TO service_role;

DROP TRIGGER IF EXISTS booking_service_intake_field_options_touch
  ON public.booking_service_intake_field_options;
CREATE TRIGGER booking_service_intake_field_options_touch
  BEFORE UPDATE ON public.booking_service_intake_field_options
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Trigger: choice options may only be attached to choice fields.
CREATE OR REPLACE FUNCTION public.check_intake_option_field_type()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.booking_service_intake_fields
    WHERE id = NEW.intake_field_id
      AND service_id = NEW.service_id
      AND site_id = NEW.site_id
      AND field_type IN ('single_choice', 'multiple_choice')
  ) THEN
    RAISE EXCEPTION 'Intake field options may only be added to single_choice or multiple_choice fields';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

REVOKE ALL ON FUNCTION public.check_intake_option_field_type()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_intake_option_field_type()
  TO service_role;

DROP TRIGGER IF EXISTS booking_service_intake_field_options_type_check
  ON public.booking_service_intake_field_options;
CREATE TRIGGER booking_service_intake_field_options_type_check
  BEFORE INSERT OR UPDATE ON public.booking_service_intake_field_options
  FOR EACH ROW EXECUTE FUNCTION public.check_intake_option_field_type();

-- ----------------------------------------------------------------
-- 3. Pre-condition: bundas-demo site and 018/019 contract exist
-- ----------------------------------------------------------------
DO $$
DECLARE
  service_check record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sites
    WHERE id = 'd1111111-1111-1111-1111-111111111111'::uuid
      AND slug = 'bundas-demo'
      AND name = 'Bundás Kutyakozmetika'
      AND timezone = 'Europe/Budapest'
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Flow alignment failed: bundas-demo site is missing or has non-matching values';
  END IF;

  FOR service_check IN
    SELECT *
    FROM (VALUES
      ('d3333333-3333-3333-3333-333333333333'::uuid, 'full-grooming'),
      ('d4444444-4444-4444-4444-444444444444'::uuid, 'bath-and-brush'),
      ('d5555555-5555-5555-5555-555555555555'::uuid, 'nail-trimming'),
      ('d6666666-6666-6666-6666-666666666666'::uuid, 'puppy-first-groom')
    ) AS expected(id, slug)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.booking_services
      WHERE site_id = 'd1111111-1111-1111-1111-111111111111'::uuid
        AND id = service_check.id
        AND slug = service_check.slug
    ) THEN
      RAISE EXCEPTION 'Flow alignment failed: expected service %/% is missing', service_check.id, service_check.slug;
    END IF;
  END LOOP;
END;
$$;

-- ----------------------------------------------------------------
-- 4. Update existing services and insert the new one
-- ----------------------------------------------------------------
UPDATE public.booking_services
SET
  name = 'Teljes kutyakozmetika',
  duration_minutes = 90,
  max_duration_minutes = 120,
  pricing_mode = 'estimated',
  base_price_minor = 14900,
  base_price_max_minor = 17900,
  public_booking_enabled = false,
  is_active = true,
  updated_at = now()
WHERE id = 'd3333333-3333-3333-3333-333333333333'::uuid
  AND site_id = 'd1111111-1111-1111-1111-111111111111'::uuid
  AND slug = 'full-grooming';

UPDATE public.booking_services
SET
  name = 'Fürdetés és szőrápolás',
  duration_minutes = 45,
  max_duration_minutes = 75,
  pricing_mode = 'estimated',
  base_price_minor = 12900,
  base_price_max_minor = 15900,
  public_booking_enabled = false,
  is_active = true,
  updated_at = now()
WHERE id = 'd4444444-4444-4444-4444-444444444444'::uuid
  AND site_id = 'd1111111-1111-1111-1111-111111111111'::uuid
  AND slug = 'bath-and-brush';

UPDATE public.booking_services
SET
  public_booking_enabled = false,
  is_active = false,
  updated_at = now()
WHERE id IN (
  'd5555555-5555-5555-5555-555555555555'::uuid,
  'd6666666-6666-6666-6666-666666666666'::uuid
)
  AND site_id = 'd1111111-1111-1111-1111-111111111111'::uuid;

INSERT INTO public.booking_services (
  id,
  site_id,
  schedule_id,
  slug,
  name,
  duration_minutes,
  max_duration_minutes,
  slot_interval_minutes,
  minimum_notice_minutes,
  booking_window_days,
  buffer_before_minutes,
  buffer_after_minutes,
  cancel_cutoff_hours,
  reschedule_cutoff_hours,
  max_reschedules,
  public_booking_enabled,
  is_active,
  pricing_mode,
  base_price_minor,
  base_price_max_minor,
  currency
) VALUES (
  'd7777777-7777-7777-7777-777777777777'::uuid,
  'd1111111-1111-1111-1111-111111111111'::uuid,
  'd2222222-2222-2222-2222-222222222222'::uuid,
  'trimming-special-care',
  'Trimmelés és speciális ápolás',
  90,
  150,
  15,
  720,
  60,
  0,
  0,
  12,
  12,
  2,
  false,
  true,
  'estimated',
  16900,
  20900,
  'HUF'
)
ON CONFLICT (site_id, slug) DO NOTHING;

-- ----------------------------------------------------------------
-- 5. Update existing intake fields and add the locked-flow fields
-- ----------------------------------------------------------------
UPDATE public.booking_service_intake_fields
SET label = 'Fajta', updated_at = now()
WHERE id IN (
  'e3333333-3333-3333-3333-333333333331'::uuid,
  'e4444444-4444-4444-4444-444444444441'::uuid
)
  AND site_id = 'd1111111-1111-1111-1111-111111111111'::uuid;

UPDATE public.booking_service_intake_fields
SET max_length = 120, updated_at = now()
WHERE slug = 'temperament-notes'
  AND site_id = 'd1111111-1111-1111-1111-111111111111'::uuid;

INSERT INTO public.booking_service_intake_fields (
  id,
  site_id,
  service_id,
  slug,
  label,
  field_type,
  is_required,
  min_length,
  max_length,
  min_value,
  max_value,
  min_selections,
  max_selections,
  sort_order,
  is_active
) VALUES
  -- full-grooming
  ('e3333333-3333-3333-3333-333333333333'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'dog-name', 'Kutyus neve', 'text', true, 1, 80, null, null, 0, 0, 0, true),
  ('e3333333-3333-3333-3333-333333333334'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'dog-weight-kg', 'Testsúly', 'number', false, 0, 1, 1, 100, 0, 0, 2, true),
  ('e3333333-3333-3333-3333-333333333335'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'dog-age-group', 'Életkor', 'single_choice', true, 1, 1, null, null, 1, 1, 3, true),
  ('e3333333-3333-3333-3333-333333333336'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'care-considerations', 'Amire figyeljünk', 'multiple_choice', false, 0, 1, null, null, 0, 5, 4, true),
  -- bath-and-brush
  ('e4444444-4444-4444-4444-444444444443'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'dog-name', 'Kutyus neve', 'text', true, 1, 80, null, null, 0, 0, 0, true),
  ('e4444444-4444-4444-4444-444444444444'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'dog-weight-kg', 'Testsúly', 'number', false, 0, 1, 1, 100, 0, 0, 2, true),
  ('e4444444-4444-4444-4444-444444444445'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'dog-age-group', 'Életkor', 'single_choice', true, 1, 1, null, null, 1, 1, 3, true),
  ('e4444444-4444-4444-4444-444444444446'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'care-considerations', 'Amire figyeljünk', 'multiple_choice', false, 0, 1, null, null, 0, 5, 4, true),
  -- trimming-special-care
  ('e7777777-7777-7777-7777-777777777771'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'dog-name', 'Kutyus neve', 'text', true, 1, 80, null, null, 0, 0, 0, true),
  ('e7777777-7777-7777-7777-777777777772'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'dog-breed', 'Fajta', 'text', true, 2, 100, null, null, 0, 0, 1, true),
  ('e7777777-7777-7777-7777-777777777773'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'temperament-notes', 'Temperamentum és különleges tudnivalók', 'textarea', false, 0, 120, null, null, 0, 0, 5, true),
  ('e7777777-7777-7777-7777-777777777774'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'dog-weight-kg', 'Testsúly', 'number', false, 0, 1, 1, 100, 0, 0, 2, true),
  ('e7777777-7777-7777-7777-777777777775'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'dog-age-group', 'Életkor', 'single_choice', true, 1, 1, null, null, 1, 1, 3, true),
  ('e7777777-7777-7777-7777-777777777776'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'care-considerations', 'Amire figyeljünk', 'multiple_choice', false, 0, 1, null, null, 0, 5, 4, true)
ON CONFLICT (service_id, slug) DO NOTHING;

-- ----------------------------------------------------------------
-- 6. Intake field choice options
-- ----------------------------------------------------------------
INSERT INTO public.booking_service_intake_field_options (
  id,
  site_id,
  service_id,
  intake_field_id,
  slug,
  label,
  sort_order,
  is_active
) VALUES
  -- full-grooming dog-age-group
  ('e3333333-3333-3333-3333-333333333351'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'e3333333-3333-3333-3333-333333333335'::uuid, 'puppy', 'Kölyök, 0–12 hó', 0, true),
  ('e3333333-3333-3333-3333-333333333352'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'e3333333-3333-3333-3333-333333333335'::uuid, 'adult', 'Felnőtt, 1–7 év', 1, true),
  ('e3333333-3333-3333-3333-333333333353'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'e3333333-3333-3333-3333-333333333335'::uuid, 'senior', 'Senior, 7+ év', 2, true),
  -- full-grooming care-considerations
  ('e3333333-3333-3333-3333-333333333361'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'e3333333-3333-3333-3333-333333333336'::uuid, 'first-groom', 'Első kozmetikálás', 0, true),
  ('e3333333-3333-3333-3333-333333333362'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'e3333333-3333-3333-3333-333333333336'::uuid, 'anxious', 'Szorongó', 1, true),
  ('e3333333-3333-3333-3333-333333333363'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'e3333333-3333-3333-3333-333333333336'::uuid, 'sensitive-skin', 'Érzékeny bőr', 2, true),
  ('e3333333-3333-3333-3333-333333333364'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'e3333333-3333-3333-3333-333333333336'::uuid, 'allergy', 'Allergia', 3, true),
  ('e3333333-3333-3333-3333-333333333365'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'e3333333-3333-3333-3333-333333333336'::uuid, 'puppy-or-senior', 'Kölyök vagy senior', 4, true),
  -- bath-and-brush dog-age-group
  ('e4444444-4444-4444-4444-444444444451'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'e4444444-4444-4444-4444-444444444445'::uuid, 'puppy', 'Kölyök, 0–12 hó', 0, true),
  ('e4444444-4444-4444-4444-444444444452'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'e4444444-4444-4444-4444-444444444445'::uuid, 'adult', 'Felnőtt, 1–7 év', 1, true),
  ('e4444444-4444-4444-4444-444444444453'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'e4444444-4444-4444-4444-444444444445'::uuid, 'senior', 'Senior, 7+ év', 2, true),
  -- bath-and-brush care-considerations
  ('e4444444-4444-4444-4444-444444444461'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'e4444444-4444-4444-4444-444444444446'::uuid, 'first-groom', 'Első kozmetikálás', 0, true),
  ('e4444444-4444-4444-4444-444444444462'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'e4444444-4444-4444-4444-444444444446'::uuid, 'anxious', 'Szorongó', 1, true),
  ('e4444444-4444-4444-4444-444444444463'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'e4444444-4444-4444-4444-444444444446'::uuid, 'sensitive-skin', 'Érzékeny bőr', 2, true),
  ('e4444444-4444-4444-4444-444444444464'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'e4444444-4444-4444-4444-444444444446'::uuid, 'allergy', 'Allergia', 3, true),
  ('e4444444-4444-4444-4444-444444444465'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'e4444444-4444-4444-4444-444444444446'::uuid, 'puppy-or-senior', 'Kölyök vagy senior', 4, true),
  -- trimming-special-care dog-age-group
  ('e7777777-7777-7777-7777-777777777751'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'e7777777-7777-7777-7777-777777777775'::uuid, 'puppy', 'Kölyök, 0–12 hó', 0, true),
  ('e7777777-7777-7777-7777-777777777752'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'e7777777-7777-7777-7777-777777777775'::uuid, 'adult', 'Felnőtt, 1–7 év', 1, true),
  ('e7777777-7777-7777-7777-777777777753'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'e7777777-7777-7777-7777-777777777775'::uuid, 'senior', 'Senior, 7+ év', 2, true),
  -- trimming-special-care care-considerations
  ('e7777777-7777-7777-7777-777777777761'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'e7777777-7777-7777-7777-777777777776'::uuid, 'first-groom', 'Első kozmetikálás', 0, true),
  ('e7777777-7777-7777-7777-777777777762'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'e7777777-7777-7777-7777-777777777776'::uuid, 'anxious', 'Szorongó', 1, true),
  ('e7777777-7777-7777-7777-777777777763'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'e7777777-7777-7777-7777-777777777776'::uuid, 'sensitive-skin', 'Érzékeny bőr', 2, true),
  ('e7777777-7777-7777-7777-777777777764'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'e7777777-7777-7777-7777-777777777776'::uuid, 'allergy', 'Allergia', 3, true),
  ('e7777777-7777-7777-7777-777777777765'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'e7777777-7777-7777-7777-777777777776'::uuid, 'puppy-or-senior', 'Kölyök vagy senior', 4, true)
ON CONFLICT (intake_field_id, slug) DO NOTHING;

-- ----------------------------------------------------------------
-- 7. New pricing option groups
-- ----------------------------------------------------------------
INSERT INTO public.booking_service_option_groups (
  id,
  site_id,
  service_id,
  slug,
  label,
  selection_mode,
  is_required,
  min_selections,
  max_selections,
  sort_order,
  is_active
) VALUES
  -- full-grooming
  ('d7111111-1111-1111-1111-111111111113'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'coat-condition', 'Szőrzet állapota', 'single', true, 1, 1, 2, true),
  ('d7111111-1111-1111-1111-111111111114'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'desired-result', 'Kívánt eredmény', 'single', true, 1, 1, 3, true),
  -- bath-and-brush
  ('d8111111-1111-1111-1111-111111111113'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'coat-condition', 'Szőrzet állapota', 'single', true, 1, 1, 2, true),
  ('d8111111-1111-1111-1111-111111111114'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'desired-result', 'Kívánt eredmény', 'single', true, 1, 1, 3, true),
  -- trimming-special-care
  ('d9111111-1111-1111-1111-111111111111'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'dog-size', 'A kutya mérete', 'single', true, 1, 1, 0, true),
  ('d9111111-1111-1111-1111-111111111112'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'coat-condition', 'Szőrzet állapota', 'single', true, 1, 1, 1, true),
  ('d9111111-1111-1111-1111-111111111113'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'desired-result', 'Kívánt eredmény', 'single', true, 1, 1, 2, true),
  ('d9111111-1111-1111-1111-111111111114'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'add-ons', 'Kiegészítő kezelések', 'multiple', false, 0, 3, 3, true)
ON CONFLICT (service_id, slug) DO NOTHING;

-- ----------------------------------------------------------------
-- 8. New pricing options
-- ----------------------------------------------------------------
INSERT INTO public.booking_service_options (
  id,
  site_id,
  service_id,
  option_group_id,
  slug,
  label,
  price_delta_minor,
  price_delta_max_minor,
  duration_delta_minutes,
  duration_delta_max_minutes,
  sort_order,
  is_active
) VALUES
  -- full-grooming coat-condition
  ('d7111111-1111-1111-1111-111111111151'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111113'::uuid, 'maintained', 'Rendszeresen ápolt', 0, 0, 0, 0, 0, true),
  ('d7111111-1111-1111-1111-111111111152'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111113'::uuid, 'slightly-matted', 'Kissé csomós', 2000, 3000, 20, 20, 1, true),
  ('d7111111-1111-1111-1111-111111111153'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111113'::uuid, 'heavily-matted', 'Erősen csomós vagy filces', 5000, 8000, 40, 60, 2, true),
  ('d7111111-1111-1111-1111-111111111154'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111113'::uuid, 'unknown', 'Nem tudom megítélni', 0, 3000, 0, 20, 3, true),
  -- full-grooming desired-result
  ('d7111111-1111-1111-1111-111111111161'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111114'::uuid, 'light-trim', 'Csak egy kis igazítás', 0, 0, 0, 0, 0, true),
  ('d7111111-1111-1111-1111-111111111162'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111114'::uuid, 'short-manageable', 'Rövidebb, könnyen kezelhető', 0, 0, 0, 0, 1, true),
  ('d7111111-1111-1111-1111-111111111163'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111114'::uuid, 'breed-standard', 'Fajtának megfelelő fazon', 2000, 3000, 15, 30, 2, true),
  ('d7111111-1111-1111-1111-111111111164'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111114'::uuid, 'groomer-choice', 'Rábízom a kozmetikusra', 0, 2000, 0, 15, 3, true),
  -- bath-and-brush coat-condition
  ('d8111111-1111-1111-1111-111111111151'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111113'::uuid, 'maintained', 'Rendszeresen ápolt', 0, 0, 0, 0, 0, true),
  ('d8111111-1111-1111-1111-111111111152'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111113'::uuid, 'slightly-matted', 'Kissé csomós', 2000, 3000, 20, 20, 1, true),
  ('d8111111-1111-1111-1111-111111111153'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111113'::uuid, 'heavily-matted', 'Erősen csomós vagy filces', 5000, 8000, 40, 60, 2, true),
  ('d8111111-1111-1111-1111-111111111154'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111113'::uuid, 'unknown', 'Nem tudom megítélni', 0, 3000, 0, 20, 3, true),
  -- bath-and-brush desired-result
  ('d8111111-1111-1111-1111-111111111161'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111114'::uuid, 'light-trim', 'Csak egy kis igazítás', 0, 0, 0, 0, 0, true),
  ('d8111111-1111-1111-1111-111111111162'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111114'::uuid, 'short-manageable', 'Rövidebb, könnyen kezelhető', 0, 0, 0, 0, 1, true),
  ('d8111111-1111-1111-1111-111111111163'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111114'::uuid, 'breed-standard', 'Fajtának megfelelő fazon', 2000, 3000, 15, 30, 2, true),
  ('d8111111-1111-1111-1111-111111111164'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111114'::uuid, 'groomer-choice', 'Rábízom a kozmetikusra', 0, 2000, 0, 15, 3, true),
  -- trimming-special-care dog-size
  ('d9111111-1111-1111-1111-111111111121'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111111'::uuid, 'small', 'Kistestű, 0–10 kg', 0, 0, 0, 0, 0, true),
  ('d9111111-1111-1111-1111-111111111122'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111111'::uuid, 'medium', 'Közepes, 11–25 kg', 3000, 4000, 15, 30, 1, true),
  ('d9111111-1111-1111-1111-111111111123'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111111'::uuid, 'large', 'Nagytestű, 26–40 kg', 6000, 8000, 30, 45, 2, true),
  ('d9111111-1111-1111-1111-111111111124'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111111'::uuid, 'extra-large', 'Óriástestű, 40 kg felett', 9000, 12000, 45, 60, 3, true),
  -- trimming-special-care coat-condition
  ('d9111111-1111-1111-1111-111111111151'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111112'::uuid, 'maintained', 'Rendszeresen ápolt', 0, 0, 0, 0, 0, true),
  ('d9111111-1111-1111-1111-111111111152'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111112'::uuid, 'slightly-matted', 'Kissé csomós', 2000, 3000, 20, 20, 1, true),
  ('d9111111-1111-1111-1111-111111111153'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111112'::uuid, 'heavily-matted', 'Erősen csomós vagy filces', 5000, 8000, 40, 60, 2, true),
  ('d9111111-1111-1111-1111-111111111154'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111112'::uuid, 'unknown', 'Nem tudom megítélni', 0, 3000, 0, 20, 3, true),
  -- trimming-special-care desired-result
  ('d9111111-1111-1111-1111-111111111161'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111113'::uuid, 'light-trim', 'Csak egy kis igazítás', 0, 0, 0, 0, 0, true),
  ('d9111111-1111-1111-1111-111111111162'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111113'::uuid, 'short-manageable', 'Rövidebb, könnyen kezelhető', 0, 0, 0, 0, 1, true),
  ('d9111111-1111-1111-1111-111111111163'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111113'::uuid, 'breed-standard', 'Fajtának megfelelő fazon', 2000, 3000, 15, 30, 2, true),
  ('d9111111-1111-1111-1111-111111111164'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111113'::uuid, 'groomer-choice', 'Rábízom a kozmetikusra', 0, 2000, 0, 15, 3, true),
  -- trimming-special-care add-ons
  ('d9111111-1111-1111-1111-111111111131'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111114'::uuid, 'deshedding', 'Aljszőrkiszedés', 3000, 5000, 15, 30, 0, true),
  ('d9111111-1111-1111-1111-111111111132'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111114'::uuid, 'teeth-cleaning', 'Fogtisztítás', 2500, 2500, 10, 10, 1, true),
  ('d9111111-1111-1111-1111-111111111133'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111114'::uuid, 'paw-care', 'Mancsápolás', 2000, 2000, 10, 10, 2, true)
ON CONFLICT (option_group_id, slug) DO NOTHING;

-- ----------------------------------------------------------------
-- 9. Exact post-checks
-- ----------------------------------------------------------------
DO $$
DECLARE
  v_expected_count int;
  v_actual_count int;
BEGIN
  -- Services
  CREATE TEMP TABLE expected_services (
    id uuid PRIMARY KEY,
    slug text NOT NULL,
    name text NOT NULL,
    duration_minutes int NOT NULL,
    max_duration_minutes int,
    is_active boolean NOT NULL,
    pricing_mode text NOT NULL,
    base_price_minor int,
    base_price_max_minor int
  ) ON COMMIT DROP;

  INSERT INTO expected_services
    (id, slug, name, duration_minutes, max_duration_minutes, is_active, pricing_mode, base_price_minor, base_price_max_minor)
  VALUES
    ('d3333333-3333-3333-3333-333333333333'::uuid, 'full-grooming', 'Teljes kutyakozmetika', 90, 120, true, 'estimated', 14900, 17900),
    ('d4444444-4444-4444-4444-444444444444'::uuid, 'bath-and-brush', 'Fürdetés és szőrápolás', 45, 75, true, 'estimated', 12900, 15900),
    ('d7777777-7777-7777-7777-777777777777'::uuid, 'trimming-special-care', 'Trimmelés és speciális ápolás', 90, 150, true, 'estimated', 16900, 20900),
    ('d5555555-5555-5555-5555-555555555555'::uuid, 'nail-trimming', 'Karomvágás', 15, 15, false, 'fixed', 3500, 3500),
    ('d6666666-6666-6666-6666-666666666666'::uuid, 'puppy-first-groom', 'Első kölyökkozmetika', 45, 45, false, 'fixed', 6900, 6900);

  SELECT count(*) INTO v_expected_count FROM expected_services;

  SELECT count(*) INTO v_actual_count
  FROM public.booking_services bs
  JOIN expected_services es ON bs.id = es.id
  WHERE bs.site_id = 'd1111111-1111-1111-1111-111111111111'::uuid
    AND bs.slug = es.slug
    AND bs.name = es.name
    AND bs.duration_minutes = es.duration_minutes
    AND (bs.max_duration_minutes IS NOT DISTINCT FROM es.max_duration_minutes)
    AND bs.is_active = es.is_active
    AND bs.pricing_mode = es.pricing_mode
    AND (bs.base_price_minor IS NOT DISTINCT FROM es.base_price_minor)
    AND (bs.base_price_max_minor IS NOT DISTINCT FROM es.base_price_max_minor)
    AND bs.public_booking_enabled = false
    AND bs.currency = 'HUF'
    AND bs.slot_interval_minutes = 15;

  IF v_actual_count <> v_expected_count THEN
    RAISE EXCEPTION 'Flow alignment failed: expected % services matching the exact contract, found %', v_expected_count, v_actual_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.booking_services
    WHERE site_id = 'd1111111-1111-1111-1111-111111111111'::uuid
      AND slug IN (SELECT slug FROM expected_services)
      AND id NOT IN (SELECT id FROM expected_services)
  ) THEN
    RAISE EXCEPTION 'Flow alignment failed: expected service slugs already exist with different IDs';
  END IF;

  -- Intake fields (only the active services)
  CREATE TEMP TABLE expected_intake_fields (
    id uuid PRIMARY KEY,
    service_id uuid NOT NULL,
    slug text NOT NULL,
    label text NOT NULL,
    field_type text NOT NULL,
    is_required boolean NOT NULL,
    min_length int NOT NULL,
    max_length int NOT NULL,
    min_value int,
    max_value int,
    min_selections int NOT NULL,
    max_selections int NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO expected_intake_fields
    (id, service_id, slug, label, field_type, is_required, min_length, max_length, min_value, max_value, min_selections, max_selections)
  VALUES
    -- full-grooming
    ('e3333333-3333-3333-3333-333333333333'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'dog-name', 'Kutyus neve', 'text', true, 1, 80, null, null, 0, 0),
    ('e3333333-3333-3333-3333-333333333331'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'dog-breed', 'Fajta', 'text', true, 2, 100, null, null, 0, 0),
    ('e3333333-3333-3333-3333-333333333334'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'dog-weight-kg', 'Testsúly', 'number', false, 0, 1, 1, 100, 0, 0),
    ('e3333333-3333-3333-3333-333333333335'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'dog-age-group', 'Életkor', 'single_choice', true, 1, 1, null, null, 1, 1),
    ('e3333333-3333-3333-3333-333333333336'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'care-considerations', 'Amire figyeljünk', 'multiple_choice', false, 0, 1, null, null, 0, 5),
    ('e3333333-3333-3333-3333-333333333332'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'temperament-notes', 'Temperamentum és különleges tudnivalók', 'textarea', false, 0, 120, null, null, 0, 0),
    -- bath-and-brush
    ('e4444444-4444-4444-4444-444444444443'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'dog-name', 'Kutyus neve', 'text', true, 1, 80, null, null, 0, 0),
    ('e4444444-4444-4444-4444-444444444441'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'dog-breed', 'Fajta', 'text', true, 2, 100, null, null, 0, 0),
    ('e4444444-4444-4444-4444-444444444444'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'dog-weight-kg', 'Testsúly', 'number', false, 0, 1, 1, 100, 0, 0),
    ('e4444444-4444-4444-4444-444444444445'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'dog-age-group', 'Életkor', 'single_choice', true, 1, 1, null, null, 1, 1),
    ('e4444444-4444-4444-4444-444444444446'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'care-considerations', 'Amire figyeljünk', 'multiple_choice', false, 0, 1, null, null, 0, 5),
    ('e4444444-4444-4444-4444-444444444442'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'temperament-notes', 'Temperamentum és különleges tudnivalók', 'textarea', false, 0, 120, null, null, 0, 0),
    -- trimming-special-care
    ('e7777777-7777-7777-7777-777777777771'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'dog-name', 'Kutyus neve', 'text', true, 1, 80, null, null, 0, 0),
    ('e7777777-7777-7777-7777-777777777772'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'dog-breed', 'Fajta', 'text', true, 2, 100, null, null, 0, 0),
    ('e7777777-7777-7777-7777-777777777774'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'dog-weight-kg', 'Testsúly', 'number', false, 0, 1, 1, 100, 0, 0),
    ('e7777777-7777-7777-7777-777777777775'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'dog-age-group', 'Életkor', 'single_choice', true, 1, 1, null, null, 1, 1),
    ('e7777777-7777-7777-7777-777777777776'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'care-considerations', 'Amire figyeljünk', 'multiple_choice', false, 0, 1, null, null, 0, 5),
    ('e7777777-7777-7777-7777-777777777773'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'temperament-notes', 'Temperamentum és különleges tudnivalók', 'textarea', false, 0, 120, null, null, 0, 0);

  SELECT count(*) INTO v_expected_count FROM expected_intake_fields;

  SELECT count(*) INTO v_actual_count
  FROM public.booking_service_intake_fields f
  JOIN expected_intake_fields ef ON f.id = ef.id
  WHERE f.site_id = 'd1111111-1111-1111-1111-111111111111'::uuid
    AND f.service_id = ef.service_id
    AND f.slug = ef.slug
    AND f.label = ef.label
    AND f.field_type = ef.field_type
    AND f.is_required = ef.is_required
    AND f.min_length = ef.min_length
    AND f.max_length = ef.max_length
    AND (f.min_value IS NOT DISTINCT FROM ef.min_value)
    AND (f.max_value IS NOT DISTINCT FROM ef.max_value)
    AND f.min_selections = ef.min_selections
    AND f.max_selections = ef.max_selections
    AND f.is_active = true;

  IF v_actual_count <> v_expected_count THEN
    RAISE EXCEPTION 'Flow alignment failed: expected % intake fields matching the exact contract, found %', v_expected_count, v_actual_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.booking_service_intake_fields f
    WHERE f.site_id = 'd1111111-1111-1111-1111-111111111111'::uuid
      AND f.service_id IN (SELECT service_id FROM expected_intake_fields)
      AND f.id NOT IN (SELECT id FROM expected_intake_fields)
  ) THEN
    RAISE EXCEPTION 'Flow alignment failed: unexpected intake fields exist for the active services';
  END IF;

  -- Option groups
  WITH expected_groups AS (
    SELECT * FROM (VALUES
      ('d7111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'dog-size', 'A kutya mérete', 'single', true, 1, 1, 0),
      ('d7111111-1111-1111-1111-111111111112'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'add-ons', 'Kiegészítő kezelések', 'multiple', false, 0, 3, 1),
      ('d7111111-1111-1111-1111-111111111113'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'coat-condition', 'Szőrzet állapota', 'single', true, 1, 1, 2),
      ('d7111111-1111-1111-1111-111111111114'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'desired-result', 'Kívánt eredmény', 'single', true, 1, 1, 3),
      ('d8111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'dog-size', 'A kutya mérete', 'single', true, 1, 1, 0),
      ('d8111111-1111-1111-1111-111111111112'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'add-ons', 'Kiegészítő kezelések', 'multiple', false, 0, 3, 1),
      ('d8111111-1111-1111-1111-111111111113'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'coat-condition', 'Szőrzet állapota', 'single', true, 1, 1, 2),
      ('d8111111-1111-1111-1111-111111111114'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'desired-result', 'Kívánt eredmény', 'single', true, 1, 1, 3),
      ('d9111111-1111-1111-1111-111111111111'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'dog-size', 'A kutya mérete', 'single', true, 1, 1, 0),
      ('d9111111-1111-1111-1111-111111111112'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'coat-condition', 'Szőrzet állapota', 'single', true, 1, 1, 1),
      ('d9111111-1111-1111-1111-111111111113'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'desired-result', 'Kívánt eredmény', 'single', true, 1, 1, 2),
      ('d9111111-1111-1111-1111-111111111114'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'add-ons', 'Kiegészítő kezelések', 'multiple', false, 0, 3, 3)
    ) AS t(id, service_id, slug, label, selection_mode, is_required, min_selections, max_selections, sort_order)
  ),
  actual_groups AS (
    SELECT id, service_id, slug, label, selection_mode, is_required, min_selections, max_selections, sort_order
    FROM public.booking_service_option_groups
    WHERE site_id = 'd1111111-1111-1111-1111-111111111111'::uuid
      AND is_active = true
  )
  SELECT count(*) INTO v_actual_count
  FROM (
    (SELECT * FROM expected_groups EXCEPT SELECT * FROM actual_groups)
    UNION ALL
    (SELECT * FROM actual_groups EXCEPT SELECT * FROM expected_groups)
  ) AS mismatch;

  IF v_actual_count <> 0 THEN
    RAISE EXCEPTION 'Flow alignment failed: option group contract mismatch (%)', v_actual_count;
  END IF;

  -- Options (only active groups seeded above)
  WITH expected_options AS (
    SELECT * FROM (VALUES
      ('d7111111-1111-1111-1111-111111111121'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111111'::uuid, 'small', 'Kistestű, 0–10 kg', 0, 0, 0, 0, 0),
      ('d7111111-1111-1111-1111-111111111122'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111111'::uuid, 'medium', 'Közepes, 11–25 kg', 3000, 4000, 15, 30, 1),
      ('d7111111-1111-1111-1111-111111111123'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111111'::uuid, 'large', 'Nagytestű, 26–40 kg', 6000, 8000, 30, 45, 2),
      ('d7111111-1111-1111-1111-111111111124'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111111'::uuid, 'extra-large', 'Óriástestű, 40 kg felett', 9000, 12000, 45, 60, 3),
      ('d7111111-1111-1111-1111-111111111131'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111112'::uuid, 'deshedding', 'Aljszőrkiszedés', 3000, 5000, 15, 30, 0),
      ('d7111111-1111-1111-1111-111111111132'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111112'::uuid, 'teeth-cleaning', 'Fogtisztítás', 2500, 2500, 10, 10, 1),
      ('d7111111-1111-1111-1111-111111111133'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111112'::uuid, 'paw-care', 'Mancsápolás', 2000, 2000, 10, 10, 2),
      ('d7111111-1111-1111-1111-111111111151'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111113'::uuid, 'maintained', 'Rendszeresen ápolt', 0, 0, 0, 0, 0),
      ('d7111111-1111-1111-1111-111111111152'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111113'::uuid, 'slightly-matted', 'Kissé csomós', 2000, 3000, 20, 20, 1),
      ('d7111111-1111-1111-1111-111111111153'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111113'::uuid, 'heavily-matted', 'Erősen csomós vagy filces', 5000, 8000, 40, 60, 2),
      ('d7111111-1111-1111-1111-111111111154'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111113'::uuid, 'unknown', 'Nem tudom megítélni', 0, 3000, 0, 20, 3),
      ('d7111111-1111-1111-1111-111111111161'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111114'::uuid, 'light-trim', 'Csak egy kis igazítás', 0, 0, 0, 0, 0),
      ('d7111111-1111-1111-1111-111111111162'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111114'::uuid, 'short-manageable', 'Rövidebb, könnyen kezelhető', 0, 0, 0, 0, 1),
      ('d7111111-1111-1111-1111-111111111163'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111114'::uuid, 'breed-standard', 'Fajtának megfelelő fazon', 2000, 3000, 15, 30, 2),
      ('d7111111-1111-1111-1111-111111111164'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111114'::uuid, 'groomer-choice', 'Rábízom a kozmetikusra', 0, 2000, 0, 15, 3),
      ('d8111111-1111-1111-1111-111111111121'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111111'::uuid, 'small', 'Kistestű, 0–10 kg', 0, 0, 0, 0, 0),
      ('d8111111-1111-1111-1111-111111111122'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111111'::uuid, 'medium', 'Közepes, 11–25 kg', 3000, 4000, 15, 30, 1),
      ('d8111111-1111-1111-1111-111111111123'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111111'::uuid, 'large', 'Nagytestű, 26–40 kg', 6000, 8000, 30, 45, 2),
      ('d8111111-1111-1111-1111-111111111124'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111111'::uuid, 'extra-large', 'Óriástestű, 40 kg felett', 9000, 12000, 45, 60, 3),
      ('d8111111-1111-1111-1111-111111111131'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111112'::uuid, 'deshedding', 'Aljszőrkiszedés', 3000, 5000, 15, 30, 0),
      ('d8111111-1111-1111-1111-111111111132'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111112'::uuid, 'teeth-cleaning', 'Fogtisztítás', 2500, 2500, 10, 10, 1),
      ('d8111111-1111-1111-1111-111111111133'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111112'::uuid, 'paw-care', 'Mancsápolás', 2000, 2000, 10, 10, 2),
      ('d8111111-1111-1111-1111-111111111151'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111113'::uuid, 'maintained', 'Rendszeresen ápolt', 0, 0, 0, 0, 0),
      ('d8111111-1111-1111-1111-111111111152'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111113'::uuid, 'slightly-matted', 'Kissé csomós', 2000, 3000, 20, 20, 1),
      ('d8111111-1111-1111-1111-111111111153'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111113'::uuid, 'heavily-matted', 'Erősen csomós vagy filces', 5000, 8000, 40, 60, 2),
      ('d8111111-1111-1111-1111-111111111154'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111113'::uuid, 'unknown', 'Nem tudom megítélni', 0, 3000, 0, 20, 3),
      ('d8111111-1111-1111-1111-111111111161'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111114'::uuid, 'light-trim', 'Csak egy kis igazítás', 0, 0, 0, 0, 0),
      ('d8111111-1111-1111-1111-111111111162'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111114'::uuid, 'short-manageable', 'Rövidebb, könnyen kezelhető', 0, 0, 0, 0, 1),
      ('d8111111-1111-1111-1111-111111111163'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111114'::uuid, 'breed-standard', 'Fajtának megfelelő fazon', 2000, 3000, 15, 30, 2),
      ('d8111111-1111-1111-1111-111111111164'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111114'::uuid, 'groomer-choice', 'Rábízom a kozmetikusra', 0, 2000, 0, 15, 3),
      ('d9111111-1111-1111-1111-111111111121'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111111'::uuid, 'small', 'Kistestű, 0–10 kg', 0, 0, 0, 0, 0),
      ('d9111111-1111-1111-1111-111111111122'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111111'::uuid, 'medium', 'Közepes, 11–25 kg', 3000, 4000, 15, 30, 1),
      ('d9111111-1111-1111-1111-111111111123'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111111'::uuid, 'large', 'Nagytestű, 26–40 kg', 6000, 8000, 30, 45, 2),
      ('d9111111-1111-1111-1111-111111111124'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111111'::uuid, 'extra-large', 'Óriástestű, 40 kg felett', 9000, 12000, 45, 60, 3),
      ('d9111111-1111-1111-1111-111111111151'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111112'::uuid, 'maintained', 'Rendszeresen ápolt', 0, 0, 0, 0, 0),
      ('d9111111-1111-1111-1111-111111111152'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111112'::uuid, 'slightly-matted', 'Kissé csomós', 2000, 3000, 20, 20, 1),
      ('d9111111-1111-1111-1111-111111111153'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111112'::uuid, 'heavily-matted', 'Erősen csomós vagy filces', 5000, 8000, 40, 60, 2),
      ('d9111111-1111-1111-1111-111111111154'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111112'::uuid, 'unknown', 'Nem tudom megítélni', 0, 3000, 0, 20, 3),
      ('d9111111-1111-1111-1111-111111111161'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111113'::uuid, 'light-trim', 'Csak egy kis igazítás', 0, 0, 0, 0, 0),
      ('d9111111-1111-1111-1111-111111111162'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111113'::uuid, 'short-manageable', 'Rövidebb, könnyen kezelhető', 0, 0, 0, 0, 1),
      ('d9111111-1111-1111-1111-111111111163'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111113'::uuid, 'breed-standard', 'Fajtának megfelelő fazon', 2000, 3000, 15, 30, 2),
      ('d9111111-1111-1111-1111-111111111164'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111113'::uuid, 'groomer-choice', 'Rábízom a kozmetikusra', 0, 2000, 0, 15, 3),
      ('d9111111-1111-1111-1111-111111111131'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111114'::uuid, 'deshedding', 'Aljszőrkiszedés', 3000, 5000, 15, 30, 0),
      ('d9111111-1111-1111-1111-111111111132'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111114'::uuid, 'teeth-cleaning', 'Fogtisztítás', 2500, 2500, 10, 10, 1),
      ('d9111111-1111-1111-1111-111111111133'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'd9111111-1111-1111-1111-111111111114'::uuid, 'paw-care', 'Mancsápolás', 2000, 2000, 10, 10, 2)
    ) AS t(id, service_id, option_group_id, slug, label, price_delta_minor, price_delta_max_minor, duration_delta_minutes, duration_delta_max_minutes, sort_order)
  ),
  actual_options AS (
    SELECT id, service_id, option_group_id, slug, label, price_delta_minor, price_delta_max_minor, duration_delta_minutes, duration_delta_max_minutes, sort_order
    FROM public.booking_service_options
    WHERE site_id = 'd1111111-1111-1111-1111-111111111111'::uuid
      AND is_active = true
      AND option_group_id IN (
        SELECT DISTINCT option_group_id FROM expected_options
      )
  )
  SELECT count(*) INTO v_actual_count
  FROM (
    (SELECT * FROM expected_options EXCEPT SELECT * FROM actual_options)
    UNION ALL
    (SELECT * FROM actual_options EXCEPT SELECT * FROM expected_options)
  ) AS mismatch;

  IF v_actual_count <> 0 THEN
    RAISE EXCEPTION 'Flow alignment failed: option contract mismatch (%)', v_actual_count;
  END IF;

  -- Intake field choice options
  WITH expected_intake_options AS (
    SELECT * FROM (VALUES
      ('e3333333-3333-3333-3333-333333333351'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'e3333333-3333-3333-3333-333333333335'::uuid, 'puppy', 'Kölyök, 0–12 hó', 0),
      ('e3333333-3333-3333-3333-333333333352'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'e3333333-3333-3333-3333-333333333335'::uuid, 'adult', 'Felnőtt, 1–7 év', 1),
      ('e3333333-3333-3333-3333-333333333353'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'e3333333-3333-3333-3333-333333333335'::uuid, 'senior', 'Senior, 7+ év', 2),
      ('e3333333-3333-3333-3333-333333333361'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'e3333333-3333-3333-3333-333333333336'::uuid, 'first-groom', 'Első kozmetikálás', 0),
      ('e3333333-3333-3333-3333-333333333362'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'e3333333-3333-3333-3333-333333333336'::uuid, 'anxious', 'Szorongó', 1),
      ('e3333333-3333-3333-3333-333333333363'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'e3333333-3333-3333-3333-333333333336'::uuid, 'sensitive-skin', 'Érzékeny bőr', 2),
      ('e3333333-3333-3333-3333-333333333364'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'e3333333-3333-3333-3333-333333333336'::uuid, 'allergy', 'Allergia', 3),
      ('e3333333-3333-3333-3333-333333333365'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'e3333333-3333-3333-3333-333333333336'::uuid, 'puppy-or-senior', 'Kölyök vagy senior', 4),
      ('e4444444-4444-4444-4444-444444444451'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'e4444444-4444-4444-4444-444444444445'::uuid, 'puppy', 'Kölyök, 0–12 hó', 0),
      ('e4444444-4444-4444-4444-444444444452'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'e4444444-4444-4444-4444-444444444445'::uuid, 'adult', 'Felnőtt, 1–7 év', 1),
      ('e4444444-4444-4444-4444-444444444453'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'e4444444-4444-4444-4444-444444444445'::uuid, 'senior', 'Senior, 7+ év', 2),
      ('e4444444-4444-4444-4444-444444444461'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'e4444444-4444-4444-4444-444444444446'::uuid, 'first-groom', 'Első kozmetikálás', 0),
      ('e4444444-4444-4444-4444-444444444462'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'e4444444-4444-4444-4444-444444444446'::uuid, 'anxious', 'Szorongó', 1),
      ('e4444444-4444-4444-4444-444444444463'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'e4444444-4444-4444-4444-444444444446'::uuid, 'sensitive-skin', 'Érzékeny bőr', 2),
      ('e4444444-4444-4444-4444-444444444464'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'e4444444-4444-4444-4444-444444444446'::uuid, 'allergy', 'Allergia', 3),
      ('e4444444-4444-4444-4444-444444444465'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'e4444444-4444-4444-4444-444444444446'::uuid, 'puppy-or-senior', 'Kölyök vagy senior', 4),
      ('e7777777-7777-7777-7777-777777777751'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'e7777777-7777-7777-7777-777777777775'::uuid, 'puppy', 'Kölyök, 0–12 hó', 0),
      ('e7777777-7777-7777-7777-777777777752'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'e7777777-7777-7777-7777-777777777775'::uuid, 'adult', 'Felnőtt, 1–7 év', 1),
      ('e7777777-7777-7777-7777-777777777753'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'e7777777-7777-7777-7777-777777777775'::uuid, 'senior', 'Senior, 7+ év', 2),
      ('e7777777-7777-7777-7777-777777777761'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'e7777777-7777-7777-7777-777777777776'::uuid, 'first-groom', 'Első kozmetikálás', 0),
      ('e7777777-7777-7777-7777-777777777762'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'e7777777-7777-7777-7777-777777777776'::uuid, 'anxious', 'Szorongó', 1),
      ('e7777777-7777-7777-7777-777777777763'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'e7777777-7777-7777-7777-777777777776'::uuid, 'sensitive-skin', 'Érzékeny bőr', 2),
      ('e7777777-7777-7777-7777-777777777764'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'e7777777-7777-7777-7777-777777777776'::uuid, 'allergy', 'Allergia', 3),
      ('e7777777-7777-7777-7777-777777777765'::uuid, 'd7777777-7777-7777-7777-777777777777'::uuid, 'e7777777-7777-7777-7777-777777777776'::uuid, 'puppy-or-senior', 'Kölyök vagy senior', 4)
    ) AS t(id, service_id, intake_field_id, slug, label, sort_order)
  ),
  actual_intake_options AS (
    SELECT id, service_id, intake_field_id, slug, label, sort_order
    FROM public.booking_service_intake_field_options
    WHERE site_id = 'd1111111-1111-1111-1111-111111111111'::uuid
      AND is_active = true
  )
  SELECT count(*) INTO v_actual_count
  FROM (
    (SELECT * FROM expected_intake_options EXCEPT SELECT * FROM actual_intake_options)
    UNION ALL
    (SELECT * FROM actual_intake_options EXCEPT SELECT * FROM expected_intake_options)
  ) AS mismatch;

  IF v_actual_count <> 0 THEN
    RAISE EXCEPTION 'Flow alignment failed: intake field option contract mismatch (%)', v_actual_count;
  END IF;
END;
$$;

-- ----------------------------------------------------------------
-- 10. Schema grant
-- ----------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO service_role;

COMMIT;
