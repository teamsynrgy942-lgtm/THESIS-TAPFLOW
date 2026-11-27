import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyTelemetryReport, createOverviewTelemetry, currentCommandLabel, currentFlowDisplay, flowActivityLabel, reportingFreshness, reportingLabel, roomReportingTime } from '../../src/features/overview/overview-telemetry.ts';
import { observeReportingTimestamps, timestampChange } from '../../src/features/telemetry/heartbeat-observation.ts';
import type { FlowReading, RoomStatus, TelemetryReport } from '../../src/features/telemetry/telemetry-types.ts';

const now = Date.parse('2026-11-14T10:00:00Z');
const fresh = new Date(now - 10_000).toISOString();
const stale = new Date(now - 180_000).toISOString();
const flow: FlowReading = { id: 1, device_id: 'main', pulses: 120, sample_ms: 1000, flow_lpm: null, received_at: fresh };
const status: RoomStatus = { room_id: 1, rfid_active: false, valve_commanded_on: true, bulb_commanded_on: null, timestamps: { last_seen_at: stale, updated_at: fresh } };

function report(): Extract<TelemetryReport, { status: 'complete' }> {
  return {
    status: 'complete', checkedAt: fresh,
    readings: {
      main: { status: 'records', rows: [flow, { ...flow, id: 0, flow_lpm: 2.5, received_at: stale }] },
      room1: { status: 'records', rows: [{ ...flow, device_id: 'room1', pulses: 0, flow_lpm: 0 }] },
      room2: { status: 'empty', rows: [] }, room3: { status: 'empty', rows: [] },
    },
    rooms: { 1: { status: 'records', rows: [status] }, 2: { status: 'empty', rows: [] }, 3: { status: 'empty', rows: [] } },
  };
}

test('Overview starts without demo readings or assumed command states', () => {
  const initial = createOverviewTelemetry();
  assert.equal(initial.checkedAt, null);
  for (const resource of [...Object.values(initial.readings), ...Object.values(initial.rooms)]) {
    assert.equal(resource.loaded, false);
    assert.equal(resource.value, null);
  }
});

test('latest records preserve null calibration, zero pulses, and nullable commanded states', () => {
  const result = applyTelemetryReport(createOverviewTelemetry(), report());
  assert.deepEqual(result.readings.main.value, flow);
  assert.equal(result.readings.main.value?.flow_lpm, null);
  assert.equal(result.readings.room1.value?.flow_lpm, 0);
  assert.equal(result.readings.room1.value?.pulses, 0);
  assert.deepEqual(result.rooms[1].value, status);
  assert.equal(result.readings.room2.value, null);
  assert.equal(result.readings.room2.loaded, true);
});

test('room freshness prefers last_seen_at over fresh flow receipts and unrelated updates', () => {
  assert.equal(roomReportingTime(status, flow), stale);
  assert.equal(reportingFreshness(roomReportingTime(status, flow), now), 'stale');
  const missingHeartbeat = { ...status, timestamps: { last_seen_at: null, updated_at: fresh } };
  assert.equal(roomReportingTime(missingHeartbeat, flow), fresh);
  assert.equal(roomReportingTime(missingHeartbeat, null), null);
});

test('reporting freshness ages from stored timestamps and never claims live or offline', () => {
  assert.equal(reportingFreshness(fresh, now), 'recent');
  assert.equal(reportingFreshness(new Date(now - 120_000).toISOString(), now), 'recent');
  assert.equal(reportingFreshness(new Date(now - 120_001).toISOString(), now), 'stale');
  assert.equal(reportingLabel(stale, now), 'No recent data');
  assert.equal(reportingLabel(null, now), 'No recent data');
  assert.equal(reportingFreshness('bad timestamp', now), 'unknown');
  assert.equal(reportingFreshness(new Date(now + 60_000).toISOString(), now), 'unknown');
});

