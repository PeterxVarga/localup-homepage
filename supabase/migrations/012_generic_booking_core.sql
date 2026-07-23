-- Generic Booking Core — additive tenant-aware slice
-- Normal one-time Supabase migration.
-- Keeps the existing /audit application contract unchanged.
-- Introduces the public.bookings table used by non-audit consumers.
--
-- Design notes:
--   * site_id + service_id are written explicitly on every insert.
--   * blocked_start / blocked_end include the service buffers.
--   * Exclusion constraint prevents active bookings on the same site from
--     overlapping in their blocked intervals. Cancelled bookings do not block.
--   * No public RLS policies; backend uses service_role only.

BEGIN;

-- ----------------------------------------------------------------
-- 1. Relax booking_services timing constraints for generic use
-- ----------------------------------------------------------------
--
-- The previous constraints required fixed durations and slot_interval >=
-- duration. Generic consumers need arbitrary durations (e.g. 75 min) that
-- can start on a coarser grid (e.g. 15 or 30 min). Overlap protection is
-- enforced by the exclusion constraint on public.bookings below.

ALTER TABLE public.booking_services
  DROP CONSTRAINT IF EXISTS booking_services_duration_check,
  ADD CONSTRAINT booking_services_duration_check
    CHECK (duration_minutes BETWEEN 5 AND 480 AND duration_minutes % 5 = 0);

ALTER TABLE public.booking_services
  DROP CONSTRAINT IF EXISTS booking_services_slot_interval_min_check,
  DROP CONSTRAINT IF EXISTS booking_services_slot_interval_max_check,
  DROP CONSTRAINT IF EXISTS booking_services_slot_interval_multiple_check,
  ADD CONSTRAINT booking_services_slot_interval_check
    CHECK (slot_interval_minutes BETWEEN 5 AND 240 AND slot_interval_minutes % 5 = 0);

-- Fail-closed toggle for the generic public booking API. Existing services
-- (including localup_audit) remain disabled until explicitly enabled.
ALTER TABLE public.booking_services
  ADD COLUMN IF NOT EXISTS public_booking_enabled boolean NOT NULL DEFAULT false;

-- ----------------------------------------------------------------
-- 2. public.bookings
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  service_id uuid NOT NULL,
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  customer_phone text,
  customer_notes text,
  slot_start timestamptz NOT NULL,
  slot_end timestamptz NOT NULL,
  blocked_start timestamptz NOT NULL,
  blocked_end timestamptz NOT NULL,
  booking_status text NOT NULL,
  calendar_sync_status text NOT NULL,
  google_calendar_event_id text,
  meet_link text,
  management_token_hash text NOT NULL UNIQUE,
  management_token_encrypted text NOT NULL,
  management_token_expires_at timestamptz NOT NULL,
  reschedule_count int NOT NULL DEFAULT 0,
  previous_slot_start timestamptz,
  previous_slot_end timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  rescheduled_at timestamptz,
  source text,
  locale text NOT NULL DEFAULT 'hu',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bookings_customer_name_not_empty_check
    CHECK (length(trim(customer_name)) > 0),
  CONSTRAINT bookings_customer_email_not_empty_check
    CHECK (length(trim(customer_email)) > 0),
  CONSTRAINT bookings_slot_end_after_start_check
    CHECK (slot_end > slot_start),
  CONSTRAINT bookings_blocked_start_before_slot_check
    CHECK (blocked_start <= slot_start),
  CONSTRAINT bookings_blocked_end_after_slot_check
    CHECK (blocked_end >= slot_end),
  CONSTRAINT bookings_blocked_end_after_start_check
    CHECK (blocked_end > blocked_start),
  CONSTRAINT bookings_booking_status_check
    CHECK (booking_status IN ('pending', 'booked', 'cancelled')),
  CONSTRAINT bookings_calendar_sync_status_check
    CHECK (calendar_sync_status IN ('pending', 'synced', 'failed')),
  CONSTRAINT bookings_reschedule_count_check
    CHECK (reschedule_count >= 0),

  CONSTRAINT bookings_service_site_fk
    FOREIGN KEY (service_id, site_id) REFERENCES public.booking_services(id, site_id) ON DELETE RESTRICT,
  CONSTRAINT bookings_site_fk
    FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT
);

-- Real interval overlap protection: active bookings on the same site cannot
-- have overlapping blocked intervals. Cancelled bookings are excluded.
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_no_blocked_overlap_active_excl,
  ADD CONSTRAINT bookings_no_blocked_overlap_active_excl
    EXCLUDE USING gist (
      site_id WITH =,
      tstzrange(blocked_start, blocked_end, '[)') WITH &&
    )
    WHERE (booking_status IN ('pending', 'booked'));

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.bookings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bookings TO service_role;

DROP TRIGGER IF EXISTS bookings_touch ON public.bookings;
CREATE TRIGGER bookings_touch
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ----------------------------------------------------------------
-- 3. Indexes
-- ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_bookings_site_slot_start
  ON public.bookings (site_id, slot_start);

CREATE INDEX IF NOT EXISTS idx_bookings_service_slot_start
  ON public.bookings (service_id, slot_start);

CREATE INDEX IF NOT EXISTS idx_bookings_site_blocked
  ON public.bookings (site_id, blocked_start, blocked_end);

-- ----------------------------------------------------------------
-- 4. Schema grant
-- ----------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO service_role;

COMMIT;
