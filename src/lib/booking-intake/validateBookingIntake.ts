// ============================================================
// Booking intake — pure validator
//
// Validates client-submitted intake data against the server-owned
// intake field contract. The client may only submit values for slugs
// that are configured and active; labels, types, required flags and
// limits are always taken from the trusted service configuration.
//
// Normalization:
//   * Text/textareaa values are trimmed.
//   * Empty optional text values are omitted from the stored object.
//   * Number values are kept as numbers.
//   * Single-choice values are stored as the selected option slug.
//   * Multiple-choice values are stored as an array of option slugs;
//     an empty optional array is preserved as [] (explicit "none").
//   * The returned object preserves the configured field order.
// ============================================================

import type {
  BookingServiceIntakeField,
  BookingIntakeValue,
  ValidatedIntake,
  InvalidIntake,
} from './types';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function validateChoiceSlugs(
  field: BookingServiceIntakeField,
  slugs: string[],
): boolean {
  const allowed = new Set(field.options.map((o) => o.slug));
  const seen = new Set<string>();
  for (const slug of slugs) {
    if (!allowed.has(slug) || seen.has(slug)) {
      return false;
    }
    seen.add(slug);
  }
  if (slugs.length < field.minSelections || slugs.length > field.maxSelections) {
    return false;
  }
  return true;
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

    const field = fieldBySlug.get(key)!;
    const value = rawData[key];

    if (field.fieldType === 'text' || field.fieldType === 'textarea') {
      if (typeof value !== 'string') {
        return { code: 'invalid_intake' };
      }
    } else if (field.fieldType === 'number') {
      if (!isFiniteNumber(value)) {
        return { code: 'invalid_intake' };
      }
    } else if (field.fieldType === 'single_choice') {
      if (typeof value !== 'string') {
        return { code: 'invalid_intake' };
      }
    } else if (field.fieldType === 'multiple_choice') {
      if (!isStringArray(value)) {
        return { code: 'invalid_intake' };
      }
    }
  }

  // Build normalized data in the configured field order.
  // Dangerous keys are rejected above, so a plain object is safe here.
  const normalized: Record<string, BookingIntakeValue> = {};

  for (const field of fields) {
    const rawValue = rawData[field.slug];

    if (rawValue === undefined) {
      if (field.isRequired) {
        return { code: 'invalid_intake' };
      }
      continue;
    }

    if (field.fieldType === 'text' || field.fieldType === 'textarea') {
      const value = (rawValue as string).trim();

      if (value.length === 0) {
        if (field.isRequired) {
          return { code: 'invalid_intake' };
        }
        // Empty optional text values are omitted.
        continue;
      }

      if (value.length < field.minLength || value.length > field.maxLength) {
        return { code: 'invalid_intake' };
      }

      normalized[field.slug] = value;
    } else if (field.fieldType === 'number') {
      const value = rawValue as number;

      if (
        field.minValue !== null && value < field.minValue
      ) {
        return { code: 'invalid_intake' };
      }
      if (field.maxValue !== null && value > field.maxValue) {
        return { code: 'invalid_intake' };
      }

      normalized[field.slug] = value;
    } else if (field.fieldType === 'single_choice') {
      const value = (rawValue as string).trim();

      if (value.length === 0 || !validateChoiceSlugs(field, [value])) {
        return { code: 'invalid_intake' };
      }

      normalized[field.slug] = value;
    } else if (field.fieldType === 'multiple_choice') {
      const value = rawValue as string[];

      if (!validateChoiceSlugs(field, value)) {
        return { code: 'invalid_intake' };
      }

      // Optional empty multiple_choice lists are normalized to absence.
      if (value.length === 0 && !field.isRequired) {
        continue;
      }

      normalized[field.slug] = value;
    }
  }

  return { data: normalized };
}
