-- ============================================================
-- Dog Grooming demo booking configuration seed
--
-- Additive, template-only seed for the existing configurable
-- range-pricing schema. Creates:
--   * a demo site (bundas-demo)
--   * a demo availability schedule
--   * 4 demo booking services with deterministic pricing/duration ranges
--   * per-service option groups (required dog-size, optional add-ons)
--
-- Rules:
--   * All pricing is stored as HUF minor units (1 Ft = 1 minor).
--   * estimated services carry real min/max ranges.
--   * fixed services have identical min/max values.
--   * public_booking_enabled is false for every service.
--   * No credentials (Calendar, OAuth, email, SMS) are seeded.
--   * The migration is idempotent and fail-closed: ON CONFLICT DO NOTHING
--     is followed by exact contract post-checks; mismatches raise.
--
-- This is a normal, one-time, additive Supabase migration.
-- Do not apply directly to production.
-- ============================================================

BEGIN;

-- ----------------------------------------------------------------
-- 1. Demo site
-- ----------------------------------------------------------------
INSERT INTO public.sites (
  id,
  slug,
  name,
  timezone,
  is_active
) VALUES (
  'd1111111-1111-1111-1111-111111111111'::uuid,
  'bundas-demo',
  'Bundás Kutyakozmetika',
  'Europe/Budapest',
  true
)
ON CONFLICT (slug) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sites
    WHERE id = 'd1111111-1111-1111-1111-111111111111'::uuid
      AND slug = 'bundas-demo'
      AND name = 'Bundás Kutyakozmetika'
      AND timezone = 'Europe/Budapest'
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Dog grooming seed failed: site contract mismatch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sites
    WHERE slug = 'bundas-demo'
      AND id <> 'd1111111-1111-1111-1111-111111111111'::uuid
  ) THEN
    RAISE EXCEPTION 'Dog grooming seed failed: another site already owns the bundas-demo slug';
  END IF;
END;
$$;

-- ----------------------------------------------------------------
-- 2. Demo availability schedule
-- ----------------------------------------------------------------
INSERT INTO public.availability_schedules (
  id,
  site_id,
  name,
  timezone,
  is_default,
  is_active,
  slot_duration_minutes,
  slot_interval_minutes,
  minimum_notice_minutes,
  booking_window_days,
  buffer_before_minutes,
  buffer_after_minutes
) VALUES (
  'd2222222-2222-2222-2222-222222222222'::uuid,
  'd1111111-1111-1111-1111-111111111111'::uuid,
  'Bundás Kutyakozmetika nyitvatartás',
  'Europe/Budapest',
  false,
  true,
  15,
  15,
  720,
  60,
  0,
  0
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.availability_schedules
    WHERE id = 'd2222222-2222-2222-2222-222222222222'::uuid
      AND site_id = 'd1111111-1111-1111-1111-111111111111'::uuid
      AND name = 'Bundás Kutyakozmetika nyitvatartás'
      AND timezone = 'Europe/Budapest'
      AND is_default = false
      AND is_active = true
      AND slot_duration_minutes = 15
      AND slot_interval_minutes = 15
      AND minimum_notice_minutes = 720
      AND booking_window_days = 60
      AND buffer_before_minutes = 0
      AND buffer_after_minutes = 0
  ) THEN
    RAISE EXCEPTION 'Dog grooming seed failed: schedule contract mismatch';
  END IF;
END;
$$;

-- ----------------------------------------------------------------
-- 3. Weekly rules
-- ----------------------------------------------------------------
INSERT INTO public.availability_weekly_rules
  (schedule_id, weekday, start_time, end_time, sort_order)
SELECT
  'd2222222-2222-2222-2222-222222222222'::uuid,
  weekday,
  start_time,
  end_time,
  sort_order
FROM (VALUES
  (0, '09:00'::time, '18:00'::time, 0),
  (1, '09:00'::time, '18:00'::time, 0),
  (2, '09:00'::time, '18:00'::time, 0),
  (3, '09:00'::time, '18:00'::time, 0),
  (4, '09:00'::time, '18:00'::time, 0),
  (5, '09:00'::time, '14:00'::time, 0)
) AS t(weekday, start_time, end_time, sort_order)
WHERE EXISTS (
  SELECT 1 FROM public.availability_schedules
  WHERE id = 'd2222222-2222-2222-2222-222222222222'::uuid
)
ON CONFLICT (schedule_id, weekday, start_time, end_time) DO NOTHING;

