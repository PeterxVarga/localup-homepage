# 006 Booking Status Contract Plan

Three-phase removal of the legacy `status` column and the compatibility layer introduced in `005_booking_status_expand.sql`.

## Context

Migration `005_booking_status_expand.sql` added the new lifecycle fields:

- `booking_status`
- `calendar_sync_status`
- `management_token_hash`
- `management_token_encrypted`
- `management_token_expires_at`
- `reschedule_count`
- `cancelled_at`

It kept the old `status` column and added a compatibility trigger (`audit_bookings_status_compat`) plus a helper function (`sync_audit_booking_status_compat`). The trigger originally only propagated from the legacy `status` column to the new fields, so that old code instances could coexist during deploy.

The application currently writes the legacy `status` field through an isolated mapper (`legacyStatusMapper.ts`) while all reads, queries, conditions, and business decisions use only the new fields.

This plan removes the legacy column in three safe phases.

## Goal

End state:

- Only `booking_status` and `calendar_sync_status` are used for reads, queries, conditions, and business logic.
- The legacy `status` column, its trigger, its function, and its index are removed.
- No dual-write in application code.
- A clean rollback path exists at every step until the final `DROP COLUMN`.

## Preconditions before starting Phase B1

All of these must be true before Phase B1 begins:

- [ ] The latest production version (`3706d71` or later) is stable.
- [ ] At least one new booking succeeded end-to-end in production after the calendar-deletion fix.
- [ ] At least one cancellation succeeded in production after the fix.
- [ ] At least one reschedule succeeded in production after the fix.
- [ ] No rows with `calendar_sync_status = 'failed'` remain unhandled.
- [ ] No relevant Vercel runtime errors in the last 48 hours.
- [ ] Resend emails are being delivered successfully.
- [ ] At least 48 hours have passed since `3706d71` was deployed.

---

## Phase B1 — Bridge migration: bidirectional compatibility trigger

### Objective

Make the compatibility trigger bidirectional so that the next application version can stop writing the legacy `status` column entirely, while the column remains `NOT NULL` and stays in sync for rollback safety.

### What changes in the database

- Replace the trigger function `sync_audit_booking_status_compat()` with a bidirectional version.
- The trigger must still support:
  - legacy `status` change → new `calendar_sync_status` (old behaviour, for rollback to pre-Phase B2 code)
  - `calendar_sync_status` change → legacy `status` (new bridge behaviour, for forward migration)
- Validate consistency for all allowed pairs and reject invalid input explicitly.
- No column, index, constraint, trigger, or function is deleted yet.

### Final `006a_booking_status_contract_bridge.sql`

