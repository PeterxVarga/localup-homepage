// ============================================================
// Generic booking — domain types
// Framework-neutral; used by the public /api/booking routes.
// ============================================================

export interface GenericBookingInput {
  name: string;
  email: string;
  phone?: string;
  notes?: string;
  slotStart: string;
  slotEnd: string;
  optionIds: string[];
  locale?: string;
  intakeData?: import('../booking-intake/types').BookingIntakeData;
}

export interface GenericBookingResult {
  success: true;
  bookingId: string;
  slotStart: string;
  slotEnd: string;
}

export type GenericBookingErrorCode =
  | 'slot_taken'
  | 'invalid_slot'
  | 'invalid_intake'
  | 'invalid_selection'
  | 'service_unavailable'
  | 'db_error';

export interface GenericBookingError {
  success: false;
  error: GenericBookingErrorCode;
  message: string;
}

export type GenericBookingOutcome = GenericBookingResult | GenericBookingError;