DO $$
DECLARE
  v_expected_count int;
  v_actual_count int;
BEGIN
  CREATE TEMP TABLE expected_rules (
    weekday int NOT NULL,
    start_time time NOT NULL,
    end_time time NOT NULL,
    sort_order int NOT NULL,
    PRIMARY KEY (weekday, start_time, end_time, sort_order)
  ) ON COMMIT DROP;

  INSERT INTO expected_rules (weekday, start_time, end_time, sort_order) VALUES
    (0, '09:00'::time, '18:00'::time, 0),
    (1, '09:00'::time, '18:00'::time, 0),
    (2, '09:00'::time, '18:00'::time, 0),
    (3, '09:00'::time, '18:00'::time, 0),
    (4, '09:00'::time, '18:00'::time, 0),
    (5, '09:00'::time, '14:00'::time, 0);

  SELECT count(*) INTO v_expected_count FROM expected_rules;

  SELECT count(*) INTO v_actual_count
  FROM public.availability_weekly_rules
  WHERE schedule_id = 'd2222222-2222-2222-2222-222222222222'::uuid;

  IF v_actual_count <> v_expected_count THEN
    RAISE EXCEPTION 'Dog grooming seed failed: expected % weekly rules, found %', v_expected_count, v_actual_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM expected_rules er
    LEFT JOIN public.availability_weekly_rules ar
      ON ar.schedule_id = 'd2222222-2222-2222-2222-222222222222'::uuid
      AND ar.weekday = er.weekday
      AND ar.start_time = er.start_time
      AND ar.end_time = er.end_time
      AND ar.sort_order = er.sort_order
    WHERE ar.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Dog grooming seed failed: one or more expected weekly rules are missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.availability_weekly_rules ar
    LEFT JOIN expected_rules er
      ON ar.weekday = er.weekday
      AND ar.start_time = er.start_time
      AND ar.end_time = er.end_time
      AND ar.sort_order = er.sort_order
    WHERE ar.schedule_id = 'd2222222-2222-2222-2222-222222222222'::uuid
      AND er.weekday IS NULL
  ) THEN
    RAISE EXCEPTION 'Dog grooming seed failed: one or more unexpected weekly rules exist';
  END IF;
END;
$$;

-- ----------------------------------------------------------------
-- 4. Demo booking services
-- ----------------------------------------------------------------
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
) VALUES
  (
    'd3333333-3333-3333-3333-333333333333'::uuid,
    'd1111111-1111-1111-1111-111111111111'::uuid,
    'd2222222-2222-2222-2222-222222222222'::uuid,
    'full-grooming',
    'Teljes kozmetika',
    60,
    90,
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
    11900,
    14900,
    'HUF'
  ),
  (
    'd4444444-4444-4444-4444-444444444444'::uuid,
    'd1111111-1111-1111-1111-111111111111'::uuid,
    'd2222222-2222-2222-2222-222222222222'::uuid,
    'bath-and-brush',
    'Fürdetés és kefélés',
    45,
    60,
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
    7900,
    9900,
    'HUF'
  ),
  (
    'd5555555-5555-5555-5555-555555555555'::uuid,
    'd1111111-1111-1111-1111-111111111111'::uuid,
    'd2222222-2222-2222-2222-222222222222'::uuid,
    'nail-trimming',
    'Karomvágás',
    15,
    15,
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
    'fixed',
    3500,
    3500,
    'HUF'
  ),
  (
    'd6666666-6666-6666-6666-666666666666'::uuid,
    'd1111111-1111-1111-1111-111111111111'::uuid,
    'd2222222-2222-2222-2222-222222222222'::uuid,
    'puppy-first-groom',
    'Első kölyökkozmetika',
    45,
    45,
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
    'fixed',
    6900,
    6900,
    'HUF'
  )
ON CONFLICT (site_id, slug) DO NOTHING;

DO $$
DECLARE
  v_expected_count int;
  v_actual_count int;
