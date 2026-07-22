-- Booking Foundation — foreign-key indexes
-- Adds covering indexes reported by the Supabase performance advisor.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_availability_schedules_site
  ON public.availability_schedules (site_id);

CREATE INDEX IF NOT EXISTS idx_booking_services_schedule_site
  ON public.booking_services (schedule_id, site_id);

CREATE INDEX IF NOT EXISTS idx_audit_bookings_service_site
  ON public.audit_bookings (service_id, site_id);

COMMIT;
