// ============================================================
// Booking pricing — intake-driven option resolver
//
// Authoritatively derives pricing options from validated intake data.
// The canonical example is dog-weight-kg → dog-size mapping, but the
// rule is generic: if a service has an active `dog-weight-kg` number
// intake field and an active `dog-size` single-choice pricing option
// group, the backend chooses the size option; the client cannot pick
// a cheaper/inconsistent size.
//
// Rules:
//   * If weight is provided, exactly zero dog-size options may also be
//     selected by the client (the backend supplies the authoritative one).
//   * If weight is absent, the client must provide exactly one dog-size
//     option through optionIds.
//   * If both weight and a conflicting size option are sent, the result
//     is invalid_selection.
// ============================================================

import type {
  BookingIntakeData,
  BookingServiceIntakeField,
} from '../booking-intake/types';
import type {
  BookingServiceOption,
  BookingServiceOptionGroup,
} from './types';

export interface IntakeOptionResolution {
  optionIds: string[];
}

export interface IntakeOptionResolutionError {
  error: 'invalid_intake' | 'invalid_selection';
}

const DOG_WEIGHT_SLUG = 'dog-weight-kg';
const DOG_SIZE_GROUP_SLUG = 'dog-size';

function weightToSizeSlug(kg: number): string | null {
  if (kg >= 1 && kg <= 10) {
    return 'small';
  }
  if (kg > 10 && kg <= 25) {
    return 'medium';
  }
  if (kg > 25 && kg <= 40) {
    return 'large';
  }
  if (kg > 40 && kg <= 100) {
    return 'extra-large';
  }
  return null;
}

/**
 * Resolve pricing option IDs from intake data.
 *
 * The function never trusts client-supplied option IDs for size when a
 * weight is present. It returns either the effective option ID list or a
 * public error code.
 */
export function resolveIntakeOptions(
  optionIds: string[],
  intakeData: BookingIntakeData,
  fields: BookingServiceIntakeField[],
  groups: BookingServiceOptionGroup[],
  options: BookingServiceOption[],
): IntakeOptionResolution | IntakeOptionResolutionError {
  const sizeGroup = groups.find(
    (g) => g.isActive && g.slug === DOG_SIZE_GROUP_SLUG,
  );
  const weightField = fields.find(
    (f) => f.isActive && f.slug === DOG_WEIGHT_SLUG,
  );

  // No weight/size contract on this service: pass option IDs through.
  if (!sizeGroup || !weightField) {
    return { optionIds };
  }

  const rawWeight = intakeData[DOG_WEIGHT_SLUG];
  const hasWeight = rawWeight !== undefined;

  const sizeOptions = options.filter(
    (o) => o.isActive && o.optionGroupId === sizeGroup.id,
  );
  const selectedSizeOptions = sizeOptions.filter((o) => optionIds.includes(o.id));

  if (hasWeight) {
    if (typeof rawWeight !== 'number') {
      return { error: 'invalid_intake' };
    }

    const expectedSlug = weightToSizeSlug(rawWeight);
    if (!expectedSlug) {
      return { error: 'invalid_intake' };
    }

    const expectedOption = sizeOptions.find((o) => o.slug === expectedSlug);
    if (!expectedOption) {
      return { error: 'invalid_selection' };
    }

    if (selectedSizeOptions.length > 0) {
      // The client also selected a size. It must match the derived one.
      if (
        selectedSizeOptions.length !== 1 ||
        selectedSizeOptions[0].slug !== expectedSlug
      ) {
        return { error: 'invalid_selection' };
      }
    }

    const effective = new Set(optionIds);
    effective.add(expectedOption.id);
    return { optionIds: Array.from(effective) };
  }

  // Weight absent: the client must choose the size explicitly.
  if (selectedSizeOptions.length === 0) {
    return { error: 'invalid_selection' };
  }

  return { optionIds };
}
