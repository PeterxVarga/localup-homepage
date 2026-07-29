// ============================================================
// Booking intake — pure validator
//
// Validates client-submitted intake data against the server-owned
// intake field contract. The client may only submit values for slugs
// that are configured and active; labels, types, required flags and
// limits are always taken from the trusted service configuration.
//
// Normalization:
//   * Values are trimmed.
//   * Empty optional values are omitted from the stored object.
//   * The returned object preserves the configured field order.
// ============================================================

import type { BookingServiceIntakeField } from './types';

export interface ValidatedIntake {
  data: Record<string, string>;
}

export interface InvalidIntake {
  code: 'invalid_intake';
}

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate and normalize client intake data against the active service
 * intake field contract.
 *
 * @returns The normalized data object on success, or an error code on failure.
 */
export function validateBookingIntake(
  raw: unknown,
  fields: BookingServiceIntakeField[],
): ValidatedIntake | InvalidIntake {
  const rawData = isPlainObject(raw) ? raw : {};

  const fieldBySlug = new Map<string, BookingServiceIntakeField>();
  for (const field of fields) {
    fieldBySlug.set(field.slug, field);
  }

  // Validate all submitted keys first.
  for (const key of Object.keys(rawData)) {
    if (DANGEROUS_KEYS.has(key)) {
      return { code: 'invalid_intake' };
    }

    if (!fieldBySlug.has(key)) {
      return { code: 'invalid_intake' };
    }

    const value = rawData[key];
    if (typeof value !== 'string') {
      return { code: 'invalid_intake' };
    }
  }

  // Build normalized data in the configured field order.
  // Dangerous keys are rejected above, so a plain object is safe here.
  const normalized: Record<string, string> = {};

  for (const field of fields) {
    const rawValue = rawData[field.slug];

    if (rawValue === undefined) {
      if (field.isRequired) {
        return { code: 'invalid_intake' };
      }
      continue;
    }

    const value = (rawValue as string).trim();

    if (value.length === 0) {
      if (field.isRequired) {
        return { code: 'invalid_intake' };
      }
      // Empty optional values are omitted from the stored object.
      continue;
    }

    if (value.length < field.minLength || value.length > field.maxLength) {
      return { code: 'invalid_intake' };
    }

    normalized[field.slug] = value;
  }

  return { data: normalized };
}
