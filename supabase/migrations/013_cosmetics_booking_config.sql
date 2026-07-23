-- Cosmetics Booking Config — additive tenant-ready slice
-- Normal one-time Supabase migration.
--
-- Adds site-specific Calendar provider configuration and seeds the first
-- generic booking tenant (Cosmetics demo site + services) without enabling
-- public bookings or storing any secrets in Git.
--
-- Seed IDs (deterministic):
--   cosmetics site:       a1111111-1111-1111-1111-111111111111
--   cosmetics schedule:   b2222222-2222-2222-2222-222222222222

BEGIN;

-- ----------------------------------------------------------------
-- 1. Composite FK index for public.bookings
-- ----------------------------------------------------------------
-- Supabase performance advisor flags the composite FK
-- bookings(service_id, site_id) -> booking_services(id, site_id)
-- because the existing (service_id, slot_start) index does not cover
-- the exact FK column order.
CREATE INDEX IF NOT EXISTS idx_bookings_service_site
  ON public.bookings (service_id, site_id);

-- ----------------------------------------------------------------
-- 2. site_calendar_configs
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.site_calendar_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  provider text NOT NULL,
  calendar_id text NOT NULL,
  encrypted_refresh_token text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT site_calendar_configs_provider_check
    CHECK (provider = 'google'),
  CONSTRAINT site_calendar_configs_calendar_id_check
    CHECK (length(trim(calendar_id)) > 0),
  CONSTRAINT site_calendar_configs_encrypted_token_check
    CHECK (length(trim(encrypted_refresh_token)) > 0),

  CONSTRAINT site_calendar_configs_site_fk
    FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT
);

-- At most one active config per site/provider pair.
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_calendar_configs_active_unique
  ON public.site_calendar_configs (site_id, provider)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_site_calendar_configs_site
  ON public.site_calendar_configs (site_id);

ALTER TABLE public.site_calendar_configs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.site_calendar_configs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.site_calendar_configs TO service_role;

DROP TRIGGER IF EXISTS site_calendar_configs_touch ON public.site_calendar_configs;
CREATE TRIGGER site_calendar_configs_touch
  BEFORE UPDATE ON public.site_calendar_configs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ----------------------------------------------------------------
-- 3. Seed Cosmetics demo site
-- ----------------------------------------------------------------
INSERT INTO public.sites (
  id,
  slug,
  name,
  timezone,
  is_active
) VALUES (
  'a1111111-1111-1111-1111-111111111111'::uuid,
  'szepbor-kozmetika',
  'Szép Bőr Kozmetika',
  'Europe/Budapest',
  true
)
ON CONFLICT (slug) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sites
    WHERE id = 'a1111111-1111-1111-1111-111111111111'::uuid
      AND slug = 'szepbor-kozmetika'
      AND name = 'Szép Bőr Kozmetika'
      AND timezone = 'Europe/Budapest'
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Cosmetics seed failed: site id/slug/name/timezone/is_active mismatch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sites
    WHERE slug = 'szepbor-kozmetika'
      AND id <> 'a1111111-1111-1111-1111-111111111111'::uuid
  ) THEN
    RAISE EXCEPTION 'Cosmetics seed failed: another site already owns the szepbor-kozmetika slug';
  END IF;
END;
$$;

-- ----------------------------------------------------------------
-- 4. Seed Cosmetics availability schedule
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
  'b2222222-2222-2222-2222-222222222222'::uuid,
  'a1111111-1111-1111-1111-111111111111'::uuid,
  'Szép Bőr Kozmetika nyitvatartás',
  'Europe/Budapest',
  false,
  true,
  -- Legacy schedule compatibility values. The availability_schedules
  -- slot_interval_check requires slot_interval_minutes >= slot_duration_minutes.
  -- Generic booking runtime uses booking_services.duration_minutes and
  -- booking_services.slot_interval_minutes, so the schedule-level grid here
  -- does not restrict the 60/75 minute Cosmetics services or their 15-minute
  -- start grid.
  60,
  60,
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
    WHERE id = 'b2222222-2222-2222-2222-222222222222'::uuid
      AND site_id = 'a1111111-1111-1111-1111-111111111111'::uuid
      AND name = 'Szép Bőr Kozmetika nyitvatartás'
      AND timezone = 'Europe/Budapest'
      AND is_default = false
      AND is_active = true
      -- Legacy schedule compatibility: satisfies the availability_schedules
      -- slot_interval_minutes >= slot_duration_minutes check. Runtime slot
      -- duration and grid come from booking_services.
      AND slot_duration_minutes = 60
      AND slot_interval_minutes = 60
      AND minimum_notice_minutes = 720
      AND booking_window_days = 60
      AND buffer_before_minutes = 0
      AND buffer_after_minutes = 0
  ) THEN
    RAISE EXCEPTION 'Cosmetics seed failed: schedule contract mismatch';
  END IF;
