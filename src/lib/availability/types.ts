// ============================================================
// Availability domain types
// Mirrors supabase/migrations/008_availability_schedules.sql.
// ============================================================

export const AVAILABILITY_TIMEZONE = 'Europe/Budapest' as const;

export type IsoWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type AvailabilityOverrideKind = 'unavailable' | 'custom';
export type BusyIntervalSource = 'google_calendar' | 'booking';

export interface AvailabilitySchedule {
  id: string;
  name: string;
  timezone: typeof AVAILABILITY_TIMEZONE;
  isDefault: boolean;
  isActive: boolean;
  slotDurationMinutes: number;
  slotIntervalMinutes: number;
  minimumNoticeMinutes: number;
  bookingWindowDays: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
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
  timezone: typeof AVAILABILITY_TIMEZONE;
  days: AvailabilityDaySlots[];
}
