-- ============================================================
-- Generic Booking Email Config — tenant-aware notification setup
--
-- Adds:
--   * public.site_email_configs  (one active config per site)
--   * public.generic_booking_notifications (sent/failed queue)
--
-- Constraints:
--   * exactly one active config per site (partial unique index)
--   * trimmed non-empty email fields and site_url
--   * locale restricted to hu/en
--   * site_url must be HTTPS
--
-- Security:
--   * RLS enabled, no policies for anon/authenticated
--   * service_role has full CRUD
--
-- This migration does NOT seed any tenant email config.
-- ============================================================

BEGIN;

-- ----------------------------------------------------------------
-- 1. site_email_configs
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.site_email_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  display_name text NOT NULL,
  notification_email text NOT NULL,
  reply_to_email text NOT NULL,
  site_url text NOT NULL,
  locale text NOT NULL DEFAULT 'hu',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT site_email_configs_site_id_fk
    FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT,
  CONSTRAINT site_email_configs_display_name_not_empty_check
    CHECK (length(trim(display_name)) > 0),
  CONSTRAINT site_email_configs_notification_email_not_empty_check
    CHECK (length(trim(notification_email)) > 0),
  CONSTRAINT site_email_configs_reply_to_email_not_empty_check
    CHECK (length(trim(reply_to_email)) > 0),
  CONSTRAINT site_email_configs_site_url_not_empty_check
    CHECK (length(trim(site_url)) > 0),
  CONSTRAINT site_email_configs_locale_check
    CHECK (locale IN ('hu', 'en')),
  CONSTRAINT site_email_configs_site_url_https_check
    CHECK (site_url ~ '^https://')
);

ALTER TABLE public.site_email_configs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.site_email_configs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.site_email_configs TO service_role;

DROP TRIGGER IF EXISTS site_email_configs_touch ON public.site_email_configs;
CREATE TRIGGER site_email_configs_touch
  BEFORE UPDATE ON public.site_email_configs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Exactly one active config per site.
DROP INDEX IF EXISTS idx_site_email_configs_active_unique;
CREATE UNIQUE INDEX idx_site_email_configs_active_unique
  ON public.site_email_configs (site_id)
  WHERE is_active = true;

-- ----------------------------------------------------------------
-- 2. generic_booking_notifications
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.generic_booking_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL,
  notification_type text NOT NULL,
  recipient_type text NOT NULL,
  event_key text NOT NULL,
  recipient_email text NOT NULL,
  delivery_status text NOT NULL DEFAULT 'pending',
  provider_message_id text,
  attempt_count int NOT NULL DEFAULT 0,
  last_error_code text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT generic_booking_notifications_booking_id_fk
    FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE,
  CONSTRAINT generic_booking_notifications_type_check
    CHECK (notification_type IN ('confirmation', 'cancellation', 'reschedule')),
  CONSTRAINT generic_booking_notifications_recipient_type_check
    CHECK (recipient_type IN ('customer', 'admin')),
  CONSTRAINT generic_booking_notifications_event_key_not_empty_check
    CHECK (length(trim(event_key)) > 0),
  CONSTRAINT generic_booking_notifications_delivery_status_check
    CHECK (delivery_status IN ('pending', 'sent', 'failed')),
  CONSTRAINT generic_booking_notifications_recipient_email_not_empty_check
    CHECK (length(trim(recipient_email)) > 0),
  CONSTRAINT generic_booking_notifications_attempt_count_check
    CHECK (attempt_count >= 0)
);

-- Prevent duplicate sends for the same booking/type/recipient/event version.
ALTER TABLE public.generic_booking_notifications
  DROP CONSTRAINT IF EXISTS generic_booking_notifications_unique_send;

ALTER TABLE public.generic_booking_notifications
  ADD CONSTRAINT generic_booking_notifications_unique_send
    UNIQUE (booking_id, notification_type, recipient_type, event_key);

DROP INDEX IF EXISTS idx_generic_booking_notifications_booking;
CREATE INDEX idx_generic_booking_notifications_booking
  ON public.generic_booking_notifications (booking_id);

DROP INDEX IF EXISTS idx_generic_booking_notifications_status;
CREATE INDEX idx_generic_booking_notifications_status
  ON public.generic_booking_notifications (delivery_status, attempt_count);

ALTER TABLE public.generic_booking_notifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.generic_booking_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.generic_booking_notifications TO service_role;

DROP TRIGGER IF EXISTS generic_booking_notifications_touch ON public.generic_booking_notifications;
CREATE TRIGGER generic_booking_notifications_touch
  BEFORE UPDATE ON public.generic_booking_notifications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ----------------------------------------------------------------
-- 3. service_role schema grant
-- ----------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO service_role;

COMMIT;
