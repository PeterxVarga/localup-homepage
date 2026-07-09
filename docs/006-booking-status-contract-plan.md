# 006 Booking Status Contract Plan

Two-phase removal of the legacy `status` column and the compatibility layer introduced in `005_booking_status_expand.sql`.

## Context

Migration `005_booking_status_expand.sql` added the new lifecycle fields:

- `booking_status`
- `calendar_sync_status`
- `management_token_hash`
- `management_token_expires_at`
- `reschedule_count`
- `cancelled_at`

It kept the old `status` column and added a compatibility trigger (`audit_bookings_status_compat`) plus a helper function (`sync_audit_booking_status_compat`) so that old and new code instances could coexist during deploy.

The application currently writes both the new fields and the legacy `status` field (dual-write). This plan removes that technical debt in two safe phases.

## Goal

End state:

- Only `booking_status` and `calendar_sync_status` are used for reads, queries, conditions, and business logic.
- The legacy `status` column, its trigger, its function, and its index are removed.
- Legacy `status` writes are isolated in a single compatibility mapper during Phase A, then removed together with the DB contract in Phase B.
- A clean rollback path exists at every step.

## Preconditions before starting either phase

All of these must be true before Phase A begins:

- [ ] The latest production version (`2b988bd` or later) is stable.
- [ ] At least one new booking succeeded end-to-end in production.
- [ ] At least one cancellation succeeded in production.
- [ ] At least one reschedule succeeded in production.
- [ ] No rows with `calendar_sync_status = 'failed'` remain unhandled.
- [ ] No relevant Vercel runtime errors in the last 48 hours.
- [ ] Resend emails are being delivered successfully.
- [ ] At least 48 hours have passed since the last meaningful booking-flow code change.

## Phase A — Application code contract preparation

### Objective

Move every read, query, condition, API response, email, and business decision to the new status fields, while keeping legacy `status` writes alive through a single isolated compatibility mapper. The legacy database objects stay in place. This allows a clean Vercel rollback if anything goes wrong.

### Why legacy writes must stay during Phase A

The legacy `status` column is still `NOT NULL`. The existing compatibility trigger propagates from the legacy `status` field to the new fields, not necessarily the other way around. If the new code stopped writing `status`, new inserts could fail with a `NOT NULL` violation.

Therefore, Phase A keeps a narrow compatibility write path for `status`, but no other code may read or interpret it.

### Code changes

1. **Read paths**
   - Find every place that reads `status` from `audit_bookings`.
   - Replace with `booking_status` and/or `calendar_sync_status` as appropriate.

2. **Business logic, conditions, and API responses**
   - All conditions (`if booking.status === ...`, etc.) must use the new fields.
   - No API response may include `status`.
   - No email may format or decide content based on `status`.

3. **Types and schemas**
   - Update any TypeScript types, Zod schemas, or Supabase types that reference `status`.

4. **Legacy status write isolation**
   - All legacy `status` writes must move into a single dedicated compatibility mapper / write helper.
   - The mapper maps from the new fields to the legacy values:
     - `calendar_sync_status = 'pending'` → `status = 'calendar_pending'`
     - `calendar_sync_status = 'synced'` → `status = 'booked'`
     - `calendar_sync_status = 'failed'` → `status = 'calendar_failed'`
   - Business code must not call `status` directly; it calls the mapper or lets the mapper wrap the insert/update.

5. **Functions and files to audit**
   - `src/lib/booking/createBooking.ts`
   - `src/lib/booking/cancelBooking.ts`
   - `src/lib/booking/rescheduleBooking.ts`
   - `src/lib/calendar/syncBookingToCalendar.ts`
   - `src/pages/api/audit/book.ts`
   - `src/pages/api/audit/cancel.ts`
   - `src/pages/api/audit/reschedule.ts`
   - `src/pages/api/audit/manage/[token].ts`
   - `src/components/audit/ManageBookingClient.tsx`
   - Any utility types in `src/lib/booking/types.ts` if created.

6. **Compatibility trigger behaviour during Phase A**
   - The trigger `audit_bookings_status_compat` remains active.
   - It keeps the new fields in sync if an old deployment writes the legacy `status` field.
   - The new application code writes the legacy `status` field only through the compatibility mapper, so the trigger is effectively a no-op for new writes but remains a safety net for rollback scenarios.

