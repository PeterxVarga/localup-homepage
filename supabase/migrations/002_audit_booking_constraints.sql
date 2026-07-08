-- ============================================================
-- LocalUp Audit Booking — V2 Constraints Hardening
-- ============================================================

-- 1. Restrict status to values actually used by the application code.
--    The current codebase only transitions between these three states.
--    When cancelled/completed/no_show features are added, this constraint
--    should be altered to include them.
ALTER TABLE public.audit_bookings
ADD CONSTRAINT audit_bookings_status_check
CHECK (
  status IN (
    'calendar_pending',
    'booked',
    'calendar_failed'
  )
);

-- 2. Ensure every slot has a positive duration.
ALTER TABLE public.audit_bookings
ADD CONSTRAINT audit_bookings_slot_order_check
CHECK (selected_slot_end > selected_slot_start);