BEGIN
  CREATE TEMP TABLE expected_services (
    id uuid PRIMARY KEY,
    slug text NOT NULL,
    name text NOT NULL,
    duration_minutes int NOT NULL,
    max_duration_minutes int,
    pricing_mode text NOT NULL,
    base_price_minor int,
    base_price_max_minor int,
    currency text NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO expected_services
    (id, slug, name, duration_minutes, max_duration_minutes, pricing_mode, base_price_minor, base_price_max_minor, currency)
  VALUES
    ('d3333333-3333-3333-3333-333333333333'::uuid, 'full-grooming', 'Teljes kozmetika', 60, 90, 'estimated', 11900, 14900, 'HUF'),
    ('d4444444-4444-4444-4444-444444444444'::uuid, 'bath-and-brush', 'Fürdetés és kefélés', 45, 60, 'estimated', 7900, 9900, 'HUF'),
    ('d5555555-5555-5555-5555-555555555555'::uuid, 'nail-trimming', 'Karomvágás', 15, 15, 'fixed', 3500, 3500, 'HUF'),
    ('d6666666-6666-6666-6666-666666666666'::uuid, 'puppy-first-groom', 'Első kölyökkozmetika', 45, 45, 'fixed', 6900, 6900, 'HUF');

  SELECT count(*) INTO v_expected_count FROM expected_services;

  SELECT count(*) INTO v_actual_count
  FROM public.booking_services bs
  JOIN expected_services es ON bs.id = es.id
  WHERE bs.site_id = 'd1111111-1111-1111-1111-111111111111'::uuid
    AND bs.schedule_id = 'd2222222-2222-2222-2222-222222222222'::uuid
    AND bs.slug = es.slug
    AND bs.name = es.name
    AND bs.duration_minutes = es.duration_minutes
    AND (bs.max_duration_minutes IS NOT DISTINCT FROM es.max_duration_minutes)
    AND bs.slot_interval_minutes = 15
    AND bs.minimum_notice_minutes = 720
    AND bs.booking_window_days = 60
    AND bs.buffer_before_minutes = 0
    AND bs.buffer_after_minutes = 0
    AND bs.cancel_cutoff_hours = 12
    AND bs.reschedule_cutoff_hours = 12
    AND bs.max_reschedules = 2
    AND bs.public_booking_enabled = false
    AND bs.is_active = true
    AND bs.pricing_mode = es.pricing_mode
    AND (bs.base_price_minor IS NOT DISTINCT FROM es.base_price_minor)
    AND (bs.base_price_max_minor IS NOT DISTINCT FROM es.base_price_max_minor)
    AND bs.currency = es.currency;

  IF v_actual_count <> v_expected_count THEN
    RAISE EXCEPTION 'Dog grooming seed failed: expected % services matching the exact contract, found %', v_expected_count, v_actual_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.booking_services
    WHERE slug IN (SELECT slug FROM expected_services)
      AND site_id = 'd1111111-1111-1111-1111-111111111111'::uuid
      AND id NOT IN (SELECT id FROM expected_services)
  ) THEN
    RAISE EXCEPTION 'Dog grooming seed failed: one or more expected service slugs already exist with different IDs';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.booking_services bs
    WHERE bs.id IN (SELECT id FROM expected_services)
      AND bs.site_id = 'd1111111-1111-1111-1111-111111111111'::uuid
      AND bs.id NOT IN (
        SELECT bs2.id FROM public.booking_services bs2
        JOIN expected_services es2 ON bs2.id = es2.id
        WHERE bs2.site_id = 'd1111111-1111-1111-1111-111111111111'::uuid
          AND bs2.schedule_id = 'd2222222-2222-2222-2222-222222222222'::uuid
          AND bs2.slug = es2.slug
          AND bs2.name = es2.name
          AND bs2.duration_minutes = es2.duration_minutes
          AND (bs2.max_duration_minutes IS NOT DISTINCT FROM es2.max_duration_minutes)
          AND bs2.slot_interval_minutes = 15
          AND bs2.minimum_notice_minutes = 720
          AND bs2.booking_window_days = 60
          AND bs2.buffer_before_minutes = 0
          AND bs2.buffer_after_minutes = 0
          AND bs2.cancel_cutoff_hours = 12
          AND bs2.reschedule_cutoff_hours = 12
          AND bs2.max_reschedules = 2
          AND bs2.public_booking_enabled = false
          AND bs2.is_active = true
          AND bs2.pricing_mode = es2.pricing_mode
          AND (bs2.base_price_minor IS NOT DISTINCT FROM es2.base_price_minor)
          AND (bs2.base_price_max_minor IS NOT DISTINCT FROM es2.base_price_max_minor)
          AND bs2.currency = es2.currency
      )
  ) THEN
    RAISE EXCEPTION 'Dog grooming seed failed: one or more expected service IDs exist with non-matching values';
  END IF;
END;
$$;

