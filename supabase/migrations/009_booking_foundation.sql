-- Booking Foundation — additive single-tenant slice
-- Normal one-time Supabase migration.
-- Keeps the existing /audit application contract unchanged.
-- Seed IDs:
-- site:    c5f5f8a1-8b5e-4b8b-9f1e-9e6e5f8a3e2a
-- service: d6e6f9b2-9c6f-5c9c-a02f-af7f6a9b4f3b

BEGIN;

-- ----------------------------------------------------------------
-- 1. sites
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  timezone text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.sites FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sites TO service_role;

DROP TRIGGER IF EXISTS sites_touch ON public.sites;
CREATE TRIGGER sites_touch
  BEFORE UPDATE ON public.sites
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed the single LocalUp site. The seed is conflict-safe but fail-closed.
INSERT INTO public.sites (id, slug, name, timezone, is_active)
VALUES (
  'c5f5f8a1-8b5e-4b8b-9f1e-9e6e5f8a3e2a'::uuid,
  'localup',
  'LocalUp',
  'Europe/Budapest',
  true
)
ON CONFLICT DO NOTHING;

-- Verify the seeded site matches the documented contract exactly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.sites
    WHERE id = 'c5f5f8a1-8b5e-4b8b-9f1e-9e6e5f8a3e2a'::uuid
      AND slug = 'localup'
      AND name = 'LocalUp'
      AND timezone = 'Europe/Budapest'
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Booking foundation seed failed: the localup site does not match the expected contract (id, slug, name, timezone, is_active)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sites
    WHERE slug = 'localup'
      AND id <> 'c5f5f8a1-8b5e-4b8b-9f1e-9e6e5f8a3e2a'::uuid
  ) THEN
    RAISE EXCEPTION 'Booking foundation seed failed: another site already owns the localup slug';
  END IF;
END;
$$;

-- ----------------------------------------------------------------
-- 2. availability_schedules: add site_id
-- ----------------------------------------------------------------
ALTER TABLE public.availability_schedules
  ADD COLUMN IF NOT EXISTS site_id uuid;

UPDATE public.availability_schedules
SET site_id = 'c5f5f8a1-8b5e-4b8b-9f1e-9e6e5f8a3e2a'::uuid
WHERE site_id IS NULL;

ALTER TABLE public.availability_schedules
  ALTER COLUMN site_id SET NOT NULL;

ALTER TABLE public.availability_schedules
  DROP CONSTRAINT IF EXISTS availability_schedules_site_id_fk,
  ADD CONSTRAINT availability_schedules_site_id_fk
    FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;

-- Composite unique key required for the composite FK from booking_services.
ALTER TABLE public.availability_schedules
  DROP CONSTRAINT IF EXISTS availability_schedules_id_site_unique,
  ADD CONSTRAINT availability_schedules_id_site_unique
    UNIQUE (id, site_id);

-- The existing global default-schedule index is intentionally left unchanged.

-- ----------------------------------------------------------------
-- 3. booking_services
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.booking_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  schedule_id uuid NOT NULL,
  slug text NOT NULL CONSTRAINT booking_services_slug_not_empty_check CHECK (length(trim(slug)) > 0),
  name text NOT NULL CONSTRAINT booking_services_name_not_empty_check CHECK (length(trim(name)) > 0),
  duration_minutes int NOT NULL CONSTRAINT booking_services_duration_check CHECK (duration_minutes IN (15, 30, 45, 60, 90, 120)),
  slot_interval_minutes int NOT NULL,
  minimum_notice_minutes int NOT NULL CONSTRAINT booking_services_minimum_notice_check CHECK (minimum_notice_minutes BETWEEN 0 AND 43200),
  booking_window_days int NOT NULL CONSTRAINT booking_services_booking_window_check CHECK (booking_window_days BETWEEN 1 AND 365),
  buffer_before_minutes int NOT NULL DEFAULT 0 CONSTRAINT booking_services_buffer_before_check CHECK (buffer_before_minutes BETWEEN 0 AND 480),
  buffer_after_minutes int NOT NULL DEFAULT 0 CONSTRAINT booking_services_buffer_after_check CHECK (buffer_after_minutes BETWEEN 0 AND 480),
  cancel_cutoff_hours int NOT NULL DEFAULT 12 CONSTRAINT booking_services_cancel_cutoff_check CHECK (cancel_cutoff_hours BETWEEN 0 AND 720),
  reschedule_cutoff_hours int NOT NULL DEFAULT 12 CONSTRAINT booking_services_reschedule_cutoff_check CHECK (reschedule_cutoff_hours BETWEEN 0 AND 720),
  max_reschedules int NOT NULL DEFAULT 2 CONSTRAINT booking_services_max_reschedules_check CHECK (max_reschedules BETWEEN 0 AND 20),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT booking_services_site_id_fk
    FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT,
  CONSTRAINT booking_services_schedule_site_fk
    FOREIGN KEY (schedule_id, site_id) REFERENCES public.availability_schedules(id, site_id) ON DELETE RESTRICT,
  CONSTRAINT booking_services_slot_interval_min_check
    CHECK (slot_interval_minutes >= duration_minutes),
  CONSTRAINT booking_services_slot_interval_max_check
    CHECK (slot_interval_minutes <= 240),
  CONSTRAINT booking_services_slot_interval_multiple_check
    CHECK (slot_interval_minutes % 5 = 0),

  UNIQUE (site_id, slug),
  UNIQUE (id, site_id)
);

