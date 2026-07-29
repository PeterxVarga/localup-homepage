-- ============================================================
-- Configurable booking intake foundation
--
-- Adds per-service intake field configuration so that services can
-- request extra, server-validated information from the customer.
--
-- Rules:
--   * The client never defines the intake contract; the service does.
--   * Only configured, active field slugs are accepted.
--   * Field values are always strings, trimmed server-side, and length-limited.
--   * Required fields must have min_length >= 1; optional fields keep
--     min_length = 0.
--   * This slice seeds the bundas-demo dog grooming tenant with two
--     intake fields per service.
--
-- Security:
--   * RLS enabled, no public policies.
--   * service_role only.
--
-- This is a normal, one-time, additive Supabase migration.
-- Do not apply directly to production.
-- ============================================================

BEGIN;

-- ----------------------------------------------------------------
-- 1. Intake field configuration table
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.booking_service_intake_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  service_id uuid NOT NULL,
  slug text NOT NULL,
  label text NOT NULL,
  field_type text NOT NULL,
  is_required boolean NOT NULL DEFAULT false,
  min_length integer NOT NULL DEFAULT 0,
  max_length integer NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT booking_service_intake_fields_field_type_check
    CHECK (field_type IN ('text', 'textarea')),
  CONSTRAINT booking_service_intake_fields_slug_not_empty_check
    CHECK (length(trim(slug)) > 0),
  CONSTRAINT booking_service_intake_fields_slug_format_check
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT booking_service_intake_fields_label_not_empty_check
    CHECK (length(trim(label)) > 0),
  CONSTRAINT booking_service_intake_fields_min_length_nonneg_check
    CHECK (min_length >= 0),
  CONSTRAINT booking_service_intake_fields_max_length_range_check
    CHECK (max_length BETWEEN 1 AND 2000),
  CONSTRAINT booking_service_intake_fields_min_max_length_check
    CHECK (min_length <= max_length),
  CONSTRAINT booking_service_intake_fields_required_min_length_check
    CHECK (NOT is_required OR min_length >= 1),
  CONSTRAINT booking_service_intake_fields_optional_min_length_check
    CHECK (is_required OR min_length = 0),
  CONSTRAINT booking_service_intake_fields_sort_order_nonneg_check
    CHECK (sort_order >= 0),

  CONSTRAINT booking_service_intake_fields_service_site_fk
    FOREIGN KEY (service_id, site_id)
      REFERENCES public.booking_services(id, site_id)
      ON DELETE CASCADE,

  UNIQUE (service_id, slug),
  UNIQUE (id, service_id, site_id)
);

CREATE INDEX IF NOT EXISTS idx_booking_service_intake_fields_service_site_fk
  ON public.booking_service_intake_fields (service_id, site_id);

CREATE INDEX IF NOT EXISTS idx_booking_service_intake_fields_service_active_sort
  ON public.booking_service_intake_fields (service_id, is_active, sort_order);

ALTER TABLE public.booking_service_intake_fields ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.booking_service_intake_fields
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.booking_service_intake_fields TO service_role;

DROP TRIGGER IF EXISTS booking_service_intake_fields_touch
  ON public.booking_service_intake_fields;
CREATE TRIGGER booking_service_intake_fields_touch
  BEFORE UPDATE ON public.booking_service_intake_fields
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ----------------------------------------------------------------
-- 2. Pre-condition: bundas-demo site and services must exist exactly
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
    RAISE EXCEPTION 'Intake seed failed: bundas-demo site is missing or has non-matching values';
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
      RAISE EXCEPTION 'Intake seed failed: expected service %/% is missing or has non-matching slug', service_check.id, service_check.slug;
    END IF;
  END LOOP;
END;
$$;