-- ----------------------------------------------------------------
-- 5. Demo option groups
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
  ('d7111111-1111-1111-1111-111111111111'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'dog-size', 'A kutya mérete', 'single', true, 1, 1, 0, true),
  ('d7111111-1111-1111-1111-111111111112'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'add-ons', 'Kiegészítő kezelések', 'multiple', false, 0, 3, 1, true),
  -- bath-and-brush
  ('d8111111-1111-1111-1111-111111111111'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'dog-size', 'A kutya mérete', 'single', true, 1, 1, 0, true),
  ('d8111111-1111-1111-1111-111111111112'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'add-ons', 'Kiegészítő kezelések', 'multiple', false, 0, 3, 1, true)
ON CONFLICT (service_id, slug) DO NOTHING;

DO $$
DECLARE
  v_expected_count int;
  v_actual_count int;
BEGIN
  CREATE TEMP TABLE expected_groups (
    id uuid PRIMARY KEY,
    service_id uuid NOT NULL,
    slug text NOT NULL,
    label text NOT NULL,
    selection_mode text NOT NULL,
    is_required boolean NOT NULL,
    min_selections int NOT NULL,
    max_selections int NOT NULL,
    sort_order int NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO expected_groups
    (id, service_id, slug, label, selection_mode, is_required, min_selections, max_selections, sort_order)
  VALUES
    ('d7111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'dog-size', 'A kutya mérete', 'single', true, 1, 1, 0),
    ('d7111111-1111-1111-1111-111111111112'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'add-ons', 'Kiegészítő kezelések', 'multiple', false, 0, 3, 1),
    ('d8111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'dog-size', 'A kutya mérete', 'single', true, 1, 1, 0),
    ('d8111111-1111-1111-1111-111111111112'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'add-ons', 'Kiegészítő kezelések', 'multiple', false, 0, 3, 1);

  SELECT count(*) INTO v_expected_count FROM expected_groups;

  SELECT count(*) INTO v_actual_count
  FROM public.booking_service_option_groups g
  JOIN expected_groups eg ON g.id = eg.id
  WHERE g.site_id = 'd1111111-1111-1111-1111-111111111111'::uuid
    AND g.service_id = eg.service_id
    AND g.slug = eg.slug
    AND g.label = eg.label
    AND g.selection_mode = eg.selection_mode
    AND g.is_required = eg.is_required
    AND g.min_selections = eg.min_selections
    AND g.max_selections = eg.max_selections
    AND g.sort_order = eg.sort_order
    AND g.is_active = true;

  IF v_actual_count <> v_expected_count THEN
    RAISE EXCEPTION 'Dog grooming seed failed: expected % option groups matching the exact contract, found %', v_expected_count, v_actual_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.booking_service_option_groups g
    WHERE g.service_id IN (SELECT service_id FROM expected_groups)
      AND g.site_id = 'd1111111-1111-1111-1111-111111111111'::uuid
      AND g.id NOT IN (SELECT id FROM expected_groups)
  ) THEN
    RAISE EXCEPTION 'Dog grooming seed failed: unexpected option groups exist for the seeded services';
  END IF;

  IF EXISTS (
    SELECT 1 FROM expected_groups eg
    LEFT JOIN public.booking_service_option_groups g
      ON g.id = eg.id
      AND g.site_id = 'd1111111-1111-1111-1111-111111111111'::uuid
      AND g.service_id = eg.service_id
      AND g.slug = eg.slug
      AND g.label = eg.label
      AND g.selection_mode = eg.selection_mode
      AND g.is_required = eg.is_required
      AND g.min_selections = eg.min_selections
      AND g.max_selections = eg.max_selections
      AND g.sort_order = eg.sort_order
      AND g.is_active = true
    WHERE g.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Dog grooming seed failed: one or more expected option groups are missing or have non-matching values';
  END IF;
END;
$$;

-- ----------------------------------------------------------------
-- 6. Demo options
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
  -- full-grooming dog-size
  ('d7111111-1111-1111-1111-111111111121'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111111'::uuid, 'small', 'Kistestű, 0–10 kg', 0, 0, 0, 0, 0, true),
  ('d7111111-1111-1111-1111-111111111122'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111111'::uuid, 'medium', 'Közepes, 11–25 kg', 3000, 4000, 15, 30, 1, true),
  ('d7111111-1111-1111-1111-111111111123'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111111'::uuid, 'large', 'Nagytestű, 26–40 kg', 6000, 8000, 30, 45, 2, true),
  ('d7111111-1111-1111-1111-111111111124'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111111'::uuid, 'extra-large', 'Óriástestű, 40 kg felett', 9000, 12000, 45, 60, 3, true),
  -- full-grooming add-ons
  ('d7111111-1111-1111-1111-111111111131'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111112'::uuid, 'deshedding', 'Aljszőrkiszedés', 3000, 5000, 15, 30, 0, true),
  ('d7111111-1111-1111-1111-111111111132'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111112'::uuid, 'teeth-cleaning', 'Fogtisztítás', 2500, 2500, 10, 10, 1, true),
  ('d7111111-1111-1111-1111-111111111133'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd3333333-3333-3333-3333-333333333333'::uuid, 'd7111111-1111-1111-1111-111111111112'::uuid, 'paw-care', 'Mancsápolás', 2000, 2000, 10, 10, 2, true),
  -- bath-and-brush dog-size
  ('d8111111-1111-1111-1111-111111111121'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111111'::uuid, 'small', 'Kistestű, 0–10 kg', 0, 0, 0, 0, 0, true),
  ('d8111111-1111-1111-1111-111111111122'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111111'::uuid, 'medium', 'Közepes, 11–25 kg', 3000, 4000, 15, 30, 1, true),
  ('d8111111-1111-1111-1111-111111111123'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111111'::uuid, 'large', 'Nagytestű, 26–40 kg', 6000, 8000, 30, 45, 2, true),
  ('d8111111-1111-1111-1111-111111111124'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111111'::uuid, 'extra-large', 'Óriástestű, 40 kg felett', 9000, 12000, 45, 60, 3, true),
  -- bath-and-brush add-ons
  ('d8111111-1111-1111-1111-111111111131'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111112'::uuid, 'deshedding', 'Aljszőrkiszedés', 3000, 5000, 15, 30, 0, true),
  ('d8111111-1111-1111-1111-111111111132'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111112'::uuid, 'teeth-cleaning', 'Fogtisztítás', 2500, 2500, 10, 10, 1, true),
  ('d8111111-1111-1111-1111-111111111133'::uuid, 'd1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, 'd8111111-1111-1111-1111-111111111112'::uuid, 'paw-care', 'Mancsápolás', 2000, 2000, 10, 10, 2, true)
ON CONFLICT (option_group_id, slug) DO NOTHING;

DO $$
DECLARE
  v_expected_count int;
  v_actual_count int;
BEGIN
  CREATE TEMP TABLE expected_options (
    id uuid PRIMARY KEY,
    option_group_id uuid NOT NULL,
    slug text NOT NULL,
    label text NOT NULL,
    price_delta_minor int NOT NULL,
    price_delta_max_minor int,
    duration_delta_minutes int NOT NULL,
    duration_delta_max_minutes int,
    sort_order int NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO expected_options
    (id, option_group_id, slug, label, price_delta_minor, price_delta_max_minor, duration_delta_minutes, duration_delta_max_minutes, sort_order)
  VALUES
    -- full-grooming dog-size
    ('d7111111-1111-1111-1111-111111111121'::uuid, 'd7111111-1111-1111-1111-111111111111'::uuid, 'small', 'Kistestű, 0–10 kg', 0, 0, 0, 0, 0),
    ('d7111111-1111-1111-1111-111111111122'::uuid, 'd7111111-1111-1111-1111-111111111111'::uuid, 'medium', 'Közepes, 11–25 kg', 3000, 4000, 15, 30, 1),
    ('d7111111-1111-1111-1111-111111111123'::uuid, 'd7111111-1111-1111-1111-111111111111'::uuid, 'large', 'Nagytestű, 26–40 kg', 6000, 8000, 30, 45, 2),
    ('d7111111-1111-1111-1111-111111111124'::uuid, 'd7111111-1111-1111-1111-111111111111'::uuid, 'extra-large', 'Óriástestű, 40 kg felett', 9000, 12000, 45, 60, 3),
    -- full-grooming add-ons
    ('d7111111-1111-1111-1111-111111111131'::uuid, 'd7111111-1111-1111-1111-111111111112'::uuid, 'deshedding', 'Aljszőrkiszedés', 3000, 5000, 15, 30, 0),
    ('d7111111-1111-1111-1111-111111111132'::uuid, 'd7111111-1111-1111-1111-111111111112'::uuid, 'teeth-cleaning', 'Fogtisztítás', 2500, 2500, 10, 10, 1),
    ('d7111111-1111-1111-1111-111111111133'::uuid, 'd7111111-1111-1111-1111-111111111112'::uuid, 'paw-care', 'Mancsápolás', 2000, 2000, 10, 10, 2),
    -- bath-and-brush dog-size
    ('d8111111-1111-1111-1111-111111111121'::uuid, 'd8111111-1111-1111-1111-111111111111'::uuid, 'small', 'Kistestű, 0–10 kg', 0, 0, 0, 0, 0),
    ('d8111111-1111-1111-1111-111111111122'::uuid, 'd8111111-1111-1111-1111-111111111111'::uuid, 'medium', 'Közepes, 11–25 kg', 3000, 4000, 15, 30, 1),
    ('d8111111-1111-1111-1111-111111111123'::uuid, 'd8111111-1111-1111-1111-111111111111'::uuid, 'large', 'Nagytestű, 26–40 kg', 6000, 8000, 30, 45, 2),
    ('d8111111-1111-1111-1111-111111111124'::uuid, 'd8111111-1111-1111-1111-111111111111'::uuid, 'extra-large', 'Óriástestű, 40 kg felett', 9000, 12000, 45, 60, 3),
    -- bath-and-brush add-ons
    ('d8111111-1111-1111-1111-111111111131'::uuid, 'd8111111-1111-1111-1111-111111111112'::uuid, 'deshedding', 'Aljszőrkiszedés', 3000, 5000, 15, 30, 0),
    ('d8111111-1111-1111-1111-111111111132'::uuid, 'd8111111-1111-1111-1111-111111111112'::uuid, 'teeth-cleaning', 'Fogtisztítás', 2500, 2500, 10, 10, 1),
    ('d8111111-1111-1111-1111-111111111133'::uuid, 'd8111111-1111-1111-1111-111111111112'::uuid, 'paw-care', 'Mancsápolás', 2000, 2000, 10, 10, 2);

  SELECT count(*) INTO v_expected_count FROM expected_options;

  SELECT count(*) INTO v_actual_count
  FROM public.booking_service_options o
  JOIN expected_options eo ON o.id = eo.id
  WHERE o.site_id = 'd1111111-1111-1111-1111-111111111111'::uuid
    AND o.option_group_id = eo.option_group_id
    AND o.slug = eo.slug
    AND o.label = eo.label
    AND o.price_delta_minor = eo.price_delta_minor
    AND (o.price_delta_max_minor IS NOT DISTINCT FROM eo.price_delta_max_minor)
    AND o.duration_delta_minutes = eo.duration_delta_minutes
    AND (o.duration_delta_max_minutes IS NOT DISTINCT FROM eo.duration_delta_max_minutes)
    AND o.sort_order = eo.sort_order
    AND o.is_active = true;

  IF v_actual_count <> v_expected_count THEN
    RAISE EXCEPTION 'Dog grooming seed failed: expected % options matching the exact contract, found %', v_expected_count, v_actual_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.booking_service_options o
    WHERE o.option_group_id IN (SELECT option_group_id FROM expected_options)
      AND o.site_id = 'd1111111-1111-1111-1111-111111111111'::uuid
      AND o.id NOT IN (SELECT id FROM expected_options)
  ) THEN
    RAISE EXCEPTION 'Dog grooming seed failed: unexpected options exist for the seeded groups';
  END IF;

  IF EXISTS (
    SELECT 1 FROM expected_options eo
    LEFT JOIN public.booking_service_options o
      ON o.id = eo.id
      AND o.site_id = 'd1111111-1111-1111-1111-111111111111'::uuid
      AND o.option_group_id = eo.option_group_id
      AND o.slug = eo.slug
      AND o.label = eo.label
      AND o.price_delta_minor = eo.price_delta_minor
      AND (o.price_delta_max_minor IS NOT DISTINCT FROM eo.price_delta_max_minor)
      AND o.duration_delta_minutes = eo.duration_delta_minutes
      AND (o.duration_delta_max_minutes IS NOT DISTINCT FROM eo.duration_delta_max_minutes)
      AND o.sort_order = eo.sort_order
      AND o.is_active = true
    WHERE o.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Dog grooming seed failed: one or more expected options are missing or have non-matching values';
  END IF;
END;
$$;

-- ----------------------------------------------------------------
-- 7. Schema grant
-- ----------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO service_role;

COMMIT;
