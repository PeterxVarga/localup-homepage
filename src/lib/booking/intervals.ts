// ============================================================
// Booking — pure interval helpers
//
// Shared between audit and generic booking modules. No external dependencies.
// ============================================================

export const MINUTE_MS = 60_000;

/**
 * Compute the expected slot end from a start time and a duration in minutes.
 */
export function getExpectedSlotEnd(
  slotStart: string,
  durationMinutes: number,
): string {
  const start = new Date(slotStart);
  if (Number.isNaN(start.getTime())) {
    throw new RangeError('Invalid slot start');
  }

  return new Date(start.getTime() + durationMinutes * MINUTE_MS).toISOString();
}

/**
 * Compute the blocked interval for a candidate slot.
 * The blocked range includes the service buffers and is what the exclusion
 * constraint checks for overlap protection.
 */
export function computeBlockedRange(
  slotStart: string,
  slotEnd: string,
  bufferBeforeMinutes: number,
  bufferAfterMinutes: number,
): { blockedStart: string; blockedEnd: string } {
  const start = new Date(slotStart);
  const end = new Date(slotEnd);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new RangeError('Invalid slot boundaries');
  }

  return {
    blockedStart: new Date(
      start.getTime() - bufferBeforeMinutes * MINUTE_MS,
    ).toISOString(),
    blockedEnd: new Date(
      end.getTime() + bufferAfterMinutes * MINUTE_MS,
    ).toISOString(),
  };
}

/**
 * Check whether two half-open intervals [aStart, aEnd) and [bStart, bEnd)
 * overlap.
 */
export function intervalsOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}