test('failed refresh keeps last known records and their original timestamps; success with no rows clears them', () => {
  const original = applyTelemetryReport(createOverviewTelemetry(), report());
  const failed = report();
  failed.checkedAt = new Date(now + 180_000).toISOString();
  failed.readings.main = { status: 'error', error: { kind: 'network', code: 'FETCH_FAILED', message: 'Network unavailable' } };
  const next = applyTelemetryReport(original, failed);
  assert.equal(next.readings.main.value, original.readings.main.value);
  assert.equal(reportingFreshness(next.readings.main.value?.received_at, now + 180_000), 'stale');
  assert.equal(next.readings.room1.error, null);
  const empty = report();
  empty.readings.main = { status: 'empty', rows: [] };
  assert.equal(applyTelemetryReport(next, empty).readings.main.value, null);
  assert.equal(applyTelemetryReport(next, report()).readings.main.error, null);
});

test('authentication and permission failures remove cached values instead of showing inaccessible records', () => {
  const original = applyTelemetryReport(createOverviewTelemetry(), report());
  for (const kind of ['authentication', 'permission'] as const) {
    const next = applyTelemetryReport(original, { status: 'blocked', checkedAt: fresh, error: { kind, code: 'DENIED', message: 'Denied' } });
    assert.equal(next.readings.main.value, null);
    assert.equal(next.rooms[1].value, null);
    assert.equal(next.readings.main.error?.kind, kind);
  }
});

test('current commands require a recent room heartbeat and preserve explicit false and null values', () => {
  const record = { loaded: true, error: null, value: { ...status, timestamps: { last_seen_at: fresh } } };
  assert.equal(currentCommandLabel(record, 'rfid_active', now, 'Active', 'Inactive'), 'Inactive');
  assert.equal(currentCommandLabel(record, 'valve_commanded_on', now, 'Open', 'Closed'), 'Open');
  assert.equal(currentCommandLabel(record, 'bulb_commanded_on', now, 'On', 'Off'), 'Unknown');
  assert.equal(currentCommandLabel({ ...record, loaded: false }, 'rfid_active', now, 'Active', 'Inactive'), 'Loading…');
});

test('stale, missing, invalid, and future heartbeats make current states unknown without overwriting stored commands', () => {
  for (const timestamp of [stale, null, 'invalid', new Date(now + 1000).toISOString()]) {
    const record = { loaded: true, error: null, value: { ...status, rfid_active: true, bulb_commanded_on: true, timestamps: { last_seen_at: timestamp, updated_at: fresh } } };
    assert.equal(currentCommandLabel(record, 'rfid_active', now, 'Active', 'Inactive'), 'Unknown');
    assert.equal(currentCommandLabel(record, 'valve_commanded_on', now, 'Open', 'Closed'), 'Unknown');
    assert.equal(currentCommandLabel(record, 'bulb_commanded_on', now, 'On', 'Off'), 'Unknown');
    assert.equal(record.value.rfid_active, true);
    assert.equal(record.value.valve_commanded_on, true);
    assert.equal(record.value.bulb_commanded_on, true);
  }
});

test('current state expires strictly after two minutes and resumes only when the status timestamp advances', () => {
  const initial = report();
  initial.rooms[1] = { status: 'records', rows: [{ ...status, timestamps: { last_seen_at: fresh } }] };
  let state = applyTelemetryReport(createOverviewTelemetry(), initial);
  const received = Date.parse(fresh);
  assert.equal(currentCommandLabel(state.rooms[1], 'valve_commanded_on', received + 120_000, 'Open', 'Closed'), 'Open');
  assert.equal(currentCommandLabel(state.rooms[1], 'valve_commanded_on', received + 120_001, 'Open', 'Closed'), 'Unknown');
  const flowOnly = report();
  flowOnly.checkedAt = new Date(now + 180_000).toISOString();
  flowOnly.rooms[1] = initial.rooms[1];
  flowOnly.readings.room1 = { status: 'records', rows: [{ ...flow, device_id: 'room1', received_at: flowOnly.checkedAt }] };
  state = applyTelemetryReport(state, flowOnly);
  assert.equal(currentCommandLabel(state.rooms[1], 'valve_commanded_on', now + 180_000, 'Open', 'Closed'), 'Unknown');
  flowOnly.rooms[1] = { status: 'records', rows: [{ ...status, timestamps: { last_seen_at: flowOnly.checkedAt } }] };
  state = applyTelemetryReport(state, flowOnly);
  assert.equal(currentCommandLabel(state.rooms[1], 'valve_commanded_on', now + 180_000, 'Open', 'Closed'), 'Open');
});

