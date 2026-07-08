-- ============================================================
-- LocalUp Audit Booking — V4 Service Role Grants
-- ============================================================

-- The service_role key (used by the Astro backend) needs explicit
-- table-level grants. Without these, Supabase returns:
--   permission denied for table audit_bookings (code 42501)
-- even though RLS is bypassed by the service role key.

GRANT USAGE ON SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.audit_bookings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_events TO service_role;
