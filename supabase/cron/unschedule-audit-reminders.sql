-- ============================================================
-- Unschedule the audit reminders cron job.
-- Run this to temporarily disable reminders without affecting
-- the booking_notifications table or application code.
-- ============================================================

SELECT cron.unschedule('audit-reminders-every-5-minutes');
