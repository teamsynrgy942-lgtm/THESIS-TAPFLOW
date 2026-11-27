import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPulseChart, pulseChartWindow } from '../../src/features/rooms/room-telemetry.ts';
import type { FlowReading } from '../../src/features/telemetry/telemetry-types.ts';

const now = Date.parse('2026-11-27T04:00:00Z');

function sample(age: number, pulses: number, id: number): FlowReading {
  return { id, device_id: 'room1', pulses, sample_ms: 15000, flow_lpm: null, received_at: new Date(now - age).toISOString() };
}

test('a measured zero stays on the chart and a long gap is not treated as zero pulses', () => {
  const chart = buildPulseChart([
    sample(120_000, 10, 1),
    sample(105_000, 0, 2),
    sample(0, 4, 3),
  ], pulseChartWindow('30m', now));
  assert.deepEqual(chart.samples.map((point) => point.pulses), [10, 0, 4]);
  assert.equal(chart.gaps.length, 1);
  assert.equal(chart.segments.length, 2);
  assert.equal(chart.segments[0].some((point) => point.pulses === 0), true);
});

test('samples without a receipt time are omitted instead of plotted as zero', () => {
  const chart = buildPulseChart([
    { ...sample(10_000, 3, 1), received_at: null },
    sample(5_000, 0, 2),
  ], pulseChartWindow('5m', now));
  assert.deepEqual(chart.samples.map((point) => point.pulses), [0]);
  assert.equal(chart.invalidSamples, 0);
});
