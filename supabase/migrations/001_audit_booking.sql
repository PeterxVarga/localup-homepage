-- ============================================================
-- LocalUp Audit Booking — V1 Supabase Migration
-- Run this in the Supabase SQL Editor or via Supabase CLI
-- ============================================================

-- 1. audit_bookings table
CREATE TABLE IF NOT EXISTS audit_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Step 1: Business basics
  business_name TEXT NOT NULL,
  website_url TEXT,
  no_website BOOLEAN DEFAULT FALSE,
  city TEXT NOT NULL,
  business_type TEXT NOT NULL,

  -- Step 2: Goals
  goals JSONB NOT NULL,
  notes TEXT,

  -- Step 3: Contact + slot
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  selected_slot_start TIMESTAMPTZ NOT NULL,
  selected_slot_end TIMESTAMPTZ NOT NULL,

  -- Google Calendar
  google_calendar_event_id TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'calendar_pending',
  -- calendar_pending | booked | calendar_failed | cancelled | completed | no_show

  -- Future-compatible fields
  booking_type TEXT NOT NULL DEFAULT 'localup_audit',
  source TEXT NOT NULL DEFAULT 'website',
  funnel TEXT NOT NULL DEFAULT 'audit',
  session_id UUID,

  -- Tracking
  source_url TEXT,
  cta_location TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_audit_bookings_email ON audit_bookings(email);
CREATE INDEX IF NOT EXISTS idx_audit_bookings_status ON audit_bookings(status);
CREATE INDEX IF NOT EXISTS idx_audit_bookings_slot ON audit_bookings(selected_slot_start);

-- Race condition protection: same slot cannot be booked twice by active bookings
CREATE UNIQUE INDEX IF NOT EXISTS unique_audit_booking_slot
  ON audit_bookings(selected_slot_start)
  WHERE status IN ('calendar_pending', 'booked', 'calendar_failed');

-- 2. booking_events table
CREATE TABLE IF NOT EXISTS booking_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  booking_id UUID REFERENCES audit_bookings(id),
  event_name TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_events_session ON booking_events(session_id);
CREATE INDEX IF NOT EXISTS idx_booking_events_booking ON booking_events(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_events_name ON booking_events(event_name);

-- 3. Row Level Security (optional V1 — enable for production)
-- ALTER TABLE audit_bookings ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE booking_events ENABLE ROW LEVEL SECURITY;
