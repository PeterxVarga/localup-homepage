-- ============================================================
-- Booking pricing index hardening
--
-- Adds covering indexes for the composite foreign keys created in
-- migration 015_configurable_booking_pricing.sql.
--
-- Supabase performance advisor flagged the following FKs as lacking a
-- matching left-prefix index on the referencing table:
--   * booking_service_option_groups(service_id, site_id)
--   * booking_service_options(option_group_id, service_id, site_id)
--
-- This is a normal, one-time, additive Supabase migration.
-- Do not apply directly to production.
-- ============================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_booking_service_option_groups_service_site_fk
  ON public.booking_service_option_groups (service_id, site_id);

CREATE INDEX IF NOT EXISTS idx_booking_service_options_group_service_site_fk
  ON public.booking_service_options (option_group_id, service_id, site_id);

COMMIT;