-- ----------------------------------------------------------------
-- 3. Seed bundas-demo intake fields
-- ----------------------------------------------------------------
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
  sort_order,
  is_active
) VALUES
  -- full-grooming
  ('e3333333-3333-3333-3333-333333333331'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'dog-breed', 'Kutyafajta', 'text', true, 2, 100, 0, true),
  ('e3333333-3333-3333-3333-333333333332'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'temperament-notes', 'Temperamentum és különleges tudnivalók', 'textarea', false, 0, 1000, 1, true),
  -- bath-and-brush
  ('e4444444-4444-4444-4444-444444444441'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'dog-breed', 'Kutyafajta', 'text', true, 2, 100, 0, true),
  ('e4444444-4444-4444-4444-444444444442'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'temperament-notes', 'Temperamentum és különleges tudnivalók', 'textarea', false, 0, 1000, 1, true),
  -- nail-trimming
  ('e5555555-5555-5555-5555-555555555551'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd5555555-5555-5555-5555-555555555555'::uuid, 'dog-breed', 'Kutyafajta', 'text', true, 2, 100, 0, true),
  ('e5555555-5555-5555-5555-555555555552'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd5555555-5555-5555-5555-555555555555'::uuid, 'temperament-notes', 'Temperamentum és különleges tudnivalók', 'textarea', false, 0, 1000, 1, true),
  -- puppy-first-groom
  ('e6666666-6666-6666-6666-666666666661'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd6666666-6666-6666-6666-666666666666'::uuid, 'dog-breed', 'Kutyafajta', 'text', true, 2, 100, 0, true),
  ('e6666666-6666-6666-6666-666666666662'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd6666666-6666-6666-6666-666666666666'::uuid, 'temperament-notes', 'Temperamentum és különleges tudnivalók', 'textarea', false, 0, 1000, 1, true)
ON CONFLICT (service_id, slug) DO NOTHING;

-- ----------------------------------------------------------------
-- 4. Exact contract post-check
-- ----------------------------------------------------------------
DO $$
DECLARE
  v_expected_count int;
  v_actual_count int;
BEGIN
  CREATE TEMP TABLE expected_fields (
    id uuid PRIMARY KEY,
    service_id uuid NOT NULL,
    slug text NOT NULL,
    label text NOT NULL,
    field_type text NOT NULL,
    is_required boolean NOT NULL,
    min_length int NOT NULL,
    max_length int NOT NULL,
    sort_order int NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO expected_fields
    (id, service_id, slug, label, field_type, is_required, min_length, max_length, sort_order)
  VALUES
    ('e3333333-3333-3333-3333-333333333331'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'dog-breed', 'Kutyafajta', 'text', true, 2, 100, 0),
    ('e3333333-3333-3333-3333-333333333332'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'temperament-notes', 'Temperamentum és különleges tudnivalók', 'textarea', false, 0, 1000, 1),
    ('e4444444-4444-4444-4444-444444444441'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'dog-breed', 'Kutyafajta', 'text', true, 2, 100, 0),
    ('e4444444-4444-4444-4444-444444444442'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'temperament-notes', 'Temperamentum és különleges tudnivalók', 'textarea', false, 0, 1000, 1),
    ('e5555555-5555-5555-5555-555555555551'::uuid, 'd5555555-5555-5555-5555-555555555555'::uuid, 'dog-breed', 'Kutyafajta', 'text', true, 2, 100, 0),
    ('e5555555-5555-5555-5555-555555555552'::uuid, 'd5555555-5555-5555-5555-555555555555'::uuid, 'temperament-notes', 'Temperamentum és különleges tudnivalók', 'textarea', false, 0, 1000, 1),
    ('e6666666-6666-6666-6666-666666666661'::uuid, 'd6666666-6666-6666-6666-666666666666'::uuid, 'dog-breed', 'Kutyafajta', 'text', true, 2, 100, 0),
    ('e6666666-6666-6666-6666-666666666662'::uuid, 'd6666666-6666-6666-6666-666666666666'::uuid, 'temperament-notes', 'Temperamentum és különleges tudnivalók', 'textarea', false, 0, 1000, 1);

  SELECT count(*) INTO v_expected_count FROM expected_fields;

  SELECT count(*) INTO v_actual_count
  FROM public.booking_service_intake_fields f
  JOIN expected_fields ef ON f.id = ef.id
  WHERE f.site_id = 'd1111111-1111-1111-1111-111111111111'::uuid
    AND f.service_id = ef.service_id
    AND f.slug = ef.slug
    AND f.label = ef.label
    AND f.field_type = ef.field_type
    AND f.is_required = ef.is_required
    AND f.min_length = ef.min_length
    AND f.max_length = ef.max_length
    AND f.sort_order = ef.sort_order
    AND f.is_active = true;

  IF v_actual_count <> v_expected_count THEN
    RAISE EXCEPTION 'Intake seed failed: expected % fields matching the exact contract, found %', v_expected_count, v_actual_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.booking_service_intake_fields f
    WHERE f.site_id = 'd1111111-1111-1111-1111-111111111111'::uuid
      AND f.service_id IN (SELECT service_id FROM expected_fields)
      AND f.id NOT IN (SELECT id FROM expected_fields)
  ) THEN
    RAISE EXCEPTION 'Intake seed failed: unexpected intake fields exist for the seeded services';
  END IF;

  IF EXISTS (
    SELECT 1 FROM expected_fields ef
    LEFT JOIN public.booking_service_intake_fields f
      ON f.id = ef.id
      AND f.site_id = 'd1111111-1111-1111-1111-111111111111'::uuid
      AND f.service_id = ef.service_id
      AND f.slug = ef.slug
      AND f.label = ef.label
      AND f.field_type = ef.field_type
      AND f.is_required = ef.is_required
      AND f.min_length = ef.min_length
      AND f.max_length = ef.max_length
      AND f.sort_order = ef.sort_order
      AND f.is_active = true
    WHERE f.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Intake seed failed: one or more expected intake fields are missing or have non-matching values';
  END IF;
END;
$$;

-- ----------------------------------------------------------------
-- 5. Schema grant
-- ----------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO service_role;

COMMIT;
