import assert from 'node:assert/strict';
import test from 'node:test';
import { getSelectedShiftRange } from '../services/productionReportService.js';

test('selected Day shift uses 07:30 to 19:30 IST on the selected date', () => {
  const range = getSelectedShiftRange('2026-09-27', 'DAY');

  assert.equal(range.date, '2026-09-27');
  assert.equal(range.start.toISOString(), '2026-09-27T02:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-09-27T14:00:00.000Z');
});

test('selected Night shift uses 19:30 IST to 07:30 IST on the next date', () => {
  const range = getSelectedShiftRange('2026-09-27', 'NIGHT');

  assert.equal(range.date, '2026-09-27');
  assert.equal(range.start.toISOString(), '2026-09-27T14:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-09-28T02:00:00.000Z');
});

test('selected shift rejects unsupported shift names', () => {
  assert.throws(
    () => getSelectedShiftRange('2026-09-27', 'EVENING'),
    /shift must be DAY or NIGHT/,
  );
});
