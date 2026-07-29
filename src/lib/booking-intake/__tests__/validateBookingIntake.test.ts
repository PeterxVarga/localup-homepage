// ============================================================
// Booking intake validator — unit tests
//
// Tests the pure intake-data validator without a database.
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateBookingIntake } from '../validateBookingIntake';
import type { BookingServiceIntakeField } from '../types';

function makeField(
  overrides: Partial<BookingServiceIntakeField> & { slug: string },
): BookingServiceIntakeField {
  return {
    id: `${overrides.slug}-id`,
    siteId: '11111111-1111-1111-1111-111111111111',
    serviceId: '22222222-2222-2222-2222-222222222222',
    label: overrides.slug,
    fieldType: 'text',
    isRequired: false,
    minLength: 0,
    maxLength: 100,
    sortOrder: 0,
    isActive: true,
    ...overrides,
  };
}

const requiredBreed = makeField({
  slug: 'dog-breed',
  label: 'Kutyafajta',
  isRequired: true,
  minLength: 2,
  maxLength: 50,
  sortOrder: 0,
});

const optionalNotes = makeField({
  slug: 'temperament-notes',
  label: 'Temperamentum',
  fieldType: 'textarea',
  isRequired: false,
  minLength: 0,
  maxLength: 500,
  sortOrder: 1,
});

const fields = [requiredBreed, optionalNotes];

describe('validateBookingIntake', () => {
  it('accepts valid required and optional values', () => {
    const result = validateBookingIntake(
      { 'dog-breed': '  Golden Retriever ', 'temperament-notes': 'Friendly' },
      fields,
    );

    assert.equal('code' in result, false);
    if ('code' in result) return;
    assert.equal(result.data['dog-breed'], 'Golden Retriever');
    assert.equal(result.data['temperament-notes'], 'Friendly');
  });

  it('omits empty optional values from the normalized data', () => {
    const result = validateBookingIntake(
      { 'dog-breed': 'Beagle', 'temperament-notes': '   ' },
      fields,
    );

    assert.equal('code' in result, false);
    if ('code' in result) return;
    assert.equal(result.data['dog-breed'], 'Beagle');
    assert.equal('temperament-notes' in result.data, false);
  });

  it('rejects missing required fields', () => {
    const result = validateBookingIntake(
      { 'temperament-notes': 'Shy' },
      fields,
    );

    assert.equal('code' in result, true);
    if (!('code' in result)) return;
    assert.equal(result.code, 'invalid_intake');
  });

  it('rejects empty required values', () => {
    const result = validateBookingIntake(
      { 'dog-breed': '   ', 'temperament-notes': 'Shy' },
      fields,
    );

    assert.equal('code' in result, true);
    if (!('code' in result)) return;
    assert.equal(result.code, 'invalid_intake');
  });

  it('rejects values below minLength', () => {
    const result = validateBookingIntake({ 'dog-breed': 'A' }, fields);

    assert.equal('code' in result, true);
    if (!('code' in result)) return;
    assert.equal(result.code, 'invalid_intake');
  });

  it('rejects values above maxLength', () => {
    const result = validateBookingIntake(
      { 'dog-breed': 'a'.repeat(51) },
      fields,
    );

    assert.equal('code' in result, true);
    if (!('code' in result)) return;
    assert.equal(result.code, 'invalid_intake');
  });

  it('rejects unknown field slugs', () => {
    const result = validateBookingIntake(
      { 'dog-breed': 'Beagle', 'unknown-field': 'x' },
      fields,
    );

    assert.equal('code' in result, true);
    if (!('code' in result)) return;
    assert.equal(result.code, 'invalid_intake');
  });

  it('rejects non-string values', () => {
    const result = validateBookingIntake(
      { 'dog-breed': 123 as unknown as string },
      fields,
    );

    assert.equal('code' in result, true);
    if (!('code' in result)) return;
    assert.equal(result.code, 'invalid_intake');
  });

  it('rejects dangerous keys', () => {
    const raw = JSON.parse(
      '{"dog-breed":"Beagle","__proto__":"evil"}',
    ) as Record<string, unknown>;
    const result = validateBookingIntake(raw, fields);

    assert.equal('code' in result, true);
    if (!('code' in result)) return;
    assert.equal(result.code, 'invalid_intake');
  });

  it('rejects constructor key from JSON.parse', () => {
    const raw = JSON.parse(
      '{"dog-breed":"Beagle","constructor":"evil"}',
    ) as Record<string, unknown>;
    const result = validateBookingIntake(raw, fields);

    assert.equal('code' in result, true);
    if (!('code' in result)) return;
    assert.equal(result.code, 'invalid_intake');
  });

  it('rejects prototype key from JSON.parse', () => {
    const raw = JSON.parse(
      '{"dog-breed":"Beagle","prototype":"evil"}',
    ) as Record<string, unknown>;
    const result = validateBookingIntake(raw, fields);

    assert.equal('code' in result, true);
    if (!('code' in result)) return;
    assert.equal(result.code, 'invalid_intake');
  });

  it('returns an empty normalized object when no fields are configured and no data is sent', () => {
    const result = validateBookingIntake({}, []);

    assert.equal('code' in result, false);
    if ('code' in result) return;
    assert.deepEqual(result.data, {});
  });

  it('rejects unknown slugs when no fields are configured', () => {
    const result = validateBookingIntake({ 'dog-breed': 'Beagle' }, []);

    assert.equal('code' in result, true);
    if (!('code' in result)) return;
    assert.equal(result.code, 'invalid_intake');
  });

  it('preserves configured field order in the normalized object', () => {
    const result = validateBookingIntake(
      { 'temperament-notes': 'Calm', 'dog-breed': 'Poodle' },
      fields,
    );

    assert.equal('code' in result, false);
    if ('code' in result) return;
    assert.deepEqual(Object.keys(result.data), ['dog-breed', 'temperament-notes']);
  });
});
