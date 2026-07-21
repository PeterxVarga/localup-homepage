// ============================================================
// Availability timezone helpers
// DB DATE/TIME values are interpreted as Europe/Budapest wall-clock.
// ============================================================

import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { AVAILABILITY_TIMEZONE } from './types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function assertDateKey(date: string): void {
  if (!DATE_PATTERN.test(date)) {
    throw new RangeError(`Invalid local date: ${date}`);
  }
}

function assertTime(time: string): void {
  if (!TIME_PATTERN.test(time)) {
    throw new RangeError(`Invalid local time: ${time}`);
  }
}

/**
 * Interpret a DATE + TIME pair in the schedule timezone and return UTC.
 * The round-trip check rejects nonexistent DST wall-clock values.
 */
export function wallClockToUtc(date: string, time: string): Date {
  assertDateKey(date);
  assertTime(time);

  const wallClock = `${date}T${time}:00`;
  const utc = fromZonedTime(wallClock, AVAILABILITY_TIMEZONE);

  if (Number.isNaN(utc.getTime())) {
    throw new RangeError(`Invalid Budapest wall-clock time: ${date} ${time}`);
  }

  const roundTrip = formatInTimeZone(
    utc,
    AVAILABILITY_TIMEZONE,
    "yyyy-MM-dd'T'HH:mm:ss",
  );
  if (roundTrip !== wallClock) {
    throw new RangeError(
      `Nonexistent Budapest wall-clock time: ${date} ${time}`,
    );
  }

  return utc;
}

export function formatAvailabilityDate(date: Date | string): string {
  return formatInTimeZone(date, AVAILABILITY_TIMEZONE, 'yyyy-MM-dd');
}

export function formatAvailabilityTime(date: Date | string): string {
  return formatInTimeZone(date, AVAILABILITY_TIMEZONE, 'HH:mm');
}

export function formatAvailabilityDayName(date: Date | string): string {
  return formatInTimeZone(date, AVAILABILITY_TIMEZONE, 'EEEE');
}

/** Monday=0 ... Sunday=6, matching the availability_weekly_rules schema. */
export function getIsoWeekday(date: Date | string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  const isoDay = Number(formatInTimeZone(date, AVAILABILITY_TIMEZONE, 'i'));
  return (isoDay - 1) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}
