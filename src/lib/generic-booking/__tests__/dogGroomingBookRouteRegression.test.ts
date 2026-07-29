import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const bookRouteSource = readFileSync(
  new URL(
    '../../../pages/api/booking/[siteSlug]/[serviceSlug]/book.ts',
    import.meta.url,
  ),
  'utf8',
);

describe('dog grooming book route regression', () => {
  it('passes intake data to the booking preflight quote', () => {
    assert.match(
      bookRouteSource,
      /calculateQuoteForService\(\s*service,\s*input\.optionIds,\s*input\.intakeData,\s*\)/,
    );
  });
});
