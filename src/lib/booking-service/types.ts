// ============================================================
// Booking service — domain types
// ============================================================

export interface BookingServiceConfig {
  durationMinutes: number;
  slotIntervalMinutes: number;
  minimumNoticeMinutes: number;
  bookingWindowDays: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  cancelCutoffHours: number;
  rescheduleCutoffHours: number;
  maxReschedules: number;
}

export interface BookingServiceContext extends BookingServiceConfig {
  siteId: string;
  siteSlug: string;
  timezone: string;
  serviceId: string;
  serviceSlug: string;
  scheduleId: string;
}

export class BookingServiceError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'BookingServiceError';
    this.code = code;
  }
}
