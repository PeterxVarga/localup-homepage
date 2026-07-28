// ============================================================
// Public quote request validation — unit tests
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { quoteRequestSchema } from '../validation';

function makeUuid(prefix: string, index: number): string {
  const suffix = String(index).padStart(12, '0');
  return `${prefix}-4111-9111-${suffix}`;
}

describe('quoteRequestSchema', () => {
  const validOptionId1 = '11111111-1111-4111-9111-111111111111';
  const validOptionId2 = '22222222-2222-4222-a222-222222222222';

  it('accepts a valid array of UUID optionIds', () => {
    const result = quoteRequestSchema.safeParse({
      optionIds: [validOptionId1, validOptionId2],
    });
    assert.equal(result.success, true);
  });

  it('rejects non-array optionIds', () => {
    const result = quoteRequestSchema.safeParse({
      optionIds: validOptionId1,
    });
    assert.equal(result.success, false);
  });

  it('rejects invalid UUIDs', () => {
    const result = quoteRequestSchema.safeParse({
      optionIds: ['not-a-uuid'],
    });
    assert.equal(result.success, false);
  });

  it('rejects more than 20 optionIds', () => {
    const ids = Array.from({ length: 21 }, (_, i) => makeUuid('11111111', i));
    const result = quoteRequestSchema.safeParse({ optionIds: ids });
    assert.equal(result.success, false);
  });

  it('rejects extra fields', () => {
    const result = quoteRequestSchema.safeParse({
      optionIds: [validOptionId1],
      price: 1000,
    });
    assert.equal(result.success, false);
  });

  it('rejects missing optionIds', () => {
    const result = quoteRequestSchema.safeParse({});
    assert.equal(result.success, false);
  });
});
