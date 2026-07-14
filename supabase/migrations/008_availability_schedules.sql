-- ============================================================
-- LocalUp Availability Scheduling — V1 Migration
-- ============================================================
--
-- Adds a DB-backed availability layer for audit bookings:
--   * availability_schedules         — one default schedule (V1)
--   * availability_weekly_rules      — per-weekday time windows
--   * availability_date_overrides    — date-level unavailable/custom header
--   * availability_date_override_intervals — custom override time windows
--
-- Also creates:
--   * replace_availability_bundle(jsonb) RPC for atomic admin updates
--   * shared touch_updated_at() trigger function
--   * service_role grants + anonymous/authenticated revokes
--   * backward-compatible default seed matching the current homepage
--     config (Monday 10:00–12:00, Tuesday 14:00–17:00,
--     Thursday 10:00–15:00; slot_duration=30, slot_interval=45,
--     buffers=0).
--
-- This migration is intended to run ONCE as a normal Supabase
-- migration. Individual DDL statements are guarded with
-- IF NOT EXISTS / DROP ... IF EXISTS ... ADD for idempotency where
-- PostgreSQL allows it. The seed at the bottom is idempotent via a
-- CTE and ON CONFLICT.
--
-- SECURITY:
-- * No PUBLIC, anon, or authenticated access to the availability
--   tables or RPC.
-- * service_role only — used by server-side code in both repos.
-- * SECURITY DEFINER RPC with fixed search_path.
-- * No secrets, emails, tokens or payload logged.
--
-- TIMEZONE/DST:
-- * DB stores UTC timestamps and plain wall-clock TIME values.
-- * The schedule timezone is hard-coded to Europe/Budapest in V1.
-- * Business-hours guard (05:00–23:00) avoids the ambiguous DST
--   02:00–03:00 window.
-- ============================================================

BEGIN;

-- 1. Extension required for GiST equality operators on scalar types.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. Shared updated_at trigger function.
-- SECURITY INVOKER is fine here: the trigger runs as the table owner
-- (postgres role in Supabase) which owns the UPDATE privilege on its
-- own tables. Revoke direct execution from anonymous/authenticated.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.touch_updated_at()
  FROM PUBLIC, anon, authenticated;