### Proposed SQL (no migration file yet)

No database changes in Phase A. The legacy column, trigger, function, and index stay exactly as they are.

### Audit checklist for Phase A

Run these searches before declaring Phase A ready. The report must separate legacy DB `status` references from unrelated concepts like HTTP response status, UI state, or email delivery status.

```bash
rg '\bstatus\s*:' src
rg '\.eq\(["'\''"]status' src
rg '\.select\(.*status' src
rg '\.update\(.*status' src
rg '\.insert\(.*status' src
rg 'calendar_pending|calendar_failed' src
```

Allowed legacy references at the end of Phase A:

- The dedicated compatibility mapper file and its tests.
- No reads, queries, conditions, API responses, or emails may reference the legacy `status`.

### Deploy and validation

1. Deploy the Phase A commit to production.
2. Run production smoke tests:
   - Create a booking.
   - Verify `booking_status = 'booked'` and `calendar_sync_status = 'synced'`.
   - Verify the legacy `status` column is also written (e.g., `status = 'booked'` for a synced booking).
   - Cancel a booking.
   - Verify `booking_status = 'cancelled'`.
   - Reschedule a booking.
   - Verify `reschedule_count` increments.
3. Rollback test:
   - Confirm that the previous production commit can still read and update records created by the new code.
   - Verify the compatibility trigger keeps the new fields in sync when the old code writes `status`.
4. Monitor for 24–48 hours:
   - Vercel runtime logs.
   - Resend delivery.
   - `calendar_sync_status = 'failed'` rows.

### Consistency SQL for Phase A validation

```sql
-- New fields must never be NULL
SELECT count(*)
FROM public.audit_bookings
WHERE booking_status IS NULL
   OR calendar_sync_status IS NULL;

-- Expected result: 0

-- Distribution of new status combinations
SELECT booking_status, calendar_sync_status, count(*)
FROM public.audit_bookings
GROUP BY booking_status, calendar_sync_status
ORDER BY booking_status, calendar_sync_status;

-- Legacy status consistency check
SELECT
  status,
  booking_status,
  calendar_sync_status,
  count(*)
FROM public.audit_bookings
GROUP BY status, booking_status, calendar_sync_status
ORDER BY status, booking_status, calendar_sync_status;

-- Allowed pairs include:
-- calendar_pending | booked   | pending
-- booked           | booked   | synced
-- calendar_failed  | booked   | failed
-- (cancelled rows keep the last calendar sync legacy status)
```

### Rollback — Phase A

Because the database schema is unchanged, rollback is a simple Vercel production deployment of the previous commit.

If a rollback is needed, the legacy application code will resume writing `status` directly. The compatibility trigger will continue to keep `booking_status` and `calendar_sync_status` in sync, so the new fields remain valid.

---

## Phase B — Final database contract

### Objective

Remove the legacy `status` column, its trigger, its function, its constraint, and its index from the database. Also remove the application-side compatibility mapper that wrote the legacy `status`.

### Preconditions before Phase B

All of these must be true in addition to the initial preconditions:

- [ ] Phase A has been in production for at least 48 hours without issues.
- [ ] A codebase-wide search confirms no production code reads the `status` column.
- [ ] A codebase-wide search confirms no production code references `sync_audit_booking_status_compat`.
- [ ] A codebase-wide search confirms no production code references `audit_bookings_status_compat`.
- [ ] The compatibility mapper is the only remaining place that writes `status`.
- [ ] The consistency SQL above shows only expected pairs and no NULL new fields.

### Mandatory pre-migration checks

Run these before applying the Phase B migration:

```sql
-- No NULL new fields
SELECT count(*)
FROM public.audit_bookings
WHERE booking_status IS NULL
   OR calendar_sync_status IS NULL;
-- Expected: 0

-- No unexpected status combinations
SELECT booking_status, calendar_sync_status, count(*)
FROM public.audit_bookings
GROUP BY booking_status, calendar_sync_status
ORDER BY booking_status, calendar_sync_status;
```

### Database changes

