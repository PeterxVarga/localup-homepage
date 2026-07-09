-- ============================================================
-- LocalUp Audit Booking — V1.3 Reminder System
-- Creates the booking_notifications queue table and atomic
-- claim/finalize RPC functions.
--
-- This migration does NOT create the Supabase Cron job itself.
-- Use supabase/cron/schedule-audit-reminders.sql after deploy.
-- ============================================================

BEGIN;

-- 1. Enable Vault extension for cron secret storage.
-- Safe to run if already enabled.
CREATE EXTENSION IF NOT EXISTS vault WITH SCHEMA vault;

-- 2. Notification queue table.
CREATE TABLE IF NOT EXISTS public.booking_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  booking_id uuid NOT NULL
    REFERENCES public.audit_bookings(id)
    ON DELETE CASCADE,

  notification_type text NOT NULL
    CHECK (notification_type IN ('reminder_24h', 'reminder_1h')),

  slot_version int NOT NULL,

  scheduled_for timestamptz NOT NULL,

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),

  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  locked_at timestamptz,
  lock_token uuid,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  admin_alerted_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Unique constraint prevents duplicate reminders for the same
--    booking, type, and slot version.
ALTER TABLE public.booking_notifications
  DROP CONSTRAINT IF EXISTS unique_booking_notification_slot_version;

ALTER TABLE public.booking_notifications
  ADD CONSTRAINT unique_booking_notification_slot_version
    UNIQUE (booking_id, notification_type, slot_version);

-- 4. Indexes.
DROP INDEX IF EXISTS idx_booking_notifications_due;
DROP INDEX IF EXISTS idx_booking_notifications_booking;

CREATE INDEX idx_booking_notifications_due
  ON public.booking_notifications (scheduled_for, status)
  WHERE status IN ('pending', 'failed');

CREATE INDEX idx_booking_notifications_booking
  ON public.booking_notifications (booking_id);

-- 5. Row Level Security: no anonymous or authenticated direct access.
ALTER TABLE public.booking_notifications ENABLE ROW LEVEL SECURITY;

-- 6. Atomic claim function.
--    Returns due reminders and marks them processing with a fresh lock_token.
CREATE OR REPLACE FUNCTION public.claim_due_reminders(
  p_batch_size int DEFAULT 20,
  p_processing_timeout_minutes int DEFAULT 15,
  p_max_attempts int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  booking_id uuid,
  notification_type text,
  slot_version int,
  scheduled_for timestamptz,
  attempts int,
  lock_token uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_timeout interval := make_interval(mins => p_processing_timeout_minutes);
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT bn.id
    FROM public.booking_notifications bn
    WHERE bn.attempts < p_max_attempts
      AND (
        -- Pending reminders whose time has come.
        (
          bn.status = 'pending'
          AND bn.scheduled_for <= now()
        )
        OR
        -- Failed reminders ready for retry.
        (
          bn.status = 'failed'
          AND bn.next_attempt_at IS NOT NULL
          AND bn.next_attempt_at <= now()
        )
        OR
        -- Stuck processing records whose lock has expired.
        (
          bn.status = 'processing'
          AND bn.locked_at IS NOT NULL
          AND bn.locked_at < now() - v_timeout
        )
      )
    ORDER BY bn.scheduled_for ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.booking_notifications bn
  SET
    status = 'processing',
    attempts = bn.attempts + 1,
    locked_at = now(),
    lock_token = gen_random_uuid(),
    updated_at = now()
  FROM due
  WHERE bn.id = due.id
  RETURNING bn.id, bn.booking_id, bn.notification_type, bn.slot_version, bn.scheduled_for, bn.attempts, bn.lock_token;
END;
$$;

-- 7. Finalize success function.
--    Only updates the row if it is still processing with the same lock_token.
CREATE OR REPLACE FUNCTION public.finalize_reminder_sent(
  p_notification_id uuid,
  p_lock_token uuid,
  p_provider_message_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.booking_notifications
  SET
    status = 'sent',
    sent_at = now(),
    provider_message_id = p_provider_message_id,
    lock_token = NULL,
    locked_at = NULL,
    last_error = NULL,
    updated_at = now()
  WHERE id = p_notification_id
    AND status = 'processing'
    AND lock_token = p_lock_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

-- 8. Finalize failure function.
--    Only updates the row if it is still processing with the same lock_token.
CREATE OR REPLACE FUNCTION public.finalize_reminder_failed(
  p_notification_id uuid,
  p_lock_token uuid,
  p_error text,
  p_next_attempt_at timestamptz,
  p_max_attempts int DEFAULT 5
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.booking_notifications
  SET
    status = 'failed',
    last_error = p_error,
    next_attempt_at = CASE
      WHEN attempts >= p_max_attempts THEN NULL
      ELSE p_next_attempt_at
    END,
    lock_token = NULL,
    locked_at = NULL,
    updated_at = now()
  WHERE id = p_notification_id
    AND status = 'processing'
    AND lock_token = p_lock_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

-- 9. Finalize cancelled function.
--    Terminates a reminder that should not be sent (e.g. booking cancelled,
--    slot changed, or appointment passed). Lock-token protected.
CREATE OR REPLACE FUNCTION public.finalize_reminder_cancelled(
  p_notification_id uuid,
  p_lock_token uuid,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.booking_notifications
  SET
    status = 'cancelled',
    last_error = p_reason,
    next_attempt_at = NULL,
    lock_token = NULL,
    locked_at = NULL,
    updated_at = now()
  WHERE id = p_notification_id
    AND status = 'processing'
    AND lock_token = p_lock_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

-- 10. Harden RPC functions: only service_role may call them.
REVOKE EXECUTE ON FUNCTION public.claim_due_reminders(int, int, int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_reminders(int, int, int)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.finalize_reminder_sent(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_reminder_sent(uuid, uuid, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.finalize_reminder_failed(uuid, uuid, text, timestamptz, int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_reminder_failed(uuid, uuid, text, timestamptz, int)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.finalize_reminder_cancelled(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_reminder_cancelled(uuid, uuid, text)
  TO service_role;

COMMIT;