-- 3. availability_schedules -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.availability_schedules (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL,
  timezone                text NOT NULL DEFAULT 'Europe/Budapest',
  is_default              boolean NOT NULL DEFAULT false,
  is_active               boolean NOT NULL DEFAULT true,
  slot_duration_minutes   int NOT NULL DEFAULT 30,
  slot_interval_minutes   int NOT NULL DEFAULT 45,
  minimum_notice_minutes  int NOT NULL DEFAULT 1440,
  booking_window_days     int NOT NULL DEFAULT 14,
  buffer_before_minutes   int NOT NULL DEFAULT 0,
  buffer_after_minutes    int NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Only one default schedule can exist (V1 single-admin model).
CREATE UNIQUE INDEX IF NOT EXISTS unique_availability_schedule_default
  ON public.availability_schedules (is_default)
  WHERE is_default = true;

-- Speed up the default-schedule lookup in the RPC.
CREATE INDEX IF NOT EXISTS idx_availability_schedules_default
  ON public.availability_schedules (is_default)
  WHERE is_default = true;

ALTER TABLE public.availability_schedules
  DROP CONSTRAINT IF EXISTS availability_schedules_timezone_check,
  ADD  CONSTRAINT availability_schedules_timezone_check
       CHECK (timezone = 'Europe/Budapest'),
  DROP CONSTRAINT IF EXISTS availability_schedules_slot_duration_check,
  ADD  CONSTRAINT availability_schedules_slot_duration_check
       CHECK (slot_duration_minutes IN (15, 30, 45, 60, 90, 120)),
  DROP CONSTRAINT IF EXISTS availability_schedules_slot_interval_check,
  ADD  CONSTRAINT availability_schedules_slot_interval_check
       CHECK (slot_interval_minutes >= slot_duration_minutes),
  DROP CONSTRAINT IF EXISTS availability_schedules_slot_interval_upper_check,
  ADD  CONSTRAINT availability_schedules_slot_interval_upper_check
       CHECK (slot_interval_minutes <= 240),
  DROP CONSTRAINT IF EXISTS availability_schedules_slot_interval_align_check,
  ADD  CONSTRAINT availability_schedules_slot_interval_align_check
       CHECK (slot_interval_minutes % 5 = 0),
  DROP CONSTRAINT IF EXISTS availability_schedules_notice_check,
  ADD  CONSTRAINT availability_schedules_notice_check
       CHECK (minimum_notice_minutes >= 0
              AND minimum_notice_minutes <= 30 * 24 * 60),
  DROP CONSTRAINT IF EXISTS availability_schedules_window_check,
  ADD  CONSTRAINT availability_schedules_window_check
       CHECK (booking_window_days >= 1 AND booking_window_days <= 365),
  DROP CONSTRAINT IF EXISTS availability_schedules_buffer_before_check,
  ADD  CONSTRAINT availability_schedules_buffer_before_check
       CHECK (buffer_before_minutes >= 0
              AND buffer_before_minutes <= 8 * 60),
  DROP CONSTRAINT IF EXISTS availability_schedules_buffer_after_check,
  ADD  CONSTRAINT availability_schedules_buffer_after_check
       CHECK (buffer_after_minutes >= 0
              AND buffer_after_minutes <= 8 * 60),
  DROP CONSTRAINT IF EXISTS availability_schedules_active_default_check,
  ADD  CONSTRAINT availability_schedules_active_default_check
       CHECK (NOT (is_default AND NOT is_active));

DROP TRIGGER IF EXISTS availability_schedules_touch
  ON public.availability_schedules;
CREATE TRIGGER availability_schedules_touch
  BEFORE UPDATE ON public.availability_schedules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4. availability_weekly_rules ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.availability_weekly_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id    uuid NOT NULL
    REFERENCES public.availability_schedules(id)
    ON DELETE CASCADE,
  weekday        int NOT NULL,
  start_time     time without time zone NOT NULL,
  end_time       time without time zone NOT NULL,
  sort_order     int NOT NULL DEFAULT 0,
  start_minute   int
    GENERATED ALWAYS AS
      (extract(hour from start_time)::integer * 60
       + extract(minute from start_time)::integer) STORED,
  end_minute     int
    GENERATED ALWAYS AS
      (extract(hour from end_time)::integer * 60
       + extract(minute from end_time)::integer) STORED,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Unique by natural key: enables idempotent seed INSERT ... ON CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS unique_availability_weekly_rule
  ON public.availability_weekly_rules
    (schedule_id, weekday, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_availability_weekly_rules_schedule
  ON public.availability_weekly_rules (schedule_id, weekday, sort_order);

ALTER TABLE public.availability_weekly_rules
  DROP CONSTRAINT IF EXISTS availability_weekly_rules_weekday_check,
  ADD  CONSTRAINT availability_weekly_rules_weekday_check
       CHECK (weekday BETWEEN 0 AND 6),
  DROP CONSTRAINT IF EXISTS availability_weekly_rules_time_order_check,
  ADD  CONSTRAINT availability_weekly_rules_time_order_check
       CHECK (end_time > start_time),
  DROP CONSTRAINT IF EXISTS availability_weekly_rules_sort_check,
  ADD  CONSTRAINT availability_weekly_rules_sort_check
       CHECK (sort_order >= 0),
  DROP CONSTRAINT IF EXISTS availability_weekly_rules_business_hours_check,
  ADD  CONSTRAINT availability_weekly_rules_business_hours_check
       CHECK (start_time >= TIME '05:00'
              AND end_time <= TIME '23:00'),
  DROP CONSTRAINT IF EXISTS availability_weekly_rules_no_overlap,
  ADD  CONSTRAINT availability_weekly_rules_no_overlap
       EXCLUDE USING gist (
         schedule_id WITH =,
         weekday     WITH =,
         int4range(start_minute, end_minute, '[)') WITH &&
       );

DROP TRIGGER IF EXISTS availability_weekly_rules_touch
  ON public.availability_weekly_rules;
CREATE TRIGGER availability_weekly_rules_touch
  BEFORE UPDATE ON public.availability_weekly_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 5. availability_date_overrides --------------------------------------------
CREATE TABLE IF NOT EXISTS public.availability_date_overrides (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id    uuid NOT NULL
    REFERENCES public.availability_schedules(id)
    ON DELETE CASCADE,
  override_date  date NOT NULL,
  kind           text NOT NULL,
  reason         text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_availability_override_per_date
  ON public.availability_date_overrides (schedule_id, override_date);

CREATE INDEX IF NOT EXISTS idx_availability_date_overrides_schedule_date
  ON public.availability_date_overrides (schedule_id, override_date);

ALTER TABLE public.availability_date_overrides
  DROP CONSTRAINT IF EXISTS availability_date_overrides_kind_check,
  ADD  CONSTRAINT availability_date_overrides_kind_check
       CHECK (kind IN ('unavailable', 'custom'));

DROP TRIGGER IF EXISTS availability_date_overrides_touch
  ON public.availability_date_overrides;
CREATE TRIGGER availability_date_overrides_touch
  BEFORE UPDATE ON public.availability_date_overrides
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 6. availability_date_override_intervals -----------------------------------
CREATE TABLE IF NOT EXISTS public.availability_date_override_intervals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  override_id   uuid NOT NULL
    REFERENCES public.availability_date_overrides(id)
    ON DELETE CASCADE,
  start_time    time without time zone NOT NULL,
  end_time      time without time zone NOT NULL,
  sort_order    int NOT NULL DEFAULT 0,
  start_minute  int
    GENERATED ALWAYS AS
      (extract(hour from start_time)::integer * 60
       + extract(minute from start_time)::integer) STORED,
  end_minute    int
    GENERATED ALWAYS AS
      (extract(hour from end_time)::integer * 60
       + extract(minute from end_time)::integer) STORED,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_availability_override_intervals_override
  ON public.availability_date_override_intervals (override_id, sort_order);

ALTER TABLE public.availability_date_override_intervals
  DROP CONSTRAINT IF EXISTS availability_date_override_intervals_time_order_check,
  ADD  CONSTRAINT availability_date_override_intervals_time_order_check
       CHECK (end_time > start_time),
  DROP CONSTRAINT IF EXISTS availability_date_override_intervals_sort_check,
  ADD  CONSTRAINT availability_date_override_intervals_sort_check
       CHECK (sort_order >= 0),
  DROP CONSTRAINT IF EXISTS availability_date_override_intervals_business_hours_check,
  ADD  CONSTRAINT availability_date_override_intervals_business_hours_check
       CHECK (start_time >= TIME '05:00'
              AND end_time <= TIME '23:00'),
  DROP CONSTRAINT IF EXISTS availability_date_override_intervals_no_overlap,
  ADD  CONSTRAINT availability_date_override_intervals_no_overlap
       EXCLUDE USING gist (
         override_id WITH =,
         int4range(start_minute, end_minute, '[)') WITH &&
       );

DROP TRIGGER IF EXISTS availability_date_override_intervals_touch
  ON public.availability_date_override_intervals;
CREATE TRIGGER availability_date_override_intervals_touch
  BEFORE UPDATE ON public.availability_date_override_intervals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 7. Row Level Security ------------------------------------------------------
-- Enable RLS. No policies are created for anon/authenticated because
-- availability data is NEVER read or written directly by public users.
-- The service_role key bypasses RLS and is used exclusively by the
-- server-side code in both repos.
ALTER TABLE IF EXISTS public.availability_schedules
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.availability_weekly_rules
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.availability_date_overrides
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.availability_date_override_intervals
  ENABLE ROW LEVEL SECURITY;

-- 8. Revoke direct table access from public/authenticated roles --------------
REVOKE ALL ON TABLE public.availability_schedules
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.availability_weekly_rules
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.availability_date_overrides
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.availability_date_override_intervals
  FROM PUBLIC, anon, authenticated;

-- 9. service_role grants -----------------------------------------------------
GRANT USAGE ON SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.availability_schedules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.availability_weekly_rules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.availability_date_overrides TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.availability_date_override_intervals TO service_role;

-- 10. replace_availability_bundle RPC ----------------------------------------
-- Atomic transaction that replaces the entire default schedule child graph.
-- Called by the dashboard PUT /api/availability Route Handler with the
-- service_role key. Returns only {"ok":true,"scheduleId":"..."} on success.
-- Every failure path raises an exception; the Route Handler maps SQLSTATE
-- codes to HTTP status codes and returns a generic error envelope.
CREATE OR REPLACE FUNCTION public.replace_availability_bundle(
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_schedule_id        uuid;
  v_sched_name         text;
  v_sched_tz           text;
  v_sched_active       boolean;
  v_slot_dur           int;
  v_slot_int           int;
  v_min_notice         int;
  v_window_days        int;
  v_buf_before         int;
  v_buf_after          int;
  v_weekly             jsonb;
  v_overrides          jsonb;
  v_bad_custom_count   int;
BEGIN
  -- === 10.1 Top-level payload shape ========================================
  IF jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'availability: payload must be a JSON object'
      USING ERRCODE = '23514';
  END IF;

  IF jsonb_typeof(p_payload->'schedule') <> 'object' THEN
    RAISE EXCEPTION 'availability: schedule must be a JSON object'
      USING ERRCODE = '23514';
  END IF;

  v_weekly    := p_payload->'weeklyRules';
  v_overrides := p_payload->'dateOverrides';

  IF jsonb_typeof(v_weekly) <> 'array' THEN
    RAISE EXCEPTION 'availability: weeklyRules must be a JSON array'
      USING ERRCODE = '23514';
  END IF;

  IF jsonb_typeof(v_overrides) <> 'array' THEN
    RAISE EXCEPTION 'availability: dateOverrides must be a JSON array'
      USING ERRCODE = '23514';
  END IF;

  -- === 10.2 Schedule required fields =======================================
  v_sched_name   := p_payload->'schedule'->>'name';
  v_sched_tz     := p_payload->'schedule'->>'timezone';
  v_sched_active := (p_payload->'schedule'->>'isActive')::boolean;
  v_slot_dur     := (p_payload->'schedule'->>'slotDurationMinutes')::int;
  v_slot_int     := (p_payload->'schedule'->>'slotIntervalMinutes')::int;
  v_min_notice   := (p_payload->'schedule'->>'minimumNoticeMinutes')::int;
  v_window_days  := (p_payload->'schedule'->>'bookingWindowDays')::int;
  v_buf_before   := (p_payload->'schedule'->>'bufferBeforeMinutes')::int;
  v_buf_after    := (p_payload->'schedule'->>'bufferAfterMinutes')::int;

  IF v_sched_name   IS NULL
     OR v_sched_tz     IS NULL
     OR v_sched_active IS NULL
     OR v_slot_dur     IS NULL
     OR v_slot_int     IS NULL
     OR v_min_notice   IS NULL
     OR v_window_days  IS NULL
     OR v_buf_before   IS NULL
     OR v_buf_after    IS NULL
  THEN
    RAISE EXCEPTION 'availability: schedule has missing fields'
      USING ERRCODE = '23514';
  END IF;

  -- === 10.3 Payload shape validation =======================================
  -- Weekly rules must be objects with required fields.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_weekly) AS t(rule)
    WHERE jsonb_typeof(rule) <> 'object'
       OR rule->>'weekday' IS NULL
       OR rule->>'startTime' IS NULL
       OR rule->>'endTime' IS NULL
  ) THEN
    RAISE EXCEPTION 'availability: weekly rule has invalid shape'
      USING ERRCODE = '23514';
  END IF;

  -- Date overrides must be objects with required fields.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_overrides) AS t(ov)
    WHERE jsonb_typeof(ov) <> 'object'
       OR ov->>'kind' IS NULL
       OR ov->>'overrideDate' IS NULL
       OR jsonb_typeof(ov->'intervals') IS DISTINCT FROM 'array'
  ) THEN
    RAISE EXCEPTION 'availability: date override has invalid shape'
      USING ERRCODE = '23514';
  END IF;

  -- Unknown override kind is rejected before DML.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_overrides) AS t(ov)
    WHERE ov->>'kind' NOT IN ('unavailable', 'custom')
  ) THEN
    RAISE EXCEPTION 'availability: override kind must be unavailable or custom'
      USING ERRCODE = '23514';
  END IF;

  -- Unavailable overrides must have an empty intervals array.
  -- IS DISTINCT FROM catches missing/null/non-array values.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_overrides) AS t(ov)
    WHERE ov->>'kind' = 'unavailable'
      AND (
        jsonb_typeof(ov->'intervals') IS DISTINCT FROM 'array'
        OR jsonb_array_length(ov->'intervals') <> 0
      )
  ) THEN
    RAISE EXCEPTION 'availability: unavailable override requires an empty intervals array'
      USING ERRCODE = '23514';
  END IF;

  -- Custom overrides must have intervals as a non-empty array.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_overrides) AS t(ov)
    WHERE ov->>'kind' = 'custom'
      AND (
        jsonb_typeof(ov->'intervals') <> 'array'
        OR jsonb_array_length(ov->'intervals') = 0
      )
  ) THEN
    RAISE EXCEPTION 'availability: custom override requires at least one interval'
      USING ERRCODE = '23514';
  END IF;

  -- Custom interval objects must have startTime and endTime.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_overrides) AS t(ov),
         jsonb_array_elements(ov->'intervals') AS i(iv)
    WHERE ov->>'kind' = 'custom'
      AND (
        jsonb_typeof(iv) <> 'object'
        OR iv->>'startTime' IS NULL
        OR iv->>'endTime' IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'availability: custom interval has invalid shape'
      USING ERRCODE = '23514';
  END IF;

  -- === 10.4 Lock and verify default schedule ==============================
  SELECT id INTO v_schedule_id
  FROM public.availability_schedules
  WHERE is_default = true
  FOR UPDATE;

  IF v_schedule_id IS NULL THEN
    RAISE EXCEPTION 'default availability schedule is not seeded'
      USING ERRCODE = 'P0001';
  END IF;

  -- === 10.5 Update schedule row (CHECK constraints raise on bad values) ====
  UPDATE public.availability_schedules
  SET
    name                   = v_sched_name,
    timezone               = v_sched_tz,
    is_active              = v_sched_active,
    slot_duration_minutes  = v_slot_dur,
    slot_interval_minutes  = v_slot_int,
    minimum_notice_minutes = v_min_notice,
    booking_window_days    = v_window_days,
    buffer_before_minutes  = v_buf_before,
    buffer_after_minutes   = v_buf_after
  WHERE id = v_schedule_id;

  -- === 10.6 Replace child rows =============================================
  DELETE FROM public.availability_date_overrides
  WHERE schedule_id = v_schedule_id;

  DELETE FROM public.availability_weekly_rules
  WHERE schedule_id = v_schedule_id;

  -- === 10.7 Insert weekly rules ============================================
  IF jsonb_array_length(v_weekly) > 0 THEN
    INSERT INTO public.availability_weekly_rules
      (schedule_id, weekday, start_time, end_time, sort_order)
    SELECT
      v_schedule_id,
      (rule->>'weekday')::int,
      (rule->>'startTime')::time without time zone,
      (rule->>'endTime')::time without time zone,
      COALESCE((rule->>'sortOrder')::int, 0)
    FROM jsonb_array_elements(v_weekly) AS t(rule);
  END IF;

  -- === 10.8 Insert date overrides + intervals (null-safe) ==================
  IF jsonb_array_length(v_overrides) > 0 THEN
    WITH inserted_overrides AS (
      INSERT INTO public.availability_date_overrides
        (schedule_id, override_date, kind, reason)
      SELECT
        v_schedule_id,
        (ov->>'overrideDate')::date,
        ov->>'kind',
        NULLIF(ov->>'reason', '')
      FROM jsonb_array_elements(v_overrides) WITH ORDINALITY AS t(ov, ov_idx)
      RETURNING id, override_date, kind
    ),
    source_intervals AS (
      SELECT
        (ov->>'overrideDate')::date AS override_date,
        ov->'intervals'             AS intervals
      FROM jsonb_array_elements(v_overrides) WITH ORDINALITY AS t(ov, ov_idx)
    )
    INSERT INTO public.availability_date_override_intervals
      (override_id, start_time, end_time, sort_order)
    SELECT
      io.id,
      (iv->>'startTime')::time without time zone,
      (iv->>'endTime')::time without time zone,
      COALESCE((iv->>'sortOrder')::int, 0)
    FROM inserted_overrides io
    JOIN source_intervals si
      ON io.override_date = si.override_date
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN io.kind = 'custom'
          THEN COALESCE(si.intervals, '[]'::jsonb)
        ELSE '[]'::jsonb
      END
    ) WITH ORDINALITY AS i(iv, iv_idx);
  END IF;

  -- === 10.9 Defensive post-check: custom overrides without intervals =======
  SELECT count(*) INTO v_bad_custom_count
  FROM public.availability_date_overrides doh
  WHERE doh.schedule_id = v_schedule_id
    AND doh.kind = 'custom'
    AND NOT EXISTS (
      SELECT 1
      FROM public.availability_date_override_intervals iv
      WHERE iv.override_id = doh.id
    );

  IF v_bad_custom_count > 0 THEN
    RAISE EXCEPTION 'availability: % custom override(s) missing intervals',
      v_bad_custom_count
      USING ERRCODE = '23514';
  END IF;

  -- === 10.10 Success envelope ==============================================
  RETURN jsonb_build_object(
    'ok', true,
    'scheduleId', v_schedule_id
  );

