-- ============================================================
-- Booking range pricing/duration support
--
-- Adds min/max range columns so that services and options can express
-- estimated price and duration intervals (e.g. 90–150 min,
-- 14 900–17 900 Ft) while keeping fixed pricing as a strict
-- priceMin === priceMax contract.
--
-- Rules:
--   * Existing min columns remain the canonical lower bound.
--   * New max columns are nullable; NULL means max === min.
--   * Fixed pricing mode requires priceMin === priceMax.
--   * Slot/Calendar blocking always uses the concrete quote max duration.
--   * Snapshot version is bumped to 2 for new bookings.
--   * Legacy scalar snapshots and legacy rows remain readable.
--
-- This is a normal, one-time, additive Supabase migration.
-- Do not apply directly to production.
-- ============================================================

BEGIN;

-- ----------------------------------------------------------------
-- 1. Extend public.booking_services with max range columns
-- ----------------------------------------------------------------
ALTER TABLE public.booking_services
  ADD COLUMN IF NOT EXISTS max_duration_minutes integer,
  ADD COLUMN IF NOT EXISTS base_price_max_minor integer;

ALTER TABLE public.booking_services
  DROP CONSTRAINT IF EXISTS booking_services_max_duration_minutes_check,
  ADD CONSTRAINT booking_services_max_duration_minutes_check
    CHECK (
      max_duration_minutes IS NULL
      OR (
        max_duration_minutes BETWEEN 5 AND 480
        AND max_duration_minutes % 5 = 0
      )
    );

ALTER TABLE public.booking_services
  DROP CONSTRAINT IF EXISTS booking_services_duration_min_max_check,
  ADD CONSTRAINT booking_services_duration_min_max_check
    CHECK (
      max_duration_minutes IS NULL
      OR max_duration_minutes >= duration_minutes
    );

ALTER TABLE public.booking_services
  DROP CONSTRAINT IF EXISTS booking_services_base_price_max_minor_check,
  ADD CONSTRAINT booking_services_base_price_max_minor_check
    CHECK (base_price_max_minor IS NULL OR base_price_max_minor >= 0);

ALTER TABLE public.booking_services
  DROP CONSTRAINT IF EXISTS booking_services_base_price_min_max_check,
  ADD CONSTRAINT booking_services_base_price_min_max_check
    CHECK (
      (base_price_max_minor IS NULL OR base_price_minor IS NOT NULL)
      AND
      (base_price_max_minor IS NULL OR base_price_minor IS NULL OR base_price_max_minor >= base_price_minor)
    );

-- Fixed-price mode requires an exact min/max match. A nullable max is
-- interpreted as max === min, so the only invalid case is an explicit
-- mismatch.
ALTER TABLE public.booking_services
  DROP CONSTRAINT IF EXISTS booking_services_fixed_price_min_max_check,
  ADD CONSTRAINT booking_services_fixed_price_min_max_check
    CHECK (
      pricing_mode <> 'fixed'
      OR base_price_max_minor IS NULL
      OR base_price_minor IS NULL
      OR base_price_max_minor = base_price_minor
    );

-- ----------------------------------------------------------------
-- 2. Extend public.booking_service_options with max range columns
-- ----------------------------------------------------------------
ALTER TABLE public.booking_service_options
  ADD COLUMN IF NOT EXISTS price_delta_max_minor integer,
  ADD COLUMN IF NOT EXISTS duration_delta_max_minutes integer;

ALTER TABLE public.booking_service_options
  DROP CONSTRAINT IF EXISTS booking_service_options_price_delta_max_minor_range_check,
  ADD CONSTRAINT booking_service_options_price_delta_max_minor_range_check
    CHECK (price_delta_max_minor BETWEEN -100000000 AND 100000000);

ALTER TABLE public.booking_service_options
  DROP CONSTRAINT IF EXISTS booking_service_options_price_delta_max_minor_min_check,
  ADD CONSTRAINT booking_service_options_price_delta_max_minor_min_check
    CHECK (
      price_delta_max_minor IS NULL
      OR price_delta_max_minor >= price_delta_minor
    );

ALTER TABLE public.booking_service_options
  DROP CONSTRAINT IF EXISTS booking_service_options_duration_delta_max_minutes_step_check,
  ADD CONSTRAINT booking_service_options_duration_delta_max_minutes_step_check
    CHECK (
      duration_delta_max_minutes IS NULL
      OR duration_delta_max_minutes % 5 = 0
    );

ALTER TABLE public.booking_service_options
  DROP CONSTRAINT IF EXISTS booking_service_options_duration_delta_max_minutes_range_check,
  ADD CONSTRAINT booking_service_options_duration_delta_max_minutes_range_check
    CHECK (
      duration_delta_max_minutes IS NULL
      OR duration_delta_max_minutes BETWEEN -475 AND 475
    );

ALTER TABLE public.booking_service_options
  DROP CONSTRAINT IF EXISTS booking_service_options_duration_delta_max_minutes_min_check,
  ADD CONSTRAINT booking_service_options_duration_delta_max_minutes_min_check
    CHECK (
      duration_delta_max_minutes IS NULL
      OR duration_delta_max_minutes >= duration_delta_minutes
    );

-- ----------------------------------------------------------------
-- 3. Extend public.bookings with max price column and backfill
-- ----------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS calculated_price_max_minor integer;

-- Backfill existing scalar bookings so max === min.
UPDATE public.bookings
SET calculated_price_max_minor = calculated_price_minor
WHERE calculated_price_max_minor IS NULL
  AND calculated_price_minor IS NOT NULL;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_calculated_price_max_minor_check,
  ADD CONSTRAINT bookings_calculated_price_max_minor_check
    CHECK (calculated_price_max_minor IS NULL OR calculated_price_max_minor >= 0);

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_calculated_price_min_max_check,
  ADD CONSTRAINT bookings_calculated_price_min_max_check
    CHECK (
      calculated_price_max_minor IS NULL
      OR calculated_price_max_minor >= calculated_price_minor
    );

-- Enforce that price max is present exactly when price min is present.
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_price_max_consistency_check,
  ADD CONSTRAINT bookings_price_max_consistency_check
    CHECK (
      (calculated_price_minor IS NULL AND calculated_price_max_minor IS NULL)
      OR
      (calculated_price_minor IS NOT NULL AND calculated_price_max_minor IS NOT NULL)
    );

-- ----------------------------------------------------------------
-- 4. Schema grant
-- ----------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO service_role;

COMMIT;