ALTER TABLE public.booking_services ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.booking_services FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_services TO service_role;

DROP TRIGGER IF EXISTS booking_services_touch ON public.booking_services;
CREATE TRIGGER booking_services_touch
  BEFORE UPDATE ON public.booking_services
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed the single LocalUp audit service from the existing default schedule.
-- Fails with 0 rows inserted if there is not exactly one active default schedule.
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
  is_active
)
SELECT
  'd6e6f9b2-9c6f-5c9c-a02f-af7f6a9b4f3b'::uuid,
  'c5f5f8a1-8b5e-4b8b-9f1e-9e6e5f8a3e2a'::uuid,
  s.id,
  'localup_audit',
  'LocalUp Audit',
  s.slot_duration_minutes,
  s.slot_interval_minutes,
  s.minimum_notice_minutes,
  s.booking_window_days,
  s.buffer_before_minutes,
  s.buffer_after_minutes,
  12,
  12,
  2,
  true
FROM public.availability_schedules s
WHERE s.is_default = true
  AND s.is_active = true
  AND (
    SELECT count(*)
    FROM public.availability_schedules
    WHERE is_default = true AND is_active = true
  ) = 1
ON CONFLICT DO NOTHING;

-- Verify the seeded service matches the documented contract exactly.
DO $$
DECLARE
  v_schedule_count int;
  v_schedule_id uuid;
BEGIN
  SELECT count(*) INTO v_schedule_count
  FROM public.availability_schedules
  WHERE is_default = true AND is_active = true;

  SELECT id INTO v_schedule_id
  FROM public.availability_schedules
  WHERE is_default = true AND is_active = true
  LIMIT 1;

  IF v_schedule_count <> 1 OR v_schedule_id IS NULL THEN
    RAISE EXCEPTION 'Booking foundation seed failed: expected exactly one active default availability schedule';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.booking_services
    WHERE id = 'd6e6f9b2-9c6f-5c9c-a02f-af7f6a9b4f3b'::uuid
      AND slug = 'localup_audit'
      AND site_id = 'c5f5f8a1-8b5e-4b8b-9f1e-9e6e5f8a3e2a'::uuid
      AND schedule_id = v_schedule_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Booking foundation seed failed: the localup_audit service does not match the expected contract (id, slug, site_id, schedule_id, is_active)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_services
    WHERE site_id = 'c5f5f8a1-8b5e-4b8b-9f1e-9e6e5f8a3e2a'::uuid
      AND slug = 'localup_audit'
      AND id <> 'd6e6f9b2-9c6f-5c9c-a02f-af7f6a9b4f3b'::uuid
  ) THEN
    RAISE EXCEPTION 'Booking foundation seed failed: another service already owns the localup_audit slug on the localup site';
  END IF;
END;
$$;

-- ----------------------------------------------------------------
-- 4. audit_bookings: add service_id and site_id
-- ----------------------------------------------------------------
ALTER TABLE public.audit_bookings
  ADD COLUMN IF NOT EXISTS service_id uuid
    DEFAULT 'd6e6f9b2-9c6f-5c9c-a02f-af7f6a9b4f3b'::uuid,
  ADD COLUMN IF NOT EXISTS site_id uuid
    DEFAULT 'c5f5f8a1-8b5e-4b8b-9f1e-9e6e5f8a3e2a'::uuid;

UPDATE public.audit_bookings
SET
  service_id = COALESCE(service_id, 'd6e6f9b2-9c6f-5c9c-a02f-af7f6a9b4f3b'::uuid),
  site_id = COALESCE(site_id, 'c5f5f8a1-8b5e-4b8b-9f1e-9e6e5f8a3e2a'::uuid)
WHERE service_id IS NULL OR site_id IS NULL;

ALTER TABLE public.audit_bookings
  ALTER COLUMN service_id SET NOT NULL,
  ALTER COLUMN site_id SET NOT NULL;

ALTER TABLE public.audit_bookings
  DROP CONSTRAINT IF EXISTS audit_bookings_service_site_fk,
  ADD CONSTRAINT audit_bookings_service_site_fk
    FOREIGN KEY (service_id, site_id) REFERENCES public.booking_services(id, site_id) ON DELETE RESTRICT;

-- The existing unique_audit_booking_active_slot index is intentionally left unchanged.

-- ----------------------------------------------------------------
-- 5. service_role schema grant
-- ----------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO service_role;

COMMIT;