EXCEPTION
  WHEN unique_violation        THEN RAISE;   -- 23505 → 409
  WHEN exclusion_violation     THEN RAISE;   -- 23P01 → 409
  WHEN check_violation         THEN RAISE;   -- 23514 → 400
  WHEN foreign_key_violation   THEN RAISE;   -- 23503 → 500
  WHEN invalid_text_representation THEN RAISE; -- 22P02 → 400
  WHEN invalid_datetime_format THEN RAISE;   -- 22007 → 400
  WHEN raise_exception         THEN RAISE;   -- P0001 → 500
  WHEN others                  THEN RAISE;   -- default → 500
END;
$$;

-- 11. RPC privileges ---------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.replace_availability_bundle(jsonb)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.replace_availability_bundle(jsonb)
  FROM PUBLIC, anon, authenticated;

-- 12. Backward-compatible default seed --------------------------------------
-- Matches the current homepage config exactly:
--   Monday    10:00–12:00  (weekday 0)
--   Tuesday   14:00–17:00  (weekday 1)
--   Thursday  10:00–15:00  (weekday 3)
--   slot_duration = 30, slot_interval = 45, buffers = 0
--   min notice = 24h, booking window = 14 days
--
-- The seed is idempotent: the CTE inserts the schedule only if no
-- default schedule exists; the weekly rules insert uses ON CONFLICT
-- on the natural key.
-- 1) Ensure the default schedule exists. If it already exists,
--    this INSERT does nothing and produces no result set.
INSERT INTO public.availability_schedules (
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
)
SELECT
  'Default audit availability',
  'Europe/Budapest',
  true,
  true,
  30,
  45,
  1440,
  14,
  0,
  0
WHERE NOT EXISTS (
  SELECT 1 FROM public.availability_schedules WHERE is_default = true
);

-- 2) Upsert the three default weekly rules independently.
--    This repairs a partially-seeded DB where the schedule row exists
--    but the weekly rules are missing.
INSERT INTO public.availability_weekly_rules
  (schedule_id, weekday, start_time, end_time, sort_order)
SELECT
  ds.id,
  v.weekday,
  v.start_time,
  v.end_time,
  0
FROM public.availability_schedules ds
CROSS JOIN (VALUES
  (0, TIME WITHOUT TIME ZONE '10:00', TIME WITHOUT TIME ZONE '12:00'),
  (1, TIME WITHOUT TIME ZONE '14:00', TIME WITHOUT TIME ZONE '17:00'),
  (3, TIME WITHOUT TIME ZONE '10:00', TIME WITHOUT TIME ZONE '15:00')
) AS v(weekday, start_time, end_time)
WHERE ds.is_default = true
ON CONFLICT (schedule_id, weekday, start_time, end_time) DO NOTHING;

COMMIT;
