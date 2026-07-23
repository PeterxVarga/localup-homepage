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

function toEpochMs(value: string | Date): number {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid timestamp: ${value}`);
  }
  return date.getTime();
}

/**
 * Check whether two half-open intervals [aStart, aEnd) and [bStart, bEnd)
 * overlap.
 *
 * Accepts ISO strings in any equivalent format (e.g. .000Z or +02:00) and
 * Date objects. Invalid timestamps throw RangeError (fail-closed).
 */
export function intervalsOverlap(
  aStart: string | Date,
  aEnd: string | Date,
  bStart: string | Date,
  bEnd: string | Date,
): boolean {
  const a0 = toEpochMs(aStart);
  const a1 = toEpochMs(aEnd);
  const b0 = toEpochMs(bStart);
  const b1 = toEpochMs(bEnd);

  if (a1 <= a0) {
    throw new RangeError('Invalid interval: aEnd must be after aStart');
  }
  if (b1 <= b0) {
    throw new RangeError('Invalid interval: bEnd must be after bStart');
  }

  return a0 < b1 && b0 < a1;
}
