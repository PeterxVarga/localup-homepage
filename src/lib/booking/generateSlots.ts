// ============================================================
// DB-backed slot generation — Europe/Budapest wall-clock safe
// ============================================================

import {
  getAvailabilityDateOverrides,
  getAvailabilityWeeklyRules,
  getDefaultAvailabilitySchedule,
} from '../availability/queries';
import type {
  AvailabilityBundle,
  AvailabilityDateOverride,
  AvailabilityWeeklyRule,
} from '../availability/types';
import {
  formatAvailabilityDate,
  formatAvailabilityDayName,
  wallClockToUtc,
} from '../availability/timezone';
import { getSupabase } from '../supabase';

export interface TimeSlot {
  start: string;
  end: string;
}

export interface DaySlots {
  date: string;
  dayName: string;
  slots: TimeSlot[];
}

type BusySlot = { start: string; end: string };
type FreeBusyCheck = (min: string, max: string) => Promise<BusySlot[]>;

const MINUTE_MS = 60_000;

/** Add calendar days to a YYYY-MM-DD key without involving server timezone. */
export function addDateKeyDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Monday=0 ... Sunday=6, matching the database contract. */
function weekdayForDateKey(dateKey: string): number {
  const sundayBased = new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
  return (sundayBased + 6) % 7;
}

function intervalsForDate(
  dateKey: string,
  bundle: AvailabilityBundle,
): Array<{ startTime: string; endTime: string }> {
  const override: AvailabilityDateOverride | undefined =
    bundle.dateOverrides.find((item) => item.overrideDate === dateKey);

  if (override?.kind === 'unavailable') return [];
  if (override?.kind === 'custom') {
    return override.intervals.map((interval) => ({
      startTime: interval.startTime,
      endTime: interval.endTime,
    }));
  }

  const weekday = weekdayForDateKey(dateKey);
  return bundle.weeklyRules
    .filter((rule: AvailabilityWeeklyRule) => rule.weekday === weekday)
    .map((rule) => ({
      startTime: rule.startTime,
      endTime: rule.endTime,
    }));
}

/**
 * Generate slots from a previously loaded availability bundle.
 * This is exported so server-side booking validation can use exactly
 * the same schedule, interval and override semantics as the public list.
 */
export function generateCandidateSlots(
  bundle: AvailabilityBundle,
  now = new Date(),
): DaySlots[] {
  const { schedule } = bundle;
  const minimumStart = new Date(
    now.getTime() + schedule.minimumNoticeMinutes * MINUTE_MS,
  );
  const today = formatAvailabilityDate(now);
  const days: DaySlots[] = [];

  for (let offset = 0; offset <= schedule.bookingWindowDays; offset += 1) {
    const dateKey = addDateKeyDays(today, offset);
    const slots: TimeSlot[] = [];

    for (const interval of intervalsForDate(dateKey, bundle)) {
      const intervalStart = wallClockToUtc(dateKey, interval.startTime);
      const intervalEnd = wallClockToUtc(dateKey, interval.endTime);

      for (
        let startMs = intervalStart.getTime();
        startMs + schedule.slotDurationMinutes * MINUTE_MS <=
        intervalEnd.getTime();
        startMs += schedule.slotIntervalMinutes * MINUTE_MS
      ) {
        const start = new Date(startMs);
        if (start < minimumStart) continue;

        slots.push({
          start: start.toISOString(),
          end: new Date(
            startMs + schedule.slotDurationMinutes * MINUTE_MS,
          ).toISOString(),
        });
      }
    }

    if (slots.length > 0) {
      days.push({
        date: dateKey,
        dayName: formatAvailabilityDayName(slots[0].start),
        slots,
      });
    }
  }

  return days;
}

function overlapsWithBuffer(
  slot: TimeSlot,
  busy: BusySlot,
  bufferBeforeMinutes: number,
  bufferAfterMinutes: number,
): boolean {
  const slotStart =
    new Date(slot.start).getTime() - bufferBeforeMinutes * MINUTE_MS;
  const slotEnd = new Date(slot.end).getTime() + bufferAfterMinutes * MINUTE_MS;
  const busyStart = new Date(busy.start).getTime();
  const busyEnd = new Date(busy.end).getTime();

  return slotStart < busyEnd && slotEnd > busyStart;
}

/**
 * Load the dashboard-managed schedule, then filter candidates against
 * active bookings and all configured calendar providers.
 *
 * Database and free/busy failures deliberately throw. Returning an empty
 * or partial busy list would expose slots that cannot be verified safely.
 */
export async function generateAvailableSlots(
  freeBusyCheck?: FreeBusyCheck,
  now = new Date(),
): Promise<DaySlots[]> {
  const today = formatAvailabilityDate(now);
  const schedule = await getDefaultAvailabilitySchedule();
  const endDate = addDateKeyDays(today, schedule.bookingWindowDays);
  const [weeklyRules, dateOverrides] = await Promise.all([
    getAvailabilityWeeklyRules(schedule.id),
    getAvailabilityDateOverrides(schedule.id, today, endDate),
  ]);
  const bundle: AvailabilityBundle = {
    schedule,
    weeklyRules,
    dateOverrides,
  };
  const candidates = generateCandidateSlots(bundle, now);
  const flatCandidates = candidates.flatMap((day) => day.slots);

  if (flatCandidates.length === 0) return [];

  const firstStart = flatCandidates[0].start;
  const lastEnd = flatCandidates[flatCandidates.length - 1].end;
  const queryStart = new Date(
    new Date(firstStart).getTime() -
      bundle.schedule.bufferBeforeMinutes * MINUTE_MS,
  ).toISOString();
  const queryEnd = new Date(
    new Date(lastEnd).getTime() +
      bundle.schedule.bufferAfterMinutes * MINUTE_MS,
  ).toISOString();

  const { data: bookedData, error: bookedError } = await getSupabase()
    .from('audit_bookings')
    .select('selected_slot_start, selected_slot_end')
    .in('booking_status', ['pending', 'booked'])
    .lt('selected_slot_start', queryEnd)
    .gt('selected_slot_end', queryStart);

  if (bookedError) {
    throw new Error('Failed to verify booked slots');
  }

  const bookedSlots: BusySlot[] = (bookedData ?? []).map((booking) => ({
    start: booking.selected_slot_start,
    end: booking.selected_slot_end,
  }));

  const calendarBusy = freeBusyCheck
    ? await freeBusyCheck(queryStart, queryEnd)
    : [];
  const busySlots = [...bookedSlots, ...calendarBusy];

  return candidates
    .map((day) => ({
      ...day,
      slots: day.slots.filter(
        (slot) =>
          !busySlots.some((busy) =>
            overlapsWithBuffer(
              slot,
              busy,
              bundle.schedule.bufferBeforeMinutes,
              bundle.schedule.bufferAfterMinutes,
            ),
          ),
      ),
    }))
    .filter((day) => day.slots.length > 0);
}