```sql
-- ============================================================
-- 006a_booking_status_contract_bridge.sql
-- Makes the status compatibility trigger bidirectional.
-- The application may stop writing the legacy `status` column.
-- ============================================================

BEGIN;

-- 1. Preflight: abort if any row has missing or inconsistent status fields.
DO $$
DECLARE
  missing_count int;
  inconsistent_count int;
BEGIN
  SELECT count(*)
  INTO missing_count
  FROM public.audit_bookings
  WHERE booking_status IS NULL
     OR calendar_sync_status IS NULL
     OR status IS NULL;

  IF missing_count > 0 THEN
    RAISE EXCEPTION
      'Found % audit_bookings rows with missing status fields.',
      missing_count;
  END IF;

  SELECT count(*)
  INTO inconsistent_count
  FROM public.audit_bookings
  WHERE status IS DISTINCT FROM CASE calendar_sync_status
    WHEN 'pending' THEN 'calendar_pending'
    WHEN 'synced'  THEN 'booked'
    WHEN 'failed'  THEN 'calendar_failed'
  END;

  IF inconsistent_count > 0 THEN
    RAISE EXCEPTION
      'Found % audit_bookings rows with inconsistent status pairs. Fix before applying bridge migration.',
      inconsistent_count;
  END IF;
END $$;

-- 2. Bidirectional compatibility trigger function.
CREATE OR REPLACE FUNCTION public.sync_audit_booking_status_compat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  status_changed boolean := false;
  sync_changed boolean := false;
  expected_legacy_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Legacy deployment compatibility.
    IF NEW.booking_status IS NULL THEN
      NEW.booking_status := 'booked';
    END IF;

    IF NEW.calendar_sync_status IS NULL
       AND NEW.status IS NULL THEN
      RAISE EXCEPTION
        'audit_bookings: either status or calendar_sync_status must be provided';
    END IF;

    IF NEW.calendar_sync_status IS NULL THEN
      NEW.calendar_sync_status := CASE NEW.status
        WHEN 'calendar_pending' THEN 'pending'
        WHEN 'booked'           THEN 'synced'
        WHEN 'calendar_failed'  THEN 'failed'
        ELSE NULL
      END;

      IF NEW.calendar_sync_status IS NULL THEN
        RAISE EXCEPTION
          'audit_bookings: invalid legacy status: %',
          NEW.status;
      END IF;
    END IF;

    IF NEW.status IS NULL THEN
      NEW.status := CASE NEW.calendar_sync_status
        WHEN 'pending' THEN 'calendar_pending'
        WHEN 'synced'  THEN 'booked'
        WHEN 'failed'  THEN 'calendar_failed'
        ELSE NULL
      END;

      IF NEW.status IS NULL THEN
        RAISE EXCEPTION
          'audit_bookings: invalid calendar_sync_status: %',
          NEW.calendar_sync_status;
      END IF;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Capture the original changes before mutating NEW.
    status_changed :=
      NEW.status IS DISTINCT FROM OLD.status;

    sync_changed :=
      NEW.calendar_sync_status
      IS DISTINCT FROM OLD.calendar_sync_status;

    -- Never modify booking_status during UPDATE.
    IF status_changed AND NOT sync_changed THEN
      NEW.calendar_sync_status := CASE NEW.status
        WHEN 'calendar_pending' THEN 'pending'
        WHEN 'booked'           THEN 'synced'
        WHEN 'calendar_failed'  THEN 'failed'
        ELSE NULL
      END;

      IF NEW.calendar_sync_status IS NULL THEN
        RAISE EXCEPTION
          'audit_bookings: invalid legacy status: %',
          NEW.status;
      END IF;

    ELSIF sync_changed AND NOT status_changed THEN
      NEW.status := CASE NEW.calendar_sync_status
        WHEN 'pending' THEN 'calendar_pending'
        WHEN 'synced'  THEN 'booked'
        WHEN 'failed'  THEN 'calendar_failed'
        ELSE NULL
      END;

      IF NEW.status IS NULL THEN
        RAISE EXCEPTION
          'audit_bookings: invalid calendar_sync_status: %',
          NEW.calendar_sync_status;
      END IF;
    END IF;
  END IF;

  -- Validate the final pair for both INSERT and UPDATE.
  expected_legacy_status := CASE NEW.calendar_sync_status
    WHEN 'pending' THEN 'calendar_pending'
    WHEN 'synced'  THEN 'booked'
    WHEN 'failed'  THEN 'calendar_failed'
    ELSE NULL
  END;

  IF expected_legacy_status IS NULL THEN
    RAISE EXCEPTION
      'audit_bookings: invalid calendar_sync_status: %',
      NEW.calendar_sync_status;
  END IF;

  IF NEW.status IS DISTINCT FROM expected_legacy_status THEN
    RAISE EXCEPTION
      'audit_bookings: inconsistent status pair: status=%, calendar_sync_status=%',
      NEW.status,
      NEW.calendar_sync_status;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Recreate the trigger so the new function body is bound.
DROP TRIGGER IF EXISTS audit_bookings_status_compat
  ON public.audit_bookings;

CREATE TRIGGER audit_bookings_status_compat
  BEFORE INSERT OR UPDATE ON public.audit_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_audit_booking_status_compat();

-- 4. Harden: do not let anonymous roles execute this internal function directly.
REVOKE EXECUTE ON FUNCTION public.sync_audit_booking_status_compat()
  FROM PUBLIC, anon, authenticated;

COMMIT;
```

### Deploy and validation

1. Create `supabase/migrations/006a_booking_status_contract_bridge.sql`.
2. Apply the migration to Supabase.
3. Deploy the current application code (no application code changes in B1).
4. Run the preflight SQL and confirm it returns `0`:

```sql
SELECT
  id,
  status,
  calendar_sync_status
FROM public.audit_bookings
WHERE status IS DISTINCT FROM CASE calendar_sync_status
  WHEN 'pending' THEN 'calendar_pending'
  WHEN 'synced'  THEN 'booked'
  WHEN 'failed'  THEN 'calendar_failed'
END;
```

5. Run the required trigger tests in a transaction (roll back after each test):

