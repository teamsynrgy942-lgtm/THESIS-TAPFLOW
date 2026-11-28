import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDashboardState } from '../../src/features/dashboard/dashboard-model.ts';
import { formatAlertMeasurement, formatAlertTimestamp, getAlertTargetLabel, orderAlertRecords, toActiveDashboardAlerts } from '../../src/features/alerts/alert-model.ts';
import type { AlertRecord } from '../../src/features/alerts/alert-model.ts';
import { parseR1Alert, parseR1AlertId, parseTapFlowAlert, R1_ALERT_CODE, R2_ALERT_CODE } from '../../src/features/alerts/r1-alert-model.ts';

// Synthetic alert records are confined to tests.
const activeFixture: AlertRecord = {
  id: 'fixture-active', target: { kind: 'room', roomId: 'room-2' }, deviceId: 'fixture-device',
  detectionRule: 'Test rule', severity: 'warning', timestamp: '2026-11-13T02:30:00Z', status: 'active',
  measuredValue: 0, threshold: 1, unit: 'L/min',
};
const resolvedFixture: AlertRecord = {
  id: 'fixture-resolved', target: { kind: 'main-inlet' }, detectionRule: 'Other test rule',
  severity: 'critical', timestamp: '2026-11-13T03:30:00Z', status: 'resolved',
};

test('initial history and related alerts start empty', () => {
  const initial = createDashboardState();
  assert.deepEqual(initial.alertRecords, []);
  assert.deepEqual(initial.alerts, []);
});

test('history keeps resolved records while related alerts include active records only', () => {
  const records = [activeFixture, resolvedFixture];
  const state = createDashboardState(records);
  assert.notEqual(state.alertRecords, records);
  assert.deepEqual(state.alertRecords, records);
  assert.deepEqual(state.alerts.map((record) => record.id), ['fixture-active']);
  assert.equal(state.alerts[0].roomId, 'room-2');
  assert.equal(state.alerts[0].message, 'Test rule');
  assert.equal(toActiveDashboardAlerts([{ ...activeFixture, target: { kind: 'main-inlet' } }])[0].roomId, undefined);
});

test('room and inlet labels, newest-first ordering, and PHT timestamps retain record meaning', () => {
  const rooms = createDashboardState().rooms;
  assert.equal(getAlertTargetLabel(activeFixture.target, rooms), 'Room 2');
  assert.equal(getAlertTargetLabel(resolvedFixture.target, rooms), 'Main water inlet');
  const input = [activeFixture, resolvedFixture];
  assert.deepEqual(orderAlertRecords(input).map((record) => record.id), ['fixture-resolved', 'fixture-active']);
  assert.equal(input[0].id, 'fixture-active');
  const timestamp = formatAlertTimestamp('2026-11-13T17:30:00Z');
  assert.match(timestamp, /Nov 14, 2026/);
  assert.match(timestamp, /1:30 AM/);
  assert.equal(formatAlertTimestamp('missing'), 'Timestamp unavailable');
});

test('optional measurements retain zero and do not manufacture missing or invalid values', () => {
  assert.equal(formatAlertMeasurement(0, 'L/min'), '0 L/min');
  assert.equal(formatAlertMeasurement(1.25), '1.25');
  assert.equal(formatAlertMeasurement(undefined, 'L/min'), null);
  assert.equal(formatAlertMeasurement(Number.NaN), null);
});

test('all four severity levels are retained in active projections', () => {
  for (const severity of ['info', 'warning', 'critical', 'emergency'] as const) {
    assert.equal(toActiveDashboardAlerts([{ ...activeFixture, severity }])[0].severity, severity);
  }
});

const backendR1 = {
  id: '9007199254740993', room_id: 1, code: R1_ALERT_CODE, status: 'RESOLVED',
  detected_at: '2026-11-23T17:30:00+00:00', resolved_at: '2026-11-23T17:45:00+00:00',
  evidence: {
    main_flow_threshold_lpm: 0.5, room_sample_count: 0, main_sample_count: 4,
    room_latest_at: 'malformed', main_latest_at: '2026-11-23T17:29:50+00:00',
    note: '  Verify water path isolation.  ', secret: 'not displayed',
  },
};

test('R1 history preserves backend status, identifiers, and recognized evidence', () => {
  const record = parseR1Alert(backendR1);
  assert.ok(record);
  assert.equal(record.id, backendR1.id);
  assert.deepEqual(record.target, { kind: 'room', roomId: 'room-1' });
  assert.equal(record.detectionRule, R1_ALERT_CODE);
  assert.equal(record.status, 'resolved');
  assert.equal(record.timestamp, backendR1.detected_at);
  assert.equal(record.resolvedAt, backendR1.resolved_at);
  assert.equal(record.severity, undefined);
  assert.match(record.description!, /Room 1 reported zero flow pulses/);
  assert.deepEqual(record.evidence, [
    { label: 'Main flow threshold', value: '0.5 L/min' },
    { label: 'Main samples', value: '4' },
    { label: 'Room samples', value: '0' },
    {
      label: 'Latest Main sample', value: 'Nov 24, 2026, 1:29 AM PHT',
      dateTime: backendR1.evidence.main_latest_at,
    },
    { label: 'Note', value: 'Verify water path isolation.' },
  ]);
  assert.deepEqual(toActiveDashboardAlerts([record]), []);
  const active = parseR1Alert({ ...backendR1, id: 42, status: 'ACTIVE', room_id: '2' });
  assert.ok(active);
  assert.equal(active.status, 'active');
  assert.equal(active.resolvedAt, undefined);
  assert.equal(toActiveDashboardAlerts([active])[0].roomId, 'room-2');
});

