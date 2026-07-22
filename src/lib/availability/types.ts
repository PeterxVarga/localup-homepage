// ============================================================
// Availability domain types
// Mirrors supabase/migrations/008_availability_schedules.sql.
// ============================================================

export type IsoWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type AvailabilityOverrideKind = 'unavailable' | 'custom';
export type BusyIntervalSource = 'google_calendar' | 'booking';

/**
 * Availability schedule identity.
 *
 * Timing fields (duration, interval, notice, window, buffers) are runtime
 * configuration on the booking service, not the schedule. They remain in the
 * database table for backward compatibility but are not used here.
 */
export interface AvailabilitySchedule {
  id: string;
  siteId: string;
  name: string;
  timezone: string;
  isDefault: boolean;
  isActive: boolean;
}

export interface AvailabilityWeeklyRule {
  id: string;
  scheduleId: string;
  weekday: IsoWeekday;
  startTime: string;
  endTime: string;
  sortOrder: number;
}

export interface AvailabilityDateOverrideInterval {
  id: string;
  overrideId: string;
  startTime: string;
  endTime: string;
  sortOrder: number;
}

export interface AvailabilityDateOverride {
  id: string;
  scheduleId: string;
  overrideDate: string;
  kind: AvailabilityOverrideKind;
  reason: string | null;
  intervals: AvailabilityDateOverrideInterval[];
}

export interface AvailabilityBundle {
  schedule: AvailabilitySchedule;
  weeklyRules: AvailabilityWeeklyRule[];
  dateOverrides: AvailabilityDateOverride[];
}

export interface BusyInterval {
  start: string;
  end: string;
  source: BusyIntervalSource;
}

export interface AvailabilitySlot {
  start: string;
  end: string;
  label: string;
}

export interface AvailabilityDaySlots {
  date: string;
  dayName: string;
  slots: AvailabilitySlot[];
}

export interface AvailableSlotsResult {
  timezone: string;
  days: AvailabilityDaySlots[];
}