END;
$$;

-- Weekly rules: Mon-Fri 09:00-18:00, Sat 10:00-14:00.
-- Monday=0 ... Sunday=6, matching the availability_weekly_rules schema.
INSERT INTO public.availability_weekly_rules
  (schedule_id, weekday, start_time, end_time, sort_order)
SELECT
  'b2222222-2222-2222-2222-222222222222'::uuid,
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
  (5, '10:00'::time, '14:00'::time, 0)
) AS t(weekday, start_time, end_time, sort_order)
WHERE EXISTS (
  SELECT 1 FROM public.availability_schedules
  WHERE id = 'b2222222-2222-2222-2222-222222222222'::uuid
)
ON CONFLICT DO NOTHING;

-- Two-way exact validation of weekly rules.
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
    (5, '10:00'::time, '14:00'::time, 0);

  SELECT count(*) INTO v_expected_count FROM expected_rules;

  SELECT count(*) INTO v_actual_count
  FROM public.availability_weekly_rules
  WHERE schedule_id = 'b2222222-2222-2222-2222-222222222222'::uuid;

  IF v_actual_count <> v_expected_count THEN
    RAISE EXCEPTION 'Cosmetics seed failed: expected % weekly rules, found %', v_expected_count, v_actual_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM expected_rules er
    LEFT JOIN public.availability_weekly_rules ar
      ON ar.schedule_id = 'b2222222-2222-2222-2222-222222222222'::uuid
      AND ar.weekday = er.weekday
      AND ar.start_time = er.start_time
      AND ar.end_time = er.end_time
      AND ar.sort_order = er.sort_order
    WHERE ar.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cosmetics seed failed: one or more expected weekly rules are missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.availability_weekly_rules ar
    LEFT JOIN expected_rules er
      ON ar.weekday = er.weekday
      AND ar.start_time = er.start_time
      AND ar.end_time = er.end_time
      AND ar.sort_order = er.sort_order
    WHERE ar.schedule_id = 'b2222222-2222-2222-2222-222222222222'::uuid
      AND er.weekday IS NULL
  ) THEN
    RAISE EXCEPTION 'Cosmetics seed failed: one or more unexpected weekly rules exist';
  END IF;
END;
$$;

-- ----------------------------------------------------------------
-- 5. Seed Cosmetics booking services
-- ----------------------------------------------------------------
-- public_booking_enabled remains false: this PR intentionally does not
-- enable public bookings for Cosmetics yet.
--
-- Each service keeps its own duration_minutes and slot_interval_minutes.
-- The generic booking runtime uses booking_services.duration_minutes and
-- booking_services.slot_interval_minutes, not the legacy schedule fields.
INSERT INTO public.booking_services (
  id,
  site_id,
  schedule_id,
  slug,
  name,
  duration_minutes,
  slot_interval_minutes,
  minimum_notice_minutes,
  booking_window_days,
  buffer_before_minutes,
  buffer_after_minutes,
  cancel_cutoff_hours,
  reschedule_cutoff_hours,
  max_reschedules,
  public_booking_enabled,
  is_active
) VALUES
  (
    'c3333333-3333-3333-3333-333333333333'::uuid,
    'a1111111-1111-1111-1111-111111111111'::uuid,
    'b2222222-2222-2222-2222-222222222222'::uuid,
    'arckezeles',
    'Arckezelés',
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
    true
  ),
  (
    'c4444444-4444-4444-4444-444444444444'::uuid,
    'a1111111-1111-1111-1111-111111111111'::uuid,
    'b2222222-2222-2222-2222-222222222222'::uuid,
    'hidralato-arckezeles',
    'Hidratáló arckezelés',
    75,
    15,
    720,
    60,
    0,
    0,
    12,
    12,
    2,
    false,
    true
  ),
  (
    'c5555555-5555-5555-5555-555555555555'::uuid,
    'a1111111-1111-1111-1111-111111111111'::uuid,
    'b2222222-2222-2222-2222-222222222222'::uuid,
    'anti-aging-kezeles',
    'Anti-aging kezelés',
    75,
    15,
    720,
    60,
    0,
    0,
    12,
    12,
    2,
    false,
    true
  ),
  (
    'c6666666-6666-6666-6666-666666666666'::uuid,
    'a1111111-1111-1111-1111-111111111111'::uuid,
    'b2222222-2222-2222-2222-222222222222'::uuid,
    'kemiai-hamlasztas',
    'Kémiai hámlasztás',
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
    true
  ),
  (
    'c7777777-7777-7777-7777-777777777777'::uuid,
    'a1111111-1111-1111-1111-111111111111'::uuid,
    'b2222222-2222-2222-2222-222222222222'::uuid,
    'dermapen',
    'Dermapen mikrotűs kezelés',
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
    true
  )
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_expected_count int;
  v_actual_count int;
