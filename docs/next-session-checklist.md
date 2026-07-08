# Next Session Checklist — LocalUp Booking Flow

## Goal
Wire real infrastructure and run the first end-to-end booking flow.

## 1. Supabase

- [ ] Confirm Supabase project is active (project_ref: `kntokweoakxboijhsqzs`)
- [ ] Open Supabase SQL Editor
- [ ] Run `supabase/migrations/001_audit_booking.sql`
- [ ] Copy `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` into `.env`
- [ ] Verify connection from local dev (`astro dev`)
- [ ] Spot-check tables: `audit_bookings`, `booking_events`

## 2. Google Calendar

- [ ] Open Google Cloud Console
- [ ] Create or confirm OAuth 2.0 Web application Client ID
- [ ] Add authorized redirect URI: `https://developers.google.com/oauthplayground`
- [ ] Open [Google OAuth Playground](https://developers.google.com/oauthplayground)
- [ ] Select scope: `https://www.googleapis.com/auth/calendar`
- [ ] Generate and copy refresh token
- [ ] Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` in `.env`
- [ ] (Optional) Set `GOOGLE_CALENDAR_ID` if not using `primary`

## 3. Resend

- [ ] Log in to Resend
- [ ] Create API key
- [ ] Set `RESEND_API_KEY` in `.env`
- [ ] Verify sender domain or use `onboarding@resend.dev` for initial tests
- [ ] Set `ADMIN_EMAIL` in `.env`

## 4. Environment file

- [ ] Copy `.env.example` → `.env`
- [ ] Fill in all variables:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_REFRESH_TOKEN`
  - `GOOGLE_CALENDAR_ID`
  - `RESEND_API_KEY`
  - `ADMIN_EMAIL`
  - `SITE_URL` (local: `http://localhost:4321`)
- [ ] Confirm no secrets are checked into git

## 5. End-to-end tests

- [ ] Start local dev server
- [ ] Load `/audit` from homepage CTA with `cta_location=hero`
- [ ] Complete Step 1 (business details)
- [ ] Complete Step 2 (goals)
- [ ] Load Step 3 and confirm available slots appear
- [ ] Submit booking
- [ ] Check Supabase `audit_bookings` row is inserted with status `booked` or `calendar_failed`
- [ ] Check Google Calendar for the event
- [ ] Check user confirmation email
- [ ] Check admin notification email
- [ ] Check `booking_events` rows for `audit_flow_started`, `audit_booking_submitted`, `audit_booking_confirmed`

## 6. Failure-mode tests

- [ ] Try booking the same slot twice → expect `slot_taken` / 409
- [ ] Temporarily break Google credentials → expect booking status `calendar_failed`, slot still held
- [ ] Test mobile responsive layout on `/audit`

## 7. Deploy considerations

- [ ] Decide deploy target (Vercel / Node server / other)
- [ ] Switch adapter if needed (`@astrojs/vercel` vs `@astrojs/node`)
- [ ] Set production env vars on deploy host
- [ ] Verify `process.env` is used at runtime (see `docs/env-runtime-verification.md`)
