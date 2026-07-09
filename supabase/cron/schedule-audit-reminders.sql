-- ============================================================
-- Schedule the audit reminders cron job.
-- Run this in Supabase SQL Editor after the application is deployed.
-- ============================================================

-- Ensure the cron extension is available.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_cron;

SELECT cron.schedule(
  'audit-reminders-every-5-minutes',
  '*/5 * * * *',
  $$
    SELECT
      net.http_post(
        url := (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'reminder_cron_url'
          LIMIT 1
        ),
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'reminder_cron_secret'
            LIMIT 1
          ),
          'Content-Type', 'application/json'
        )
      ) AS request_id;
  $$
);