BEGIN
  -- Exact expected service contract, mapped by deterministic ID.
  CREATE TEMP TABLE expected_services (
    id uuid PRIMARY KEY,
    slug text NOT NULL,
    name text NOT NULL,
    duration_minutes int NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO expected_services (id, slug, name, duration_minutes) VALUES
    ('c3333333-3333-3333-3333-333333333333'::uuid, 'arckezeles', 'Arckezelés', 60),
    ('c4444444-4444-4444-4444-444444444444'::uuid, 'hidralato-arckezeles', 'Hidratáló arckezelés', 75),
    ('c5555555-5555-5555-5555-555555555555'::uuid, 'anti-aging-kezeles', 'Anti-aging kezelés', 75),
    ('c6666666-6666-6666-6666-666666666666'::uuid, 'kemiai-hamlasztas', 'Kémiai hámlasztás', 60),
    ('c7777777-7777-7777-7777-777777777777'::uuid, 'dermapen', 'Dermapen mikrotűs kezelés', 60);

  SELECT count(*) INTO v_expected_count FROM expected_services;

  SELECT count(*) INTO v_actual_count
  FROM public.booking_services bs
  JOIN expected_services es ON bs.id = es.id
  WHERE bs.site_id = 'a1111111-1111-1111-1111-111111111111'::uuid
    AND bs.schedule_id = 'b2222222-2222-2222-2222-222222222222'::uuid
    AND bs.slug = es.slug
    AND bs.name = es.name
    AND bs.duration_minutes = es.duration_minutes
    AND bs.slot_interval_minutes = 15
    AND bs.minimum_notice_minutes = 720
    AND bs.booking_window_days = 60
    AND bs.buffer_before_minutes = 0
    AND bs.buffer_after_minutes = 0
    AND bs.cancel_cutoff_hours = 12
    AND bs.reschedule_cutoff_hours = 12
    AND bs.max_reschedules = 2
    AND bs.public_booking_enabled = false
    AND bs.is_active = true;

  IF v_actual_count <> v_expected_count THEN
    RAISE EXCEPTION 'Cosmetics seed failed: expected % services matching the exact contract, found %', v_expected_count, v_actual_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.booking_services
    WHERE slug IN (SELECT slug FROM expected_services)
      AND site_id = 'a1111111-1111-1111-1111-111111111111'::uuid
      AND id NOT IN (SELECT id FROM expected_services)
  ) THEN
    RAISE EXCEPTION 'Cosmetics seed failed: one or more expected service slugs already exist with different IDs';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.booking_services
    WHERE id IN (SELECT id FROM expected_services)
      AND site_id = 'a1111111-1111-1111-1111-111111111111'::uuid
      AND id NOT IN (
        SELECT bs.id FROM public.booking_services bs
        JOIN expected_services es ON bs.id = es.id
        WHERE bs.site_id = 'a1111111-1111-1111-1111-111111111111'::uuid
          AND bs.schedule_id = 'b2222222-2222-2222-2222-222222222222'::uuid
          AND bs.slug = es.slug
          AND bs.name = es.name
          AND bs.duration_minutes = es.duration_minutes
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
      )
  ) THEN
    RAISE EXCEPTION 'Cosmetics seed failed: one or more expected service IDs exist with non-matching values';
  END IF;
END;
$$;

-- ----------------------------------------------------------------
-- 6. Schema grant
-- ----------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO service_role;

COMMIT;
