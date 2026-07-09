-- ============================================================
-- Backfill reminders for existing future booked+synced bookings.
-- Run this in Supabase SQL Editor after the application code is
-- deployed to production and the 007 migration is applied.
--
-- Idempotent: ON CONFLICT DO NOTHING.
-- Only creates reminders whose scheduled_for is in the future.
-- ============================================================

INSERT INTO public.booking_notifications (
  booking_id,
  notification_type,
  slot_version,
  scheduled_for,
  status
)
SELECT
  b.id,
  type.notification_type,
  b.reschedule_count AS slot_version,
  CASE type.notification_type
    WHEN 'reminder_24h' THEN b.selected_slot_start - interval '24 hours'
    WHEN 'reminder_1h'  THEN b.selected_slot_start - interval '1 hour'
  END AS scheduled_for,
  'pending'
FROM public.audit_bookings b
CROSS JOIN (
  VALUES
    ('reminder_24h'),
    ('reminder_1h')
) AS type(notification_type)
WHERE b.booking_status = 'booked'
  AND b.calendar_sync_status = 'synced'
  AND b.selected_slot_start > now()
  AND (
    CASE type.notification_type
      WHEN 'reminder_24h' THEN b.selected_slot_start - interval '24 hours'
      WHEN 'reminder_1h'  THEN b.selected_slot_start - interval '1 hour'
    END
  ) > now()
ON CONFLICT (booking_id, notification_type, slot_version) DO NOTHING;