1. Drop the compatibility trigger.
2. Drop the compatibility function.
3. Drop the legacy index on `status`.
4. Drop the legacy check constraint on `status` if one exists.
5. Drop the legacy `status` column.
6. Remove the application-side compatibility mapper.

### Proposed SQL (for review, not yet a migration file)

```sql
-- Phase B: final contract
-- Run only after Phase A has been stable in production.

BEGIN;

-- 1. Remove the compatibility trigger
DROP TRIGGER IF EXISTS audit_bookings_status_compat
  ON public.audit_bookings;

-- 2. Remove the compatibility function
DROP FUNCTION IF EXISTS public.sync_audit_booking_status_compat();

-- 3. Remove the legacy index
DROP INDEX IF EXISTS public.idx_audit_bookings_status;

-- 4. Remove the legacy check constraint if it exists
ALTER TABLE public.audit_bookings
  DROP CONSTRAINT IF EXISTS audit_bookings_status_check;

-- 5. Remove the legacy column
ALTER TABLE public.audit_bookings
  DROP COLUMN IF EXISTS status;

COMMIT;
```

> The exact constraint and function names must be verified against the live database before the migration is finalised.

### Application code changes for Phase B

- Remove the compatibility mapper that wrote the legacy `status`.
- Update insert/update calls to no longer include `status`.
- Update any remaining type definitions that still allow a `status` field.

### Deploy and validation

1. Create the migration file `supabase/migrations/006_booking_status_contract.sql` with the SQL above.
2. Apply the migration to the Supabase project (CLI or Dashboard SQL Editor).
3. Deploy the matching application commit to production.
4. Smoke test:
   - Create a booking.
   - Verify `booking_status` and `calendar_sync_status` are set correctly.
   - Verify no `status` column exists.
   - Cancel and reschedule still work.

### Rollback — Phase B

After Phase B, you **cannot** roll back to a commit that expects the `status` column without also reverting the database migration.

If a rollback is needed:

1. Revert the database migration manually (restore the column, trigger, function, index, and constraint).
2. Then deploy the previous application commit.

Because this is more complex, Phase B should only happen after Phase A is proven stable.

---

## Risk matrix

| Step | Risk | Mitigation |
|------|------|------------|
| Phase A deploy | New code reads wrong status field | Comprehensive code audit + smoke tests |
| Phase A deploy | Legacy `status` writes removed too early, causing `NOT NULL` insert failures | Keep legacy writes in an isolated mapper |
| Phase A deploy | Compatibility trigger behaves unexpectedly | Verify trigger direction before deploy |
| Phase B migration | Old rollback commit no longer deployable | Document that DB revert is required first |
| Phase B migration | Trigger removal breaks legacy code paths | Phase A already removed those paths |

## Checklist summary

### Before Phase A

- [ ] Production stable.
- [ ] Booking, cancel, reschedule all tested in production.
- [ ] No `calendar_sync_status = 'failed'`.
- [ ] No Vercel runtime errors.
- [ ] Emails deliver.
- [ ] 48 hours passed since last booking-flow change.

### Phase A

- [ ] All reads, queries, conditions, API responses, and emails use only `booking_status` and `calendar_sync_status`.
- [ ] Legacy `status` writes isolated in a single compatibility mapper.
- [ ] Legacy DB objects still present.
- [ ] Audit searches run and only the mapper references `status`.
- [ ] Deploy to production.
- [ ] Smoke tests pass (booking, cancel, reschedule).
- [ ] Rollback test passes (old code reads new records).
- [ ] Consistency SQL shows expected pairs.
- [ ] Monitor 24–48 hours.

### Before Phase B

- [ ] Phase A stable for 48 hours.
- [ ] Codebase search confirms no reads of the `status` column.
- [ ] Codebase search confirms no references to the trigger or function.
- [ ] Pre-migration SQL checks pass.

### Phase B

- [ ] Create `006_booking_status_contract.sql`.
- [ ] Apply migration.
- [ ] Remove the application-side compatibility mapper.
- [ ] Deploy matching commit.
- [ ] Smoke tests pass.
- [ ] Confirm `status` column is gone.

## Notes

- This document is a plan. No migration file, code change, or commit should be created until the plan is reviewed and approved.
- The SQL snippets above are proposals for discussion, not final migration files.
- Phase B SQL must be verified against the live database before execution.
