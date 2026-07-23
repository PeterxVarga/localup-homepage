// ============================================================
// DB-backed slot generation — service-aware, wall-clock safe
// ============================================================

import { getAvailabilityBundle } from '../availability/queries';
import type {
  AvailabilityBundle,
  AvailabilityDateOverride,
  AvailabilityWeeklyRule,
} from '../availability/types';
import {
  formatAvailabilityDate,
  formatAvailabilityDayName,
  getIsoWeekday,
  wallClockToUtc,
} from '../availability/timezone';
import { getSupabase } from '../supabase';
import type { BookingServiceContext } from '../booking-service/types';
import { BookingServiceError } from '../booking-service/types';
import { intervalsOverlap } from './intervals';

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
function weekdayForDateKey(dateKey: string, timezone: string): number {
  return getIsoWeekday(`${dateKey}T12:00:00`, timezone);
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

  const weekday = weekdayForDateKey(dateKey, bundle.schedule.timezone);
  return bundle.weeklyRules
    .filter((rule: AvailabilityWeeklyRule) => rule.weekday === weekday)
    .map((rule) => ({
      startTime: rule.startTime,
      endTime: rule.endTime,
    }));
}

/**
 * Generate slots from a previously loaded availability bundle and service context.
 * This is exported so server-side booking validation can use exactly the same
 * schedule, interval and override semantics as the public list.
 */
export function generateCandidateSlots(
  bundle: AvailabilityBundle,
  service: BookingServiceContext,
  now = new Date(),
): DaySlots[] {
  if (bundle.schedule.timezone !== service.timezone) {
    throw new BookingServiceError(
      `Schedule timezone ${bundle.schedule.timezone} does not match service timezone ${service.timezone}`,
      'timezone_mismatch',
    );
  }

  const minimumStart = new Date(
    now.getTime() + service.minimumNoticeMinutes * MINUTE_MS,
  );
  const today = formatAvailabilityDate(now, service.timezone);
  const days: DaySlots[] = [];

  for (let offset = 0; offset <= service.bookingWindowDays; offset += 1) {
    const dateKey = addDateKeyDays(today, offset);
    const slots: TimeSlot[] = [];

    for (const interval of intervalsForDate(dateKey, bundle)) {
      const intervalStart = wallClockToUtc(
        dateKey,
        interval.startTime,
        service.timezone,
      );
      const intervalEnd = wallClockToUtc(
        dateKey,
        interval.endTime,
        service.timezone,
      );

      for (
        let startMs = intervalStart.getTime();
        startMs + service.durationMinutes * MINUTE_MS <= intervalEnd.getTime();
        startMs += service.slotIntervalMinutes * MINUTE_MS
      ) {
        const start = new Date(startMs);
        if (start < minimumStart) continue;

        slots.push({
          start: start.toISOString(),
          end: new Date(
            startMs + service.durationMinutes * MINUTE_MS,
          ).toISOString(),
        });
      }
    }

    if (slots.length > 0) {
      days.push({
        date: dateKey,
        dayName: formatAvailabilityDayName(slots[0].start, service.timezone),
        slots,
      });
    }
  }

  return days;
}

/**
 * Compute the candidate slot's own blocked interval using its service buffers,
 * then check whether it overlaps the supplied busy interval.
 *
 * For audit bookings and calendar freeBusy the busy interval is the raw slot;
 * for generic bookings the busy interval is the stored blocked_start/end that
 * already contains the existing booking's buffers. In both cases only the
 * candidate's own buffer is applied here, so existing buffers are never
 * counted twice.
 */
function candidateBlockedOverlaps(
  slot: TimeSlot,
  busy: BusySlot,
  bufferBeforeMinutes: number,
  bufferAfterMinutes: number,
): boolean {
  const candidateBlockedStart = new Date(
    new Date(slot.start).getTime() - bufferBeforeMinutes * MINUTE_MS,
  );
  const candidateBlockedEnd = new Date(
    new Date(slot.end).getTime() + bufferAfterMinutes * MINUTE_MS,
  );

  return intervalsOverlap(
    candidateBlockedStart,
    candidateBlockedEnd,
    busy.start,
    busy.end,
  );
}

/**
 * Load the service-managed schedule, then filter candidates against active
 * bookings for the same site and all configured calendar providers.
 *
 * Database and free/busy failures deliberately throw. Returning an empty
 * or partial busy list would expose slots that cannot be verified safely.
 */
export async function generateAvailableSlots(
  service: BookingServiceContext,
  freeBusyCheck?: FreeBusyCheck,
  now = new Date(),
): Promise<DaySlots[]> {
  const today = formatAvailabilityDate(now, service.timezone);
  const endDate = addDateKeyDays(today, service.bookingWindowDays);
  const bundle = await getAvailabilityBundle(service.scheduleId, today, endDate);
  const candidates = generateCandidateSlots(bundle, service, now);
  const flatCandidates = candidates.flatMap((day) => day.slots);

  if (flatCandidates.length === 0) return [];

  const firstStart = flatCandidates[0].start;
  const lastEnd = flatCandidates[flatCandidates.length - 1].end;
  const queryStart = new Date(
    new Date(firstStart).getTime() - service.bufferBeforeMinutes * MINUTE_MS,
  ).toISOString();
  const queryEnd = new Date(
    new Date(lastEnd).getTime() + service.bufferAfterMinutes * MINUTE_MS,
  ).toISOString();

  const [auditBookingsRes, genericBookingsRes] = await Promise.all([
    getSupabase()
      .from('audit_bookings')
      .select('selected_slot_start, selected_slot_end')
      .eq('site_id', service.siteId)
      .in('booking_status', ['pending', 'booked'])
      .lt('selected_slot_start', queryEnd)
      .gt('selected_slot_end', queryStart),
    getSupabase()
      .from('bookings')
      .select('blocked_start, blocked_end')
      .eq('site_id', service.siteId)
      .in('booking_status', ['pending', 'booked'])
      .lt('blocked_start', queryEnd)
      .gt('blocked_end', queryStart),
  ]);

  if (auditBookingsRes.error || genericBookingsRes.error) {
    throw new Error('Failed to verify booked slots');
  }

  const auditBusy: BusySlot[] = (auditBookingsRes.data ?? []).map(
    (booking) => ({
      start: booking.selected_slot_start,
      end: booking.selected_slot_end,
    }),
  );

  const genericBusy: BusySlot[] = (genericBookingsRes.data ?? []).map(
    (booking) => ({
      start: booking.blocked_start,
      end: booking.blocked_end,
    }),
  );

  const calendarBusy = freeBusyCheck
    ? await freeBusyCheck(queryStart, queryEnd)
    : [];

  return candidates
    .map((day) => ({
      ...day,
      slots: day.slots.filter(
        (slot) =>
          !auditBusy.some((busy) =>
            candidateBlockedOverlaps(
              slot,
              busy,
              service.bufferBeforeMinutes,
              service.bufferAfterMinutes,
            ),
          ) &&
          !genericBusy.some((busy) =>
            candidateBlockedOverlaps(
              slot,
              busy,
              service.bufferBeforeMinutes,
              service.bufferAfterMinutes,
            ),
          ) &&
          !calendarBusy.some((busy) =>
            candidateBlockedOverlaps(
              slot,
              busy,
              service.bufferBeforeMinutes,
              service.bufferAfterMinutes,
            ),
          ),
      ),
    }))
    .filter((day) => day.slots.length > 0);
}
