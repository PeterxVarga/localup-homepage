// ============================================================
// Booking intake — domain types
//
// Pure-domain types used by the configurable intake validator.
// No DB client or framework imports here.
// ============================================================

export type BookingIntakeFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'single_choice'
  | 'multiple_choice';

export interface BookingServiceIntakeFieldOption {
  id: string;
  siteId: string;
  serviceId: string;
  intakeFieldId: string;
  slug: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

export interface BookingServiceIntakeField {
  id: string;
  siteId: string;
  serviceId: string;
  slug: string;
  label: string;
  fieldType: BookingIntakeFieldType;
  isRequired: boolean;
  // Text/textareaa bounds.
  minLength: number;
  maxLength: number;
  // Number bounds.
  minValue: number | null;
  maxValue: number | null;
  // Choice bounds.
  minSelections: number;
  maxSelections: number;
  sortOrder: number;
  isActive: boolean;
  options: BookingServiceIntakeFieldOption[];
}

export interface PublicIntakeFieldOption {
  slug: string;
  label: string;
}

export interface PublicIntakeField {
  slug: string;
  label: string;
  fieldType: BookingIntakeFieldType;
  isRequired: boolean;
  minLength: number;
  maxLength: number;
  minValue: number | null;
  maxValue: number | null;
  minSelections: number;
  maxSelections: number;
  options: PublicIntakeFieldOption[];
}

export type BookingIntakeValue = string | number | string[];
export type BookingIntakeData = Record<string, BookingIntakeValue>;

export interface ValidatedIntake {
  data: BookingIntakeData;
}

export interface InvalidIntake {
  code: 'invalid_intake';
}

export class BookingIntakeError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'BookingIntakeError';
    this.code = code;
  }
}
