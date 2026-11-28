import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatActivityTime, selectRoomAlerts } from '../../src/features/rooms/room-details-model.ts';
import type { AlertRecord } from '../../src/features/alerts/alert-model.ts';
import { applyRoomTelemetryReport, buildPulseChart, createRoomTelemetry, formatPulseTimestamp, latestRoomReading, pulseChartSamples, pulseChartWindow } from '../../src/features/rooms/room-telemetry.ts';
import type { FlowReading, RoomTelemetryReport, TelemetryError } from '../../src/features/telemetry/telemetry-types.ts';

test('related alerts contain only active alerts for the selected room', () => {
  const active = { status: 'active', detectionRule: 'room-warning', timestamp: '2026-11-13T17:30:00Z' } as const;
  const alerts: AlertRecord[] = [
    { ...active, id: '1', target: { kind: 'room', roomId: 'room-1' } },
    { ...active, id: '2', target: { kind: 'room', roomId: 'room-2' } },
    { ...active, id: '3', target: { kind: 'main-inlet' } },
    { ...active, id: '4', target: { kind: 'room', roomId: 'room-2' }, status: 'resolved' },
  ];
  assert.deepEqual(selectRoomAlerts(alerts, 'room-2').map((alert) => alert.id), ['2']);
  assert.deepEqual(selectRoomAlerts(alerts, 'room-3'), []);
  assert.equal(alerts.length, 4);
});

test('room check times use PHT across a UTC date boundary', () => {
  assert.equal(formatActivityTime('2026-11-13T17:30:00Z'), '1:30 AM PHT');
});

const pulseReadings: FlowReading[] = [
  { id: 2, device_id: 'room2', pulses: 0, sample_ms: 1000, flow_lpm: null, received_at: '2026-11-15T08:00:00Z' },
  { id: 1, device_id: 'room2', pulses: 21, sample_ms: 2000, flow_lpm: 5, received_at: '2026-11-15T07:59:00Z' },
];
function roomReport(): Extract<RoomTelemetryReport, { status: 'complete' }> {
  return {
    status: 'complete', checkedAt: '2026-11-15T08:00:01Z',
    readings: { status: 'records', rows: pulseReadings },
    chart: { status: 'records', rows: pulseReadings },
    room: { status: 'records', rows: [{ room_id: 2, rfid_active: false, valve_commanded_on: true, bulb_commanded_on: null, timestamps: { last_seen_at: '2026-11-15T07:58:00Z' } }] },
  };
}

test('room telemetry starts empty and selects the newest sample without substituting older calibrated values', () => {
  const initial = createRoomTelemetry();
  assert.equal(initial.readings.loaded, false);
  assert.equal(initial.status.value, null);
  const next = applyRoomTelemetryReport(initial, roomReport());
  assert.equal(latestRoomReading(next).value?.pulses, 0);
  assert.equal(latestRoomReading(next).value?.flow_lpm, null);
  assert.equal(next.status.value?.rfid_active, false);
  assert.equal(next.status.value?.bulb_commanded_on, null);
  assert.equal(next.readings.value?.length, 2);
});

test('pulse chart uses only actual valid samples in timestamp order and preserves raw zero and interval values', () => {
  const samples = pulseChartSamples([
    ...pulseReadings,
    { ...pulseReadings[0], pulses: null },
    { ...pulseReadings[0], pulses: -1 },
    { ...pulseReadings[0], received_at: 'invalid' },
  ]);
  assert.deepEqual(samples.map(({ pulses }) => pulses), [21, 0]);
  assert.equal(samples[0].timestamp, Date.parse(pulseReadings[1].received_at!));
  assert.equal(samples[0].reading.sample_ms, 2000);
  assert.equal(pulseReadings[0].id, 2);
  assert.deepEqual(pulseChartSamples([]), []);
});

test('room refresh keeps transiently unavailable history but clears permission errors independently of status', () => {
  const previous = applyRoomTelemetryReport(createRoomTelemetry(), roomReport());
  const failed = roomReport();
  const error: TelemetryError = { kind: 'network', code: 'FETCH_FAILED', message: 'Unavailable' };
  failed.readings = { status: 'error', error };
  const cached = applyRoomTelemetryReport(previous, failed);
  assert.equal(cached.readings.value, previous.readings.value);
  assert.equal(cached.readings.error, error);
  failed.readings = { status: 'error', error: { ...error, kind: 'permission' } };
  const denied = applyRoomTelemetryReport(cached, failed);
  assert.equal(denied.readings.value, null);
  assert.equal(denied.status.value?.valve_commanded_on, true);
  assert.equal(denied.status.error, null);
  const recovered = applyRoomTelemetryReport(denied, roomReport());
  assert.equal(recovered.readings.error, null);
});

