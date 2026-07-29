import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateMockQuote,
  createMockPricingConfig,
  createMockSlots,
} from '../dogGrooming';

test('matches the reference full-grooming small dog quote', () => {
  const config = createMockPricingConfig('full-grooming');
  const ids = config.optionGroups
    .flatMap((group) => group.options)
    .filter((option) =>
      ['small', 'slightly-matted', 'short-manageable'].includes(option.slug),
    )
    .map((option) => option.id);

  const quote = calculateMockQuote(config, ids, {
    'dog-weight-kg': 8,
  });

  assert.equal(quote.priceMinMinor, 16_900);
  assert.equal(quote.priceMaxMinor, 20_900);
  assert.equal(quote.durationMinMinutes, 110);
  assert.equal(quote.durationMaxMinutes, 140);
});

test('generates selectable slots with the quoted maximum duration', () => {
  const days = createMockSlots(140, new Date('2026-08-03T12:00:00+02:00'));

  assert.ok(days.length >= 10);
  assert.ok(days.every((day) => day.slots.length > 0));

  const slot = days[0]?.slots[0];
  assert.ok(slot);
  assert.equal(
    (Date.parse(slot.end) - Date.parse(slot.start)) / 60_000,
    140,
  );
});
