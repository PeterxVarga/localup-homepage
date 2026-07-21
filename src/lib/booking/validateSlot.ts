// ============================================================
// Slot validation against the dashboard-managed availability rules
// ============================================================

import {
  getAvailabilityBundle,
  getDefaultAvailabilitySchedule,
} from '../availability/queries';
import { formatAvailabilityDate } from '../availability/timezone';
import { generateCandidateSlots } from './generateSlots';

/**
 * Validate duration, notice, horizon, weekday/custom override and grid
 * alignment using the same candidate generator as the public endpoint.
 * This intentionally does not check bookings or Google Calendar.
 */
export async function isSlotValidAccordingToRules(
  slotStart: string,
  slotEnd: string,
  now = new Date(),
): Promise<boolean> {
  const start = new Date(slotStart);
  const end = new Date(slotEnd);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end <= start
  ) {
    return false;
  }

  const dateKey = formatAvailabilityDate(start);
  if (formatAvailabilityDate(end) !== dateKey) return false;

  const bundle = await getAvailabilityBundle(dateKey, dateKey);
  return generateCandidateSlots(bundle, now).some((day) =>
    day.slots.some(
      (slot) =>
        slot.start === start.toISOString() && slot.end === end.toISOString(),
    ),
  );
}

/** Compute the expected end using the current DB-backed slot duration. */
export async function getExpectedSlotEnd(slotStart: string): Promise<string> {
  const start = new Date(slotStart);
  if (Number.isNaN(start.getTime())) {
    throw new RangeError('Invalid slot start');
  }

  const schedule = await getDefaultAvailabilitySchedule();
  return new Date(
    start.getTime() + schedule.slotDurationMinutes * 60_000,
  ).toISOString();
}

export function isSameSlot(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return (
    new Date(aStart).toISOString() === new Date(bStart).toISOString() &&
    new Date(aEnd).toISOString() === new Date(bEnd).toISOString()
  );
}
