// ============================================================
// Slot generation — framework-neutral
// Generates available time slots based on config, filters
// already-booked slots and Google Calendar freeBusy conflicts
// ============================================================

import { availabilityConfig } from '../audit/config';
import { getSupabase } from '../supabase';

export interface TimeSlot {
  start: string; // ISO 8601
  end: string; // ISO 8601
}

export interface DaySlots {
  date: string; // '2026-07-09'
  dayName: string; // 'Thursday'
  slots: TimeSlot[];
}

/**
 * Generate all theoretically possible slots for the next N days,
 * then filter against booked slots and optionally Google Calendar.
 */
export async function generateAvailableSlots(
  freeBusyCheck?: (min: string, max: string) => Promise<{ start: string; end: string }[]>,
): Promise<DaySlots[]> {
  const {
    weeklySchedule,
    slotDurationMinutes,
    bufferMinutes,
    minAdvanceHours,
    maxAdvanceDays,
  } = availabilityConfig;

  const now = new Date();
  const minTime = new Date(now.getTime() + minAdvanceHours * 60 * 60 * 1000);
  const maxTime = new Date(now.getTime() + maxAdvanceDays * 24 * 60 * 60 * 1000);

  // Generate raw slots
  const rawSlots: DaySlots[] = [];
  const startDate = new Date(now);
  startDate.setHours(0, 0, 0, 0);

  for (let d = 0; d <= maxAdvanceDays; d++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + d);

    const weekday = date.getDay();
    const schedule = weeklySchedule.find((s) => s.weekday === weekday);
    if (!schedule) continue;

    const daySlots: TimeSlot[] = [];
    const [startH, startM] = schedule.start.split(':').map(Number);
    const [endH, endM] = schedule.end.split(':').map(Number);

    const dayStart = new Date(date);
    dayStart.setHours(startH, startM, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(endH, endM, 0, 0);

    let current = new Date(dayStart);
    while (
      current.getTime() + slotDurationMinutes * 60 * 1000 <=
      dayEnd.getTime()
    ) {
      const slotStart = new Date(current);
      const slotEnd = new Date(
        current.getTime() + slotDurationMinutes * 60 * 1000,
      );

      // Only include slots past minAdvanceHours and within maxAdvanceDays
      if (slotStart >= minTime && slotStart <= maxTime) {
        daySlots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
        });
      }

      current = new Date(
        current.getTime() +
          (slotDurationMinutes + bufferMinutes) * 60 * 1000,
      );
    }

    if (daySlots.length > 0) {
      rawSlots.push({
        date: date.toISOString().split('T')[0],
        dayName: date.toLocaleDateString('en-US', { weekday: 'long' }),
        slots: daySlots,
      });
    }
  }

  // 1. Filter against Supabase bookings
  const { data: bookedSlots } = await getSupabase()
    .from('audit_bookings')
    .select('selected_slot_start, selected_slot_end')
    .in('status', ['calendar_pending', 'booked', 'calendar_failed'])
    .gte('selected_slot_start', minTime.toISOString())
    .lte('selected_slot_start', maxTime.toISOString());

  const bookedSet = new Set(
    (bookedSlots ?? []).map((b) => b.selected_slot_start),
  );

  let filteredSlots = rawSlots.map((day) => ({
    ...day,
    slots: day.slots.filter((s) => !bookedSet.has(s.start)),
  }));

  // 2. Filter against Google Calendar freeBusy (if available)
  if (freeBusyCheck) {
    const busySlots = await freeBusyCheck(
      minTime.toISOString(),
      maxTime.toISOString(),
    );

    filteredSlots = filteredSlots.map((day) => ({
      ...day,
      slots: day.slots.filter(
        (s) =>
          !busySlots.some(
            (busy) => s.start < busy.end && s.end > busy.start,
          ),
      ),
    }));
  }

  // Remove days with no available slots
  return filteredSlots.filter((day) => day.slots.length > 0);
}
