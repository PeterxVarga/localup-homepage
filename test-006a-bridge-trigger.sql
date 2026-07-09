-- ============================================================
-- Test 006a bridge trigger
-- Run inside a transaction and ROLLBACK at the end.
-- These tests intentionally leave no permanent rows.
-- ============================================================

BEGIN;

-- Helper to assert equality.
CREATE OR REPLACE FUNCTION test_assert(
  label text,
  actual anyelement,
  expected anyelement
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'ASSERTION FAILED: % — expected %, got %', label, expected, actual;
  END IF;
END;
$$;

-- Helper to assert that a statement raises an exception.
CREATE OR REPLACE FUNCTION test_assert_raises(
  label text,
  sql_stmt text
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE sql_stmt;
  RAISE EXCEPTION 'ASSERTION FAILED: % — expected exception but statement succeeded', label;
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM LIKE 'ASSERTION FAILED:%' THEN
      RAISE;
    END IF;
    -- Some other exception was raised; test passes.
END;
$$;

-- Test 1: old-style INSERT with only legacy status
INSERT INTO public.audit_bookings (
  business_name, no_website, city, business_type, goals,
  name, email, selected_slot_start, selected_slot_end,
  status, management_token_hash, management_token_encrypted,
  management_token_expires_at, session_id
) VALUES (
  'Bridge Test 1', true, 'Budapest', 'Other', ARRAY['more_visibility']::text[],
  'Test', 'test1@example.com', '2030-01-01T10:00:00Z', '2030-01-01T10:30:00Z',
  'booked', 'hash1', 'enc1', '2030-02-01T10:30:00Z', 'sess1'
);

SELECT test_assert(
  'Test 1: old-style insert status',
  (SELECT status FROM public.audit_bookings WHERE management_token_hash = 'hash1'),
  'booked'
);
SELECT test_assert(
  'Test 1: old-style insert booking_status',
  (SELECT booking_status FROM public.audit_bookings WHERE management_token_hash = 'hash1'),
  'booked'
);
SELECT test_assert(
  'Test 1: old-style insert calendar_sync_status',
  (SELECT calendar_sync_status FROM public.audit_bookings WHERE management_token_hash = 'hash1'),
  'synced'
);

-- Test 2: new-style INSERT without legacy status
INSERT INTO public.audit_bookings (
  business_name, no_website, city, business_type, goals,
  name, email, selected_slot_start, selected_slot_end,
  booking_status, calendar_sync_status, management_token_hash,
  management_token_encrypted, management_token_expires_at, session_id
) VALUES (
  'Bridge Test 2', true, 'Budapest', 'Other', ARRAY['more_visibility']::text[],
  'Test', 'test2@example.com', '2030-01-01T11:00:00Z', '2030-01-01T11:30:00Z',
  'booked', 'synced', 'hash2', 'enc2', '2030-02-01T11:30:00Z', 'sess2'
);

SELECT test_assert(
  'Test 2: new-style insert status',
  (SELECT status FROM public.audit_bookings WHERE management_token_hash = 'hash2'),
  'booked'
);
SELECT test_assert(
  'Test 2: new-style insert booking_status',
  (SELECT booking_status FROM public.audit_bookings WHERE management_token_hash = 'hash2'),
  'booked'
);
SELECT test_assert(
  'Test 2: new-style insert calendar_sync_status',
  (SELECT calendar_sync_status FROM public.audit_bookings WHERE management_token_hash = 'hash2'),
  'synced'
);

-- Test 3: consistent double INSERT
INSERT INTO public.audit_bookings (
  business_name, no_website, city, business_type, goals,
  name, email, selected_slot_start, selected_slot_end,
  booking_status, calendar_sync_status, status,
  management_token_hash, management_token_encrypted,
  management_token_expires_at, session_id
) VALUES (
  'Bridge Test 3', true, 'Budapest', 'Other', ARRAY['more_visibility']::text[],
  'Test', 'test3@example.com', '2030-01-01T12:00:00Z', '2030-01-01T12:30:00Z',
  'booked', 'failed', 'calendar_failed', 'hash3', 'enc3',
  '2030-02-01T12:30:00Z', 'sess3'
);

SELECT test_assert(
  'Test 3: consistent double insert status',
  (SELECT status FROM public.audit_bookings WHERE management_token_hash = 'hash3'),
  'calendar_failed'
);

-- Test 4: inconsistent INSERT must fail
SELECT test_assert_raises(
  'Test 4: inconsistent insert should fail',
  $$
    INSERT INTO public.audit_bookings (
      business_name, no_website, city, business_type, goals,
      name, email, selected_slot_start, selected_slot_end,
      booking_status, calendar_sync_status, status,
      management_token_hash, management_token_encrypted,
      management_token_expires_at, session_id
    ) VALUES (
      'Bridge Test 4', true, 'Budapest', 'Other', ARRAY['more_visibility']::text[],
      'Test', 'test4@example.com', '2030-01-01T13:00:00Z', '2030-01-01T13:30:00Z',
      'booked', 'synced', 'calendar_failed', 'hash4', 'enc4',
      '2030-02-01T13:30:00Z', 'sess4'
    )
  $$
);

-- Test 5: invalid legacy status INSERT must fail
SELECT test_assert_raises(
  'Test 5: invalid legacy status insert should fail',
  $$
    INSERT INTO public.audit_bookings (
      business_name, no_website, city, business_type, goals,
      name, email, selected_slot_start, selected_slot_end,
      status, management_token_hash, management_token_encrypted,
      management_token_expires_at, session_id
    ) VALUES (
      'Bridge Test 5', true, 'Budapest', 'Other', ARRAY['more_visibility']::text[],
      'Test', 'test5@example.com', '2030-01-01T14:00:00Z', '2030-01-01T14:30:00Z',
      'invalid_status', 'hash5', 'enc5',
      '2030-02-01T14:30:00Z', 'sess5'
    )
  $$
);

-- Test 6: old-style UPDATE of legacy status
UPDATE public.audit_bookings
SET status = 'calendar_failed'
WHERE management_token_hash = 'hash1';

SELECT test_assert(
  'Test 6: old-style update status',
  (SELECT status FROM public.audit_bookings WHERE management_token_hash = 'hash1'),
  'calendar_failed'
);
SELECT test_assert(
  'Test 6: old-style update calendar_sync_status',
  (SELECT calendar_sync_status FROM public.audit_bookings WHERE management_token_hash = 'hash1'),
  'failed'
);
SELECT test_assert(
  'Test 6: old-style update booking_status unchanged',
  (SELECT booking_status FROM public.audit_bookings WHERE management_token_hash = 'hash1'),
  'booked'
);

-- Test 7: new-style UPDATE of calendar_sync_status
UPDATE public.audit_bookings
SET calendar_sync_status = 'failed'
WHERE management_token_hash = 'hash2';

SELECT test_assert(
  'Test 7: new-style update status',
  (SELECT status FROM public.audit_bookings WHERE management_token_hash = 'hash2'),
  'calendar_failed'
);
SELECT test_assert(
  'Test 7: new-style update calendar_sync_status',
  (SELECT calendar_sync_status FROM public.audit_bookings WHERE management_token_hash = 'hash2'),
  'failed'
);
SELECT test_assert(
  'Test 7: new-style update booking_status unchanged',
  (SELECT booking_status FROM public.audit_bookings WHERE management_token_hash = 'hash2'),
  'booked'
);

-- Test 8: inconsistent double UPDATE must fail
SELECT test_assert_raises(
  'Test 8: inconsistent double update should fail',
  $$
    UPDATE public.audit_bookings
    SET status = 'booked', calendar_sync_status = 'failed'
    WHERE management_token_hash = 'hash3'
  $$
);

-- Test 9: booking_status=cancelled must not be overwritten during sync update
UPDATE public.audit_bookings
SET booking_status = 'cancelled', cancelled_at = now()
WHERE management_token_hash = 'hash3';

UPDATE public.audit_bookings
SET calendar_sync_status = 'synced'
WHERE management_token_hash = 'hash3';

SELECT test_assert(
  'Test 9: cancelled booking_status preserved',
  (SELECT booking_status FROM public.audit_bookings WHERE management_token_hash = 'hash3'),
  'cancelled'
);
SELECT test_assert(
  'Test 9: cancelled booking status synced after calendar update',
  (SELECT status FROM public.audit_bookings WHERE management_token_hash = 'hash3'),
  'booked'
);

ROLLBACK;
