// ============================================================
// Booking intake — domain types
//
// Pure-domain types used by the configurable intake validator.
// No DB client or framework imports here.
// ============================================================

export type BookingIntakeFieldType = 'text' | 'textarea';

export interface BookingServiceIntakeField {
  id: string;
  siteId: string;
  serviceId: string;
  slug: string;
  label: string;
  fieldType: BookingIntakeFieldType;
  isRequired: boolean;
  minLength: number;
  maxLength: number;
  sortOrder: number;
  isActive: boolean;
}

export interface PublicIntakeField {
  slug: string;
  label: string;
  fieldType: BookingIntakeFieldType;
  isRequired: boolean;
  minLength: number;
  maxLength: number;
}

export class BookingIntakeError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'BookingIntakeError';
    this.code = code;
  }
}