test('R1 rejects unsupported rows and avoids imprecise primary keys or local timestamps', () => {
  assert.equal(parseR1AlertId(12), '12');
  assert.equal(parseR1AlertId(Number.MAX_SAFE_INTEGER + 1), null);
  for (const fields of [
    { code: 'unrecognized' }, { room_id: 4 }, { status: 'UNKNOWN' },
    { detected_at: '2026-11-23T17:30:00' }, { id: '' },
  ]) assert.equal(parseR1Alert({ ...backendR1, ...fields }), null);
});

test('R1 retains separate detection and resolution audit details without inventing legacy values', () => {
  const lastDetectedAt = '2026-11-23T17:40:00+00:00';
  const resolvedBy = '2798728a-3904-44b5-8f7e-7db63213e10b';
  const record = parseR1Alert({ ...backendR1, last_detected_at: lastDetectedAt, resolved_by: resolvedBy });
  assert.ok(record);
  assert.equal(record.timestamp, backendR1.detected_at);
  assert.equal(record.lastDetectedAt, lastDetectedAt);
  assert.equal(record.resolvedAt, backendR1.resolved_at);
  assert.equal(record.resolvedBy, resolvedBy);
  const legacy = parseR1Alert(backendR1);
  assert.equal(legacy?.lastDetectedAt, undefined);
  assert.equal(legacy?.resolvedBy, undefined);
  const active = parseR1Alert({ ...backendR1, status: 'ACTIVE', resolved_by: resolvedBy });
  assert.equal(active?.resolvedBy, undefined);
  for (const invalid of ['missing', '2026-11-23T17:40:00', null, 42]) {
    assert.equal(parseR1Alert({ ...backendR1, last_detected_at: invalid })?.lastDetectedAt, undefined);
  }
  for (const invalid of ['staff', '', null, 42]) {
    assert.equal(parseR1Alert({ ...backendR1, resolved_by: invalid })?.resolvedBy, undefined);
  }
});

const backendR2 = {
  id: '73', room_id: 2, code: R2_ALERT_CODE, status: 'ACTIVE', detected_at: '2026-11-23T17:30:00+00:00',
  evidence: {
    previous_pulses: 0, latest_pulses: 17, sample_ms: 1000, minimum_pulses_per_sample: 3, confirmation_samples: 2,
    rfid_active: false, valve_commanded_on: false, status_reported_at: '2026-11-23T17:29:50+00:00',
    last_observed_at: '2026-11-23T17:30:00+00:00', flow_lpm: 0.5,
  },
};

test('R2 presents raw pulse evidence, false device status and Philippine timestamps', () => {
  const record = parseTapFlowAlert(backendR2);
  assert.ok(record);
  assert.equal(record.detectionRule, R2_ALERT_CODE);
  assert.equal(record.title, 'Unauthorized Water Flow');
  assert.equal(record.message, record.title);
  assert.equal(record.timestamp, backendR2.detected_at);
  assert.equal(record.status, 'active');
  assert.equal(record.resolvedAt, undefined);
  assert.deepEqual(record.evidence, [
    { label: 'Previous pulses', value: '0' },
    { label: 'Latest pulses', value: '17' },
    { label: 'Sample interval', value: '1000 ms' },
    { label: 'Minimum pulses per sample', value: '3' },
    { label: 'Confirmation samples', value: '2' },
    { label: 'RFID active', value: 'No' },
    { label: 'Valve commanded on', value: 'No' },
    { label: 'Status reported at', value: 'Nov 24, 2026, 1:29 AM PHT', dateTime: backendR2.evidence.status_reported_at },
    { label: 'Last observed at', value: 'Nov 24, 2026, 1:30 AM PHT', dateTime: backendR2.evidence.last_observed_at },
  ]);
  assert.equal(parseR1Alert(backendR2), null);
});

test('R2 maps all three room IDs and gives each room its own description', () => {
  for (const room of [1, 2, 3]) {
    for (const room_id of [room, String(room)]) {
      const record = parseTapFlowAlert({ ...backendR2, room_id });
      assert.deepEqual(record?.target, { kind: 'room', roomId: `room-${room}` });
      assert.equal(record?.description, `Room ${room} reported sustained water-flow pulses while recent room status indicated an inactive RFID session and a valve commanded OFF.`);
    }
  }
  assert.equal(parseTapFlowAlert({ ...backendR2, room_id: 4 }), null);
});

test('R2 history retains resolved incidents with partial evidence', () => {
  const resolvedAt = '2026-11-23T17:45:00+00:00';
  const record = parseTapFlowAlert({
    ...backendR2, status: 'RESOLVED', resolved_at: resolvedAt,
    evidence: { latest_pulses: -1, rfid_active: false, status_reported_at: '2026-11-23T17:30:00', last_observed_at: null },
  });
  assert.ok(record);
  assert.equal(record.status, 'resolved');
  assert.equal(record.resolvedAt, resolvedAt);
  assert.deepEqual(record.evidence, [{ label: 'RFID active', value: 'No' }]);
  assert.deepEqual(toActiveDashboardAlerts([record]), []);
});