```sql
-- Test 1: old-style INSERT with only legacy status
BEGIN;
INSERT INTO public.audit_bookings (
  business_name, no_website, city, business_type, goals,
  name, email, selected_slot_start, selected_slot_end,
  status, management_token_hash, management_token_encrypted,
  management_token_expires_at, session_id
) VALUES (
  'Bridge Test 1', true, 'Budapest', 'Other', ARRAY['more_visibility']::text[],
  'Test', 'test@example.com', '2030-01-01T10:00:00Z', '2030-01-01T10:30:00Z',
  'booked', 'hash1', 'enc1', '2030-02-01T10:30:00Z', 'sess1'
);
SELECT status, booking_status, calendar_sync_status FROM public.audit_bookings WHERE management_token_hash = 'hash1';
ROLLBACK;
-- Expected: status=booked, booking_status=booked, calendar_sync_status=synced

-- Test 2: new-style INSERT without legacy status
BEGIN;
INSERT INTO public.audit_bookings (
  business_name, no_website, city, business_type, goals,
  name, email, selected_slot_start, selected_slot_end,
  booking_status, calendar_sync_status, management_token_hash,
  management_token_encrypted, management_token_expires_at, session_id
) VALUES (
  'Bridge Test 2', true, 'Budapest', 'Other', ARRAY['more_visibility']::text[],
  'Test', 'test@example.com', '2030-01-01T11:00:00Z', '2030-01-01T11:30:00Z',
  'booked', 'synced', 'hash2', 'enc2', '2030-02-01T11:30:00Z', 'sess2'
);
SELECT status, booking_status, calendar_sync_status FROM public.audit_bookings WHERE management_token_hash = 'hash2';
ROLLBACK;
-- Expected: status=booked, booking_status=booked, calendar_sync_status=synced

-- Test 3: inconsistent INSERT must fail
BEGIN;
DO $$
BEGIN
  INSERT INTO public.audit_bookings (
    business_name, no_website, city, business_type, goals,
    name, email, selected_slot_start, selected_slot_end,
    booking_status, calendar_sync_status, status,
    management_token_hash, management_token_encrypted,
    management_token_expires_at, session_id
  ) VALUES (
    'Bridge Test 3', true, 'Budapest', 'Other', ARRAY['more_visibility']::text[],
    'Test', 'test@example.com', '2030-01-01T12:00:00Z', '2030-01-01T12:30:00Z',
    'booked', 'synced', 'calendar_failed', 'hash3', 'enc3',
    '2030-02-01T12:30:00Z', 'sess3'
  );
  RAISE EXCEPTION 'Expected insert to fail';
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM = 'Expected insert to fail' THEN
      RAISE;
    END IF;
    -- trigger exception caught, test passes
END;
$$;
ROLLBACK;

-- Test 4: old-style UPDATE of legacy status
BEGIN;
INSERT INTO public.audit_bookings (
  business_name, no_website, city, business_type, goals,
  name, email, selected_slot_start, selected_slot_end,
  booking_status, calendar_sync_status, status,
  management_token_hash, management_token_encrypted,
  management_token_expires_at, session_id
) VALUES (
  'Bridge Test 4', true, 'Budapest', 'Other', ARRAY['more_visibility']::text[],
  'Test', 'test@example.com', '2030-01-01T13:00:00Z', '2030-01-01T13:30:00Z',
  'booked', 'synced', 'booked', 'hash4', 'enc4',
  '2030-02-01T13:30:00Z', 'sess4'
);
UPDATE public.audit_bookings SET status = 'calendar_failed' WHERE management_token_hash = 'hash4';
SELECT status, booking_status, calendar_sync_status FROM public.audit_bookings WHERE management_token_hash = 'hash4';
ROLLBACK;
-- Expected: status=calendar_failed, booking_status=booked, calendar_sync_status=failed

-- Test 5: new-style UPDATE of calendar_sync_status
BEGIN;
INSERT INTO public.audit_bookings (
  business_name, no_website, city, business_type, goals,
  name, email, selected_slot_start, selected_slot_end,
  booking_status, calendar_sync_status, status,
  management_token_hash, management_token_encrypted,
  management_token_expires_at, session_id
) VALUES (
  'Bridge Test 5', true, 'Budapest', 'Other', ARRAY['more_visibility']::text[],
  'Test', 'test@example.com', '2030-01-01T14:00:00Z', '2030-01-01T14:30:00Z',
  'booked', 'synced', 'booked', 'hash5', 'enc5',
  '2030-02-01T14:30:00Z', 'sess5'
);
UPDATE public.audit_bookings SET calendar_sync_status = 'failed' WHERE management_token_hash = 'hash5';
SELECT status, booking_status, calendar_sync_status FROM public.audit_bookings WHERE management_token_hash = 'hash5';
ROLLBACK;
-- Expected: status=calendar_failed, booking_status=booked, calendar_sync_status=failed

-- Test 6: booking_status=cancelled must not be overwritten
BEGIN;
INSERT INTO public.audit_bookings (
  business_name, no_website, city, business_type, goals,
  name, email, selected_slot_start, selected_slot_end,
  booking_status, calendar_sync_status, status,
  management_token_hash, management_token_encrypted,
  management_token_expires_at, session_id
) VALUES (
  'Bridge Test 6', true, 'Budapest', 'Other', ARRAY['more_visibility']::text[],
  'Test', 'test@example.com', '2030-01-01T15:00:00Z', '2030-01-01T15:30:00Z',
  'cancelled', 'synced', 'booked', 'hash6', 'enc6',
  '2030-02-01T15:30:00Z', 'sess6'
);
UPDATE public.audit_bookings SET calendar_sync_status = 'failed' WHERE management_token_hash = 'hash6';
SELECT status, booking_status, calendar_sync_status FROM public.audit_bookings WHERE management_token_hash = 'hash6';
ROLLBACK;
-- Expected: status=calendar_failed, booking_status=cancelled, calendar_sync_status=failed
```

