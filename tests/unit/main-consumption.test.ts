import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateMainConsumption, getPhilippineDay } from '../../src/features/overview/main-consumption.ts';
import type { MainConsumptionReading } from '../../src/features/overview/main-consumption.ts';

const midnight = Date.parse('2026-12-31T16:00:00.000Z');

function sample(id: string | number, seconds: number, overrides: Partial<MainConsumptionReading> = {}): MainConsumptionReading {
  return { id, device_id: 'main', flow_lpm: 4, sample_ms: 15_000, received_at: new Date(midnight + seconds * 1000).toISOString(), ...overrides };
}

test('the Philippine day changes at 16:00 UTC, including across calendar years', () => {
  assert.deepEqual(getPhilippineDay(midnight - 1), { start: midnight - 86_400_000, end: midnight });
  assert.deepEqual(getPhilippineDay(midnight), { start: midnight, end: midnight + 86_400_000 });
});

test('sums rate times measured duration within the current day, counting each Main reading once', () => {
  const readings = [
    sample(4, 30, { flow_lpm: 3, sample_ms: 18_000 }),
    sample(1, 0, { flow_lpm: 2 }),
    sample(2, 15, { flow_lpm: 0 }),
    sample('4', 30, { flow_lpm: 3, sample_ms: 18_000 }),
    sample(5, -1),
    sample(6, 86_400),
    sample(7, 38),
    sample(8, 29, { device_id: 'room1' }),
  ];
  assert.deepEqual(calculateMainConsumption(readings, midnight + 37_000), { liters: 1.4, incomplete: false });
});

test('a recorded zero is usable, while invalid values leave the total unavailable without usable samples', () => {
  const invalid = [
    sample(1, 15, { flow_lpm: null }),
    sample(2, 15, { flow_lpm: -1 }),
    sample(3, 15, { flow_lpm: Infinity }),
    sample(4, 15, { sample_ms: null }),
    sample(5, 15, { sample_ms: 0 }),
    sample(6, 15, { sample_ms: NaN }),
  ];
  assert.deepEqual(calculateMainConsumption(invalid, midnight + 16_000), { liters: null, incomplete: false });
  assert.deepEqual(calculateMainConsumption([sample(7, 15, { flow_lpm: 0 })], midnight + 16_000), { liters: 0, incomplete: false });
  assert.deepEqual(calculateMainConsumption([...invalid, sample(7, 15, { flow_lpm: 0 })], midnight + 16_000), { liters: 0, incomplete: true });
});

test('labels gaps at the start, between samples, or after the last expected report', () => {
  assert.deepEqual(calculateMainConsumption([sample(1, 30)], midnight + 31_000), { liters: 1, incomplete: true });
  assert.deepEqual(calculateMainConsumption([sample(1, 15), sample(2, 45)], midnight + 46_000), { liters: 2, incomplete: true });
  assert.deepEqual(calculateMainConsumption([sample(1, 15)], midnight + 36_000), { liters: 1, incomplete: true });
  assert.deepEqual(calculateMainConsumption([sample(1, 17), sample(2, 34)], midnight + 44_000), { liters: 2, incomplete: false });
});
