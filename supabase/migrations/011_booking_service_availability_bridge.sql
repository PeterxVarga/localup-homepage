-- ============================================================
-- Booking Service Availability Bridge (011)
-- ============================================================
--
-- Keeps the replace_availability_bundle(jsonb) RPC contract unchanged for the
-- dashboard, but atomically syncs the timing fields to the linked
-- localup_audit booking service row.
--
-- The public application contract of replace_availability_bundle does not
-- change. No new public RPC is introduced.
--
-- Fail-closed:
--   * Exactly one active localup_audit booking service must be linked to
--     the default schedule. Missing or ambiguous service raises P0001.
--   * The timing columns on booking_services are updated with the same
--     values written to availability_schedules.
-- ============================================================

BEGIN;

-- Redefine the existing RPC with the same signature plus the service sync.
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
  v_service_id         uuid;
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

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_overrides) AS t(ov)
    WHERE ov->>'kind' NOT IN ('unavailable', 'custom')
  ) THEN
    RAISE EXCEPTION 'availability: override kind must be unavailable or custom'
      USING ERRCODE = '23514';
  END IF;

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

  -- === 10.4b Lock and verify the linked booking service ====================
  -- One active localup_audit service must belong to the locked schedule.
  -- The cursor FOR UPDATE locks the matching row(s) so the count/check
  -- and the subsequent UPDATE are concurrency-safe.
  DECLARE
    svc_cursor CURSOR FOR
      SELECT bs.id
      FROM public.booking_services bs
      JOIN public.sites s ON s.id = bs.site_id
      WHERE bs.schedule_id = v_schedule_id
        AND s.slug = 'localup'
        AND bs.slug = 'localup_audit'
        AND bs.is_active = true
        AND s.is_active = true
      FOR UPDATE OF bs;
    svc_row record;
  BEGIN
    OPEN svc_cursor;
    FETCH svc_cursor INTO svc_row;

    IF NOT FOUND THEN
      CLOSE svc_cursor;
      RAISE EXCEPTION 'availability: no active localup_audit booking service linked to schedule %', v_schedule_id
        USING ERRCODE = 'P0001';
    END IF;

    v_service_id := svc_row.id;
    FETCH svc_cursor INTO svc_row;

    IF FOUND THEN
      CLOSE svc_cursor;
      RAISE EXCEPTION 'availability: multiple localup_audit booking services linked to schedule %', v_schedule_id
        USING ERRCODE = 'P0001';
    END IF;

    CLOSE svc_cursor;
  END;

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

  -- === 10.5b Sync linked booking service ===================================
  UPDATE public.booking_services
  SET
    duration_minutes         = v_slot_dur,
    slot_interval_minutes    = v_slot_int,
    minimum_notice_minutes   = v_min_notice,
    booking_window_days      = v_window_days,
    buffer_before_minutes    = v_buf_before,
    buffer_after_minutes     = v_buf_after,
    updated_at               = now()
  WHERE id = v_service_id;

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
  WHEN unique_violation        THEN RAISE;
  WHEN exclusion_violation     THEN RAISE;
  WHEN check_violation         THEN RAISE;
  WHEN foreign_key_violation   THEN RAISE;
  WHEN invalid_text_representation THEN RAISE;
  WHEN invalid_datetime_format THEN RAISE;
  WHEN raise_exception         THEN RAISE;
  WHEN others                  THEN RAISE;
END;
$$;

-- 11. RPC privileges ---------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.replace_availability_bundle(jsonb)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.replace_availability_bundle(jsonb)
  FROM PUBLIC, anon, authenticated;

COMMIT;
