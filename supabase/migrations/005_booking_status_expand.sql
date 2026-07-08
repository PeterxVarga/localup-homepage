-- ============================================================
-- LocalUp Audit Booking — V1.1 Expand Migration
-- Adds new lifecycle + token columns, keeps old `status` column
-- for backward compatibility until a future contract migration.
-- ============================================================

BEGIN;

-- 1. Add new status, token, lifecycle, and meet-link columns (nullable first)
ALTER TABLE public.audit_bookings
  ADD COLUMN IF NOT EXISTS booking_status text,
  ADD COLUMN IF NOT EXISTS calendar_sync_status text,
  ADD COLUMN IF NOT EXISTS management_token_hash text,
  ADD COLUMN IF NOT EXISTS management_token_encrypted text,
  ADD COLUMN IF NOT EXISTS management_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS rescheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS reschedule_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS previous_slot_start timestamptz,
  ADD COLUMN IF NOT EXISTS previous_slot_end timestamptz,
  ADD COLUMN IF NOT EXISTS meet_link text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 2. Backfill existing rows from old `status` to new fields
UPDATE public.audit_bookings
SET
  booking_status = CASE
    WHEN status IN ('calendar_pending', 'booked', 'calendar_failed') THEN 'booked'
    ELSE status
  END,
  calendar_sync_status = CASE
    WHEN status = 'calendar_pending' THEN 'pending'
    WHEN status = 'booked' THEN 'synced'
    WHEN status = 'calendar_failed' THEN 'failed'
    ELSE 'pending'
  END,
  updated_at = now()
WHERE booking_status IS NULL
   OR calendar_sync_status IS NULL;

-- 3. Compatibility trigger:
--    Fills new status columns when old code only writes `status`.
--    Also syncs calendar_sync_status when old code updates `status`.
CREATE OR REPLACE FUNCTION public.sync_audit_booking_status_compat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.booking_status IS NULL THEN
      NEW.booking_status := 'booked';
    END IF;

    IF NEW.calendar_sync_status IS NULL THEN
      NEW.calendar_sync_status := CASE NEW.status
        WHEN 'calendar_pending' THEN 'pending'
        WHEN 'booked' THEN 'synced'
        WHEN 'calendar_failed' THEN 'failed'
        ELSE 'pending'
      END;
    END IF;

  ELSIF NEW.status IS DISTINCT FROM OLD.status
    AND NEW.calendar_sync_status
        IS NOT DISTINCT FROM OLD.calendar_sync_status THEN

    NEW.calendar_sync_status := CASE NEW.status
      WHEN 'calendar_pending' THEN 'pending'
      WHEN 'booked' THEN 'synced'
      WHEN 'calendar_failed' THEN 'failed'
      ELSE NEW.calendar_sync_status
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_bookings_status_compat
ON public.audit_bookings;

CREATE TRIGGER audit_bookings_status_compat
BEFORE INSERT OR UPDATE ON public.audit_bookings
FOR EACH ROW
EXECUTE FUNCTION public.sync_audit_booking_status_compat();

-- Harden: do not let anonymous roles execute this internal function directly
REVOKE EXECUTE ON FUNCTION public.sync_audit_booking_status_compat()
FROM PUBLIC, anon, authenticated;

-- 4. Now safe to enforce NOT NULL on new status columns
ALTER TABLE public.audit_bookings
  ALTER COLUMN booking_status SET NOT NULL,
  ALTER COLUMN calendar_sync_status SET NOT NULL;

-- 5. CHECK constraints for new statuses
ALTER TABLE public.audit_bookings
  DROP CONSTRAINT IF EXISTS audit_bookings_booking_status_check,
  ADD CONSTRAINT audit_bookings_booking_status_check
    CHECK (booking_status IN ('pending', 'booked', 'cancelled', 'completed', 'no_show'));

ALTER TABLE public.audit_bookings
  DROP CONSTRAINT IF EXISTS audit_bookings_calendar_sync_status_check,
  ADD CONSTRAINT audit_bookings_calendar_sync_status_check
    CHECK (calendar_sync_status IN ('pending', 'synced', 'failed'));

-- 6. Token bundle consistency:
--    all three fields are either NULL together or all set together
ALTER TABLE public.audit_bookings
  DROP CONSTRAINT IF EXISTS audit_bookings_management_token_bundle_check,
  ADD CONSTRAINT audit_bookings_management_token_bundle_check
    CHECK (
      (
        management_token_hash IS NULL
        AND management_token_encrypted IS NULL
        AND management_token_expires_at IS NULL
      )
      OR
      (
        management_token_hash IS NOT NULL
        AND management_token_encrypted IS NOT NULL
        AND management_token_expires_at IS NOT NULL
      )
    );

-- 7. Token expiry must be after the slot end
ALTER TABLE public.audit_bookings
  DROP CONSTRAINT IF EXISTS audit_bookings_management_token_expiry_check,
  ADD CONSTRAINT audit_bookings_management_token_expiry_check
    CHECK (
      management_token_expires_at IS NULL
      OR management_token_expires_at > selected_slot_end
    );

-- 8. Reschedule count cannot be negative
ALTER TABLE public.audit_bookings
  DROP CONSTRAINT IF EXISTS audit_bookings_reschedule_count_check,
  ADD CONSTRAINT audit_bookings_reschedule_count_check
    CHECK (reschedule_count >= 0);

-- 9. Cancelled booking must have a cancellation timestamp
ALTER TABLE public.audit_bookings
  DROP CONSTRAINT IF EXISTS audit_bookings_cancelled_at_check,
  ADD CONSTRAINT audit_bookings_cancelled_at_check
    CHECK (
      booking_status <> 'cancelled'
      OR cancelled_at IS NOT NULL
    );

-- 10. Drop old partial unique index and create new one based on booking_status only
DROP INDEX IF EXISTS unique_audit_booking_slot;
DROP INDEX IF EXISTS unique_audit_booking_active_slot;

CREATE UNIQUE INDEX unique_audit_booking_active_slot
  ON public.audit_bookings (selected_slot_start)
  WHERE booking_status IN ('pending', 'booked');

-- 11. Unique index on management token hash
DROP INDEX IF EXISTS unique_audit_booking_token_hash;
CREATE UNIQUE INDEX unique_audit_booking_token_hash
  ON public.audit_bookings (management_token_hash)
  WHERE management_token_hash IS NOT NULL;

-- 12. Trigger to auto-update `updated_at`
CREATE OR REPLACE FUNCTION public.set_audit_booking_updated_at()
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

DROP TRIGGER IF EXISTS audit_bookings_updated_at ON public.audit_bookings;
CREATE TRIGGER audit_bookings_updated_at
  BEFORE UPDATE ON public.audit_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_audit_booking_updated_at();

-- Harden the updated_at trigger function too
REVOKE EXECUTE ON FUNCTION public.set_audit_booking_updated_at()
FROM PUBLIC, anon, authenticated;

COMMIT;
