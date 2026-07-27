// ============================================================
// Audit regression guard
//
// Verifies that the existing audit booking lifecycle modules still operate
// on public.audit_bookings and that their public API surface has not been
// accidentally changed by the generic booking slice.
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '../../../..');

describe('audit booking lifecycle regression', () => {
  it('still reads from audit_bookings in manageBooking.ts', () => {
    const source = readFileSync(
      resolve(projectRoot, 'src/lib/booking/manageBooking.ts'),
      'utf-8',
    );
    assert.ok(source.includes("from('audit_bookings')"));
    assert.ok(!source.includes("from('bookings')"));
  });

  it('still reads from audit_bookings in cancelBooking.ts', () => {
    const source = readFileSync(
      resolve(projectRoot, 'src/lib/booking/cancelBooking.ts'),
      'utf-8',
    );
    assert.ok(source.includes("from('audit_bookings')"));
    assert.ok(!source.includes("from('bookings')"));
  });

  it('still reads from audit_bookings in rescheduleBooking.ts', () => {
    const source = readFileSync(
      resolve(projectRoot, 'src/lib/booking/rescheduleBooking.ts'),
      'utf-8',
    );
    assert.ok(source.includes("from('audit_bookings')"));
    assert.ok(!source.includes("from('bookings')"));
  });

  it('audit API routes still use the audit lifecycle modules', () => {
    const manageRoute = readFileSync(
      resolve(projectRoot, 'src/pages/api/audit/manage/[token].ts'),
      'utf-8',
    );
    const cancelRoute = readFileSync(
      resolve(projectRoot, 'src/pages/api/audit/cancel.ts'),
      'utf-8',
    );
    const rescheduleRoute = readFileSync(
      resolve(projectRoot, 'src/pages/api/audit/reschedule.ts'),
      'utf-8',
    );

    assert.ok(manageRoute.includes("from '../../../../lib/booking/manageBooking'"));
    assert.ok(cancelRoute.includes("from '../../../lib/booking/cancelBooking'"));
    assert.ok(rescheduleRoute.includes("from '../../../lib/booking/rescheduleBooking'"));
  });
});
