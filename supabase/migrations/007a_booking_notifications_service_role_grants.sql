-- ============================================================
-- LocalUp Audit Booking — V1.3 Reminder System
-- Service role grants for booking_notifications.
--
-- The application backend uses the Supabase service-role key to
-- manage reminder records. This migration makes those grants
-- explicit and reproducible across environments.
-- ============================================================

BEGIN;

GRANT USAGE ON SCHEMA public
  TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.booking_notifications
  TO service_role;

COMMIT;