test('a successful empty room result clears all previous samples and authentication failures clear both sources', () => {
  const previous = applyRoomTelemetryReport(createRoomTelemetry(), roomReport());
  const empty = applyRoomTelemetryReport(previous, {
    status: 'complete', checkedAt: '2026-11-15T08:00:02Z',
    readings: { status: 'empty', rows: [] }, chart: { status: 'empty', rows: [] }, room: { status: 'empty', rows: [] },
  });
  assert.deepEqual(empty.readings.value, []);
  assert.equal(latestRoomReading(empty).value, null);
  assert.equal(empty.status.value, null);
  const blocked = applyRoomTelemetryReport(previous, {
    status: 'blocked', checkedAt: '2026-11-15T08:00:03Z',
    error: { kind: 'authentication', code: 'AUTH_REQUIRED', message: 'Sign in' },
  });
  assert.equal(blocked.readings.value, null);
  assert.equal(blocked.status.value, null);
});

const chartNow = Date.parse('2026-11-15T08:00:00Z');
const chartSample = (age: number, pulses = 1, sampleMs: number | null = 15000): FlowReading => ({
  id: age, device_id: 'room2', pulses, sample_ms: sampleMs, flow_lpm: null, received_at: new Date(chartNow - age).toISOString(),
});

test('chart ranges are rolling wall-clock windows with inclusive boundaries and no fallback to days-old readings', () => {
  const readings = [chartSample(0), chartSample(30 * 60_000), chartSample(30 * 60_000 + 1), chartSample(-1), chartSample(4 * 24 * 60 * 60_000)];
  const short = pulseChartWindow('30m', chartNow);
  assert.deepEqual(short, { start: chartNow - 1_800_000, end: chartNow });
  assert.deepEqual(buildPulseChart(readings, short).samples.map((sample) => sample.reading.id), [1_800_000, 0]);
  assert.equal(pulseChartWindow('1h', chartNow).start, chartNow - 3_600_000);
  assert.equal(pulseChartWindow('24h', chartNow).start, chartNow - 86_400_000);
  assert.equal(buildPulseChart([chartSample(4 * 86_400_000)], short).samples.length, 0);
});

test('chronological chart segments connect exactly 45-second gaps but break larger gaps and preserve isolated zero samples', () => {
  const readings = [chartSample(0, 0), chartSample(45_001, 7), chartSample(90_001, 3), chartSample(105_001, 2)];
  const chart = buildPulseChart(readings, pulseChartWindow('30m', chartNow));
  assert.deepEqual(chart.segments.map((segment) => segment.map((sample) => sample.pulses)), [[2, 3, 7], [0]]);
  assert.deepEqual(readings.map((reading) => reading.pulses), [0, 7, 3, 2]);
});

test('chart never rescales other sample intervals and retains duplicate timestamps as separate points', () => {
  const readings = [chartSample(15_000, 8, 1000), chartSample(30_000, 9, null), chartSample(0, 3), chartSample(0, 4)];
  const chart = buildPulseChart(readings, pulseChartWindow('30m', chartNow));
  assert.deepEqual(chart.samples.map((sample) => sample.pulses), [3, 4]);
  assert.equal(chart.otherIntervals, 2);
  assert.deepEqual(chart.segments.map((segment) => segment.length), [1, 1]);
  assert.equal(readings[0].pulses, 8);
});

test('chart filters invalid values without introducing samples or losing real zero-pulse readings', () => {
  const readings = [chartSample(0, 0), { ...chartSample(15_000), pulses: null }, { ...chartSample(30_000), received_at: 'invalid' }];
  const chart = buildPulseChart(readings, pulseChartWindow('30m', chartNow));
  assert.deepEqual(chart.samples.map((sample) => sample.pulses), [0]);
  assert.equal(chart.invalidSamples, 1);
});

test('chart timestamp labels use Philippine Time including the date across midnight', () => {
  const midnight = Date.parse('2026-11-13T17:30:00Z');
  assert.match(formatPulseTimestamp(midnight), /Nov 14, 2026/);
  assert.match(formatPulseTimestamp(midnight), /01:30:00 PHT$/);
  assert.equal(formatPulseTimestamp(midnight, '30m'), '01:30');
  assert.match(formatPulseTimestamp(midnight, '24h'), /Nov 14/);
});

test('chart cache is independent of latest records and is discarded when a different requested range fails', () => {
  const shortWindow = pulseChartWindow('30m', chartNow);
  const previous = applyRoomTelemetryReport(createRoomTelemetry(), roomReport(), shortWindow);
  const failed = roomReport();
  failed.chart = { status: 'error', error: { kind: 'network', code: 'FETCH_FAILED', message: 'Unavailable' } };
  const sameRange = applyRoomTelemetryReport(previous, failed, pulseChartWindow('30m', chartNow + 20_000));
  assert.equal(sameRange.chartReadings.value, previous.chartReadings.value);
  assert.equal(sameRange.readings.error, null);
  const newRange = applyRoomTelemetryReport(previous, failed, pulseChartWindow('24h', chartNow));
  assert.equal(newRange.chartReadings.value, null);
  assert.equal(newRange.chartReadings.error?.kind, 'network');
  assert.equal(newRange.readings.value, previous.readings.value);
});