6. Production smoke test:
   - Create a booking without the application writing `status`.
   - Verify the legacy `status` column is automatically populated by the trigger.
   - Cancel/reschedule and verify all three status fields stay consistent.

### Rollback — Phase B1

Simple Vercel rollback to the previous commit. The trigger change is backward-compatible: old code writing `status` still works, and new code not writing `status` also works.

If the trigger itself causes issues, revert the migration by restoring the original trigger function body from `005_booking_status_expand.sql`.

---

## Phase B2 — Application code cleanup

### Objective

Remove every legacy `status` write from the application. The DB bridge trigger keeps the legacy column in sync.

### Code changes

1. **Delete `src/lib/booking/legacyStatusMapper.ts`**
   - Remove the file entirely.

2. **`src/lib/booking/createBooking.ts`**
   - Remove `import { toLegacyStatus } from './legacyStatusMapper';`.
   - Remove the `status: toLegacyStatus(...)` line from the insert payload.
   - Remove the `status: toLegacyStatus(...)` line from `updateBookingCalendarSync`.

3. **`src/lib/booking/rescheduleBooking.ts`**
   - Remove `import { toLegacyStatus } from './legacyStatusMapper';`.
   - Remove all `status: toLegacyStatus(...)` lines from update payloads.

4. **Audit**
   - Run the search commands from Phase A again.
   - Confirm that no production code writes the legacy `status` column.

### Files changed

- `src/lib/booking/legacyStatusMapper.ts` (deleted)
- `src/lib/booking/createBooking.ts`
- `src/lib/booking/rescheduleBooking.ts`

### Proposed diff (summary)

```diff
- import { toLegacyStatus } from './legacyStatusMapper';

  .insert({
    ...
    booking_status: 'booked',
    calendar_sync_status: 'pending',
-   status: toLegacyStatus('pending'),
    ...
  })
```

```diff
  .update({
    calendar_sync_status: calendarSyncStatus,
-   status: toLegacyStatus(calendarSyncStatus),
    ...
  })
```

### Deploy and validation

1. Deploy the Phase B2 commit to production.
2. Run production smoke tests:
   - Create a booking.
   - Verify `booking_status = 'booked'`, `calendar_sync_status = 'synced'`, and `status = 'booked'` (set by trigger).
   - Reschedule a booking.
   - Verify `status` follows `calendar_sync_status` via the trigger.
   - Cancel a booking.
   - Verify `booking_status = 'cancelled'` and legacy `status` stays at last sync state.
3. Run the consistency SQL:

```sql
SELECT
  booking_status,
  calendar_sync_status,
  status,
  count(*)
FROM public.audit_bookings
GROUP BY booking_status, calendar_sync_status, status
ORDER BY booking_status, calendar_sync_status, status;
```

Expected main combinations:

```text
booked    | synced | booked
cancelled | synced | booked
```

4. Monitor for 24–48 hours.

### Rollback — Phase B2

Simple Vercel rollback to the previous commit. The previous commit writes `status` explicitly, and the B1 bidirectional trigger handles it correctly.

---

## Phase B3 — Final contract migration

### Objective

Remove the legacy `status` column, its trigger, its function, its constraint, and its index from the database.

### Preconditions before Phase B3

All of these must be true in addition to the initial preconditions:

- [ ] Phase B2 has been in production for at least 48 hours without issues.
- [ ] A codebase-wide search confirms no production code references the `status` column.
- [ ] A codebase-wide search confirms no production code references `sync_audit_booking_status_compat`.
- [ ] A codebase-wide search confirms no production code references `audit_bookings_status_compat`.

### Mandatory preflight checks

