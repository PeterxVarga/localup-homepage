-- ============================================================
-- 006a_booking_status_contract_bridge.sql
-- Makes the status compatibility trigger bidirectional.
-- The application may stop writing the legacy `status` column.
-- ============================================================

BEGIN;

-- 1. Preflight: abort if any row has missing or inconsistent status fields.
DO $$
DECLARE
  missing_count int;
  inconsistent_count int;
BEGIN
  SELECT count(*)
  INTO missing_count
  FROM public.audit_bookings
  WHERE booking_status IS NULL
     OR calendar_sync_status IS NULL
     OR status IS NULL;

  IF missing_count > 0 THEN
    RAISE EXCEPTION
      'Found % audit_bookings rows with missing status fields.',
      missing_count;
  END IF;

  SELECT count(*)
  INTO inconsistent_count
  FROM public.audit_bookings
  WHERE status IS DISTINCT FROM CASE calendar_sync_status
    WHEN 'pending' THEN 'calendar_pending'
    WHEN 'synced'  THEN 'booked'
    WHEN 'failed'  THEN 'calendar_failed'
  END;

  IF inconsistent_count > 0 THEN
    RAISE EXCEPTION
      'Found % audit_bookings rows with inconsistent status pairs. Fix before applying bridge migration.',
      inconsistent_count;
  END IF;
END $$;

-- 2. Bidirectional compatibility trigger function.
CREATE OR REPLACE FUNCTION public.sync_audit_booking_status_compat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  status_changed boolean := false;
  sync_changed boolean := false;
  expected_legacy_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Legacy deployment compatibility.
    IF NEW.booking_status IS NULL THEN
      NEW.booking_status := 'booked';
    END IF;

    IF NEW.calendar_sync_status IS NULL
       AND NEW.status IS NULL THEN
      RAISE EXCEPTION
        'audit_bookings: either status or calendar_sync_status must be provided';
    END IF;

    IF NEW.calendar_sync_status IS NULL THEN
      NEW.calendar_sync_status := CASE NEW.status
        WHEN 'calendar_pending' THEN 'pending'
        WHEN 'booked'           THEN 'synced'
        WHEN 'calendar_failed'  THEN 'failed'
        ELSE NULL
      END;

      IF NEW.calendar_sync_status IS NULL THEN
        RAISE EXCEPTION
          'audit_bookings: invalid legacy status: %',
          NEW.status;
      END IF;
    END IF;

    IF NEW.status IS NULL THEN
      NEW.status := CASE NEW.calendar_sync_status
        WHEN 'pending' THEN 'calendar_pending'
        WHEN 'synced'  THEN 'booked'
        WHEN 'failed'  THEN 'calendar_failed'
        ELSE NULL
      END;

      IF NEW.status IS NULL THEN
        RAISE EXCEPTION
          'audit_bookings: invalid calendar_sync_status: %',
          NEW.calendar_sync_status;
      END IF;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Capture the original changes before mutating NEW.
    status_changed :=
      NEW.status IS DISTINCT FROM OLD.status;

    sync_changed :=
      NEW.calendar_sync_status
      IS DISTINCT FROM OLD.calendar_sync_status;

    -- Never modify booking_status during UPDATE.
    IF status_changed AND NOT sync_changed THEN
      NEW.calendar_sync_status := CASE NEW.status
        WHEN 'calendar_pending' THEN 'pending'
        WHEN 'booked'           THEN 'synced'
        WHEN 'calendar_failed'  THEN 'failed'
        ELSE NULL
      END;

      IF NEW.calendar_sync_status IS NULL THEN
        RAISE EXCEPTION
          'audit_bookings: invalid legacy status: %',
          NEW.status;
      END IF;

    ELSIF sync_changed AND NOT status_changed THEN
      NEW.status := CASE NEW.calendar_sync_status
        WHEN 'pending' THEN 'calendar_pending'
        WHEN 'synced'  THEN 'booked'
        WHEN 'failed'  THEN 'calendar_failed'
        ELSE NULL
      END;

      IF NEW.status IS NULL THEN
        RAISE EXCEPTION
          'audit_bookings: invalid calendar_sync_status: %',
          NEW.calendar_sync_status;
      END IF;
    END IF;
  END IF;

  -- Validate the final pair for both INSERT and UPDATE.
  expected_legacy_status := CASE NEW.calendar_sync_status
    WHEN 'pending' THEN 'calendar_pending'
    WHEN 'synced'  THEN 'booked'
    WHEN 'failed'  THEN 'calendar_failed'
    ELSE NULL
  END;

  IF expected_legacy_status IS NULL THEN
    RAISE EXCEPTION
      'audit_bookings: invalid calendar_sync_status: %',
      NEW.calendar_sync_status;
  END IF;

  IF NEW.status IS DISTINCT FROM expected_legacy_status THEN
    RAISE EXCEPTION
      'audit_bookings: inconsistent status pair: status=%, calendar_sync_status=%',
      NEW.status,
      NEW.calendar_sync_status;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Recreate the trigger so the new function body is bound.
DROP TRIGGER IF EXISTS audit_bookings_status_compat
  ON public.audit_bookings;

CREATE TRIGGER audit_bookings_status_compat
  BEFORE INSERT OR UPDATE ON public.audit_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_audit_booking_status_compat();

-- 4. Harden: do not let anonymous roles execute this internal function directly.
REVOKE EXECUTE ON FUNCTION public.sync_audit_booking_status_compat()
  FROM PUBLIC, anon, authenticated;

COMMIT;
