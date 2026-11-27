import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDashboardState } from '../../src/features/dashboard/dashboard-model.ts';
import { formatAlertMeasurement, formatAlertTimestamp, getAlertTargetLabel, incidentKey, orderAlertRecords, selectNewNotificationIds, toActiveDashboardAlerts } from '../../src/features/alerts/alert-model.ts';
import type { AlertRecord } from '../../src/features/alerts/alert-model.ts';
import { parseR1Alert, parseR1AlertId, parseStoredAlert, R1_ALERT_CODE } from '../../src/features/alerts/r1-alert-model.ts';

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

test('an active incident in one room does not hide a different room or code', () => {
  const roomTwo = { ...activeFixture, id: 'room-2-r1', target: { kind: 'room' as const, roomId: 'room-2' as const }, detectionRule: 'R1_MISSING_FLOW_SIGNAL' };
  const roomThree = { ...roomTwo, id: 'room-3-r1', target: { kind: 'room' as const, roomId: 'room-3' as const } };
  const otherCode = { ...roomTwo, id: 'room-2-other', detectionRule: 'OTHER_CODE' };
  const active = toActiveDashboardAlerts([roomTwo, roomThree, otherCode, resolvedFixture]);
  assert.deepEqual(active.map((record) => record.id), ['room-2-r1', 'room-3-r1', 'room-2-other']);
  assert.equal(incidentKey(roomTwo) === incidentKey(roomThree), false);
  assert.equal(incidentKey(roomTwo) === incidentKey(otherCode), false);
});

test('notifications are emitted once and still include a later room', () => {
  const known = new Set(['room-1']);
  const notified = new Set<string>();
  const inserted = new Set(['room-2']);
  const records = [
    { ...activeFixture, id: 'room-1', status: 'active' as const },
    { ...activeFixture, id: 'room-2', status: 'active' as const },
    { ...activeFixture, id: 'room-2-dup', status: 'resolved' as const },
  ];
  const first = selectNewNotificationIds(records, known, notified, inserted, true);
  assert.deepEqual(first, ['room-2']);
  notified.add('room-2');
  inserted.add('room-2');
  assert.deepEqual(selectNewNotificationIds(records, known, notified, inserted, true), []);
  const roomThree = { ...activeFixture, id: 'room-3', status: 'active' as const };
  assert.deepEqual(selectNewNotificationIds([...records, roomThree], known, notified, new Set(), true), ['room-3']);
});

test('stored alerts keep other codes and still reject an invalid R1 row', () => {
  const other = parseStoredAlert({ ...backendR1, id: '7', code: 'OTHER_CODE', status: 'ACTIVE', evidence: { api_key: 'hidden', note: 'kept' } });
  assert.ok(other);
  assert.equal(other.detectionRule, 'OTHER_CODE');
  assert.equal(other.status, 'active');
  assert.equal(other.evidence?.some((item) => item.value === 'hidden'), false);
  assert.equal(other.evidence?.some((item) => item.value === 'kept'), true);
  assert.equal(parseStoredAlert({ ...backendR1, code: R1_ALERT_CODE, room_id: 4 }), null);
});
