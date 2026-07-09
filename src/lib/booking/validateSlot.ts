// ============================================================
// Slot validation against LocalUp scheduling rules
// Framework-neutral — usable from API routes and lib modules.
// Does NOT check Google freeBusy or DB bookings.
// ============================================================

import { availabilityConfig } from '../audit/config';

/**
 * Check whether a slot start/end pair conforms to the configured
 * weekly schedule, duration, advance notice, and horizon rules.
 */
export function isSlotValidAccordingToRules(
  slotStart: string,
  slotEnd: string,
): boolean {
  const {
    weeklySchedule,
    slotDurationMinutes,
    bufferMinutes,
    minAdvanceHours,
    maxAdvanceDays,
  } = availabilityConfig;

  const start = new Date(slotStart);
  const end = new Date(slotEnd);

  // Basic sanity
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return false;
  if (end <= start) return false;

  // Duration must match configured slot duration
  const actualDurationMinutes = (end.getTime() - start.getTime()) / 60_000;
  if (actualDurationMinutes !== slotDurationMinutes) return false;

  const now = new Date();
  const minTime = new Date(now.getTime() + minAdvanceHours * 60 * 60 * 1000);
  const maxTime = new Date(now.getTime() + maxAdvanceDays * 24 * 60 * 60 * 1000);

  if (start < minTime || start > maxTime) return false;

  // Weekday must be in schedule
  const weekday = start.getDay();
  const schedule = weeklySchedule.find((s) => s.weekday === weekday);
  if (!schedule) return false;

  // Time must match a generated slot position within the schedule window
  const [startH, startM] = schedule.start.split(':').map(Number);
  const [endH, endM] = schedule.end.split(':').map(Number);

  const scheduledDayStart = new Date(start);
  scheduledDayStart.setHours(startH, startM, 0, 0);

  const scheduledDayEnd = new Date(start);
  scheduledDayEnd.setHours(endH, endM, 0, 0);

  if (start < scheduledDayStart || end > scheduledDayEnd) return false;

  // Check alignment: start time must be a multiple of (slotDuration + buffer)
  // from the schedule start.
  const diffMs = start.getTime() - scheduledDayStart.getTime();
  const stepMs = (slotDurationMinutes + bufferMinutes) * 60 * 1000;
  if (diffMs % stepMs !== 0) return false;

  return true;
}

/**
 * Compute the expected end time for a slot start based on configured duration.
 */
export function getExpectedSlotEnd(slotStart: string): string {
  const start = new Date(slotStart);
  const end = new Date(
    start.getTime() + availabilityConfig.slotDurationMinutes * 60 * 1000,
  );
  return end.toISOString();
}

/**
 * Check if a requested slot is the same as the current one.
 */
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