test('Main and room current flow displays age from received_at while the original record remains available', () => {
  const record = { loaded: true, error: null, value: { ...flow, flow_lpm: 0 } };
  assert.deepEqual(currentFlowDisplay(record, now), { value: '0.00', unit: 'L/min' });
  assert.deepEqual(currentFlowDisplay(record, now + 180_000), { value: 'Unknown' });
  assert.equal(record.value.flow_lpm, 0);
  assert.deepEqual(currentFlowDisplay({ ...record, value: flow }, now + 180_000), { value: 'Unavailable' });
  assert.deepEqual(currentFlowDisplay({ ...record, value: null }, now), { value: 'Unavailable' });
  assert.deepEqual(currentFlowDisplay({ ...record, value: { ...flow, flow_lpm: -1 } }, now), { value: 'Unavailable' });
});

test('flow activity requires a recent valid pulse count and distinguishes a measured zero from missing data', () => {
  const now = Date.parse('2026-11-15T08:00:00Z');
  const reading = { ...flow, received_at: new Date(now).toISOString() };
  const label = (pulses: number | null, time = now) => flowActivityLabel({
    value: { ...reading, pulses }, loaded: true, error: null,
  }, time);
  assert.equal(label(4), 'Flow Detected');
  assert.equal(label(0), 'No Flow');
  for (const invalid of [null, -1, Number.NaN, 1.5]) assert.equal(label(invalid), 'Unknown');
  assert.equal(label(0, now + 120_001), 'Unknown');
  assert.equal(label(4, now - 1), 'Unknown');
});

test('timestamp observations distinguish a baseline, advancement, unchanged values, regression, and invalid clocks', () => {
  assert.equal(timestampChange(null, fresh, now), 'baseline');
  assert.equal(timestampChange(stale, fresh, now), 'advanced');
  assert.equal(timestampChange(fresh, fresh, now), 'unchanged');
  assert.equal(timestampChange(fresh, stale, now), 'regressed');
  assert.equal(timestampChange(fresh, null, now), 'unavailable');
  assert.equal(timestampChange(fresh, 'invalid', now), 'unavailable');
  assert.equal(timestampChange(fresh, new Date(now + 1000).toISOString(), now), 'unavailable');
});

test('flow uploads cannot verify status-heartbeat advancement; each source is observed independently', () => {
  const previous = report();
  const current = report();
  current.readings.main = { status: 'records', rows: [{ ...flow, received_at: new Date(now).toISOString() }] };
  current.readings.room1 = { status: 'records', rows: [{ ...flow, device_id: 'room1', received_at: new Date(now).toISOString() }] };
  let observations = observeReportingTimestamps(previous, current, now);
  assert.equal(observations.find((row) => row.name === 'Main')?.change, 'advanced');
  assert.equal(observations.find((row) => row.name === 'Room 1')?.change, 'unchanged');
  current.rooms[1] = { status: 'records', rows: [{ ...status, timestamps: { last_seen_at: fresh } }] };
  observations = observeReportingTimestamps(previous, current, now);
  assert.equal(observations.find((row) => row.name === 'Room 1')?.change, 'advanced');
  assert.equal(observations.find((row) => row.name === 'Room 1')?.current, fresh);
  assert.equal(observations.find((row) => row.name === 'Room 1')?.source, 'room_status.last_seen_at');
});

test('timestamp-read errors never count as reporting progress', () => {
  const current = report();
  current.rooms[1] = { status: 'error', error: { kind: 'network', code: 'FETCH_FAILED', message: 'Unavailable' } };
  assert.equal(observeReportingTimestamps(report(), current, now).find((row) => row.name === 'Room 1')?.change, 'error');
});
