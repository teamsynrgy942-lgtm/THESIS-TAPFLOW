import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatUpdateTime } from '../../src/features/dashboard/dashboard-model.ts';

test('update times use the PHT timezone from the design', () => {
  assert.equal(formatUpdateTime('2026-11-13T02:30:00Z'), '10:30 AM PHT');
});