```sql
-- No NULL new fields
SELECT count(*) AS invalid_rows
FROM public.audit_bookings
WHERE booking_status IS NULL
   OR calendar_sync_status IS NULL;
-- Expected: 0

-- Status combinations look clean
SELECT
  booking_status,
  calendar_sync_status,
  count(*)
FROM public.audit_bookings
GROUP BY booking_status, calendar_sync_status
ORDER BY booking_status, calendar_sync_status;

-- No views or policies depend on the legacy status column
SELECT
  view_schema,
  view_name
FROM information_schema.view_column_usage
WHERE table_schema = 'public'
  AND table_name = 'audit_bookings'
  AND column_name = 'status';
-- Expected: 0 rows
```

### Proposed SQL (for review, not a migration file yet)

```sql
-- ============================================================
-- 006b_booking_status_contract_drop.sql
-- Final contract: remove the legacy status column and all
-- compatibility objects.
-- ============================================================

BEGIN;

-- 1. Remove the compatibility trigger
DROP TRIGGER IF EXISTS audit_bookings_status_compat
  ON public.audit_bookings;

-- 2. Remove the compatibility function
DROP FUNCTION IF EXISTS public.sync_audit_booking_status_compat();

-- 3. Remove the legacy index
DROP INDEX IF EXISTS public.idx_audit_bookings_status;

-- 4. Remove the legacy CHECK constraint if it exists
ALTER TABLE public.audit_bookings
  DROP CONSTRAINT IF EXISTS audit_bookings_status_check;

-- 5. Remove the legacy column
ALTER TABLE public.audit_bookings
  DROP COLUMN status;

COMMIT;
```

> The exact constraint, index, function, and trigger names must be verified against the live database before the migration is finalised.

### Deploy and validation

1. Create `supabase/migrations/006b_booking_status_contract_drop.sql`.
2. Apply the migration to Supabase.
3. Deploy the matching application commit.
4. Smoke test:
   - Create a booking.
   - Verify `booking_status` and `calendar_sync_status` are set correctly.
   - Verify no `status` column exists.
   - Cancel and reschedule still work.

### Rollback — Phase B3

After Phase B3, you **cannot** roll back to a commit that expects the `status` column without also reverting the database migration.

If a rollback is needed:

1. Restore the `status` column, trigger, function, index, and constraint manually.
2. Then deploy the previous application commit.

Because this is more complex, Phase B3 should only happen after Phase B2 is proven stable.

---

## Risk matrix

| Step | Risk | Mitigation |
|------|------|------------|
| B1 trigger deploy | Trigger loop or precedence bug | Careful bidirectional logic: capture changes first, then use exclusive `IF / ELSIF` branches |
| B1 trigger deploy | New inserts fail because `status` stays `NOT NULL` | Trigger fills `status` from `calendar_sync_status` when application omits it |
| B1 trigger deploy | Invalid values silently default to wrong status | No silent `ELSE` fallbacks; explicit `RAISE EXCEPTION` for invalid input |
| B2 code deploy | Some code path still writes `status` | Full codebase audit + smoke tests |
| B3 migration | Old rollback commit no longer deployable | Document that DB revert is required first |

## Checklist summary

### Before Phase B1

- [ ] Production stable after `3706d71`.
- [ ] Booking, reschedule, cancel all tested in production.
- [ ] No `calendar_sync_status = 'failed'`.
- [ ] No Vercel runtime errors.
- [ ] Emails deliver.
- [ ] 48 hours passed since `3706d71` deploy.

### Phase B1

- [ ] Create and apply `006a_booking_status_contract_bridge.sql`.
- [ ] Run preflight SQL and trigger tests.
- [ ] Verify trigger populates `status` when application omits it.
- [ ] Smoke test booking, reschedule, cancel.
- [ ] Monitor 24–48 hours.

### Phase B2

- [ ] Delete `legacyStatusMapper.ts`.
- [ ] Remove `status` from all insert/update payloads.
- [ ] Run audit searches.
- [ ] Deploy to production.
- [ ] Smoke test booking, reschedule, cancel.
- [ ] Verify consistency SQL.
- [ ] Monitor 24–48 hours.

### Before Phase B3

- [ ] Phase B2 stable for 48 hours.
- [ ] Codebase search confirms no `status` references.
- [ ] Preflight SQL checks pass.

### Phase B3

- [ ] Create and apply `006b_booking_status_contract_drop.sql`.
- [ ] Deploy matching commit.
- [ ] Smoke tests pass.
- [ ] Confirm `status` column is gone.

## Notes

- This document is a plan. No migration file, code change, or commit should be created until each phase is reviewed and approved individually.
- The SQL snippets above are proposals for discussion, not final migration files.
- Phase B3 SQL must be verified against the live database before execution.
