-- ============================================================
-- LocalUp Audit Booking — V3 RLS auto-enable hardening
-- ============================================================

-- The public.rls_auto_enable() event-trigger function is an internal
-- Supabase helper that automatically enables RLS on newly created tables.
-- It is executed by the database event trigger system, not by anon or
-- authenticated users. The default PUBLIC EXECUTE grant is unnecessary
-- and triggers a security advisor warning.
--
-- We revoke direct execution from PUBLIC, anon, and authenticated while
-- leaving the function and its owning event trigger intact.

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated;
