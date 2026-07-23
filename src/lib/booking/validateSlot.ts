// ============================================================
// Slot validation against the service-managed availability rules
// ============================================================

import { getAvailabilityBundle } from '../availability/queries';
import { formatAvailabilityDate } from '../availability/timezone';
import { generateCandidateSlots } from './generateSlots';
import { getExpectedSlotEnd as getExpectedSlotEndFromDuration } from './intervals';
import type { BookingServiceContext } from '../booking-service/types';

/**
 * Validate duration, notice, horizon, weekday/custom override and grid
 * alignment using the same candidate generator as the public endpoint.
 * This intentionally does not check bookings or Google Calendar.
 */
export async function isSlotValidAccordingToRules(
  slotStart: string,
  slotEnd: string,
  service: BookingServiceContext,
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

  const dateKey = formatAvailabilityDate(start, service.timezone);
  if (formatAvailabilityDate(end, service.timezone) !== dateKey) return false;

  const bundle = await getAvailabilityBundle(service.scheduleId, dateKey, dateKey);
  return generateCandidateSlots(bundle, service, now).some((day) =>
    day.slots.some(
      (slot) =>
        slot.start === start.toISOString() && slot.end === end.toISOString(),
    ),
  );
}

/** Compute the expected end using the service-configured slot duration. */
export function getExpectedSlotEnd(
  slotStart: string,
  service: BookingServiceContext,
): string {
  return getExpectedSlotEndFromDuration(slotStart, service.durationMinutes);
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
