import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDemoDashboard, dashboardReducer } from '../../src/features/dashboard/dashboard-model.ts';
import { formatAlertMeasurement, formatAlertTimestamp, getAlertTargetLabel, getMonitoringLabel, orderAlertRecords, summarizeAlertRecords, toActiveDashboardAlerts } from '../../src/features/alerts/alert-model.ts';
import type { AlertRecord } from '../../src/features/alerts/alert-model.ts';

// Synthetic fixtures are test-only; application demo history is always empty.
const activeFixture: AlertRecord = {
  id: 'fixture-active', target: { kind: 'room', roomId: 'room-2' }, deviceId: 'fixture-device',
  detectionRule: 'Test rule', severity: 'warning', timestamp: '2026-11-13T02:30:00Z', status: 'active',
  measuredValue: 0, threshold: 1, unit: 'L/min',
};
const resolvedFixture: AlertRecord = {
  id: 'fixture-resolved', target: { kind: 'main-inlet' }, detectionRule: 'Other test rule',
  severity: 'critical', timestamp: '2026-11-13T03:30:00Z', status: 'resolved',
};

test('initial history is empty and does not imply operational monitoring', () => {
  const initial = createDemoDashboard();
  assert.deepEqual(initial.alertRecords, []);
  assert.equal(initial.monitoringStatus, 'inactive');
  assert.deepEqual(summarizeAlertRecords(initial.alertRecords), { active: 0, resolved: 0, total: 0 });
  assert.equal(getMonitoringLabel(initial.monitoringStatus), 'Monitoring not yet active');
});

test('summary counts follow record status and active projections exclude resolved history', () => {
  assert.deepEqual(summarizeAlertRecords([activeFixture, resolvedFixture]), { active: 1, resolved: 1, total: 2 });
  const projected = toActiveDashboardAlerts([activeFixture, resolvedFixture]);
  assert.deepEqual(projected.map((record) => record.id), ['fixture-active']);
  assert.equal(projected[0].roomId, 'room-2');
  assert.equal(projected[0].message, 'Test rule');
  assert.equal(toActiveDashboardAlerts([{ ...activeFixture, target: { kind: 'main-inlet' } }])[0].roomId, undefined);
});

test('record updates preserve room commands and never activate monitoring automatically', () => {
  const initial = createDemoDashboard();
  const next = dashboardReducer(initial, { type: 'alerts/records-replaced', records: [activeFixture, resolvedFixture], updatedAt: '2026-11-13T04:00:00Z' });
  assert.equal(next.alertRecords.length, 2);
  assert.equal(next.alerts.length, 1);
  assert.equal(next.rooms, initial.rooms);
  assert.equal(next.inlet, initial.inlet);
  assert.equal(next.monitoringStatus, 'inactive');
  const cleared = dashboardReducer(next, { type: 'alerts/records-replaced', records: [], updatedAt: next.updatedAt });
  assert.deepEqual(cleared.alertRecords, []);
  assert.deepEqual(cleared.alerts, []);
  assert.equal(cleared.monitoringStatus, 'inactive');
});

test('monitoring status changes only through its explicit action', () => {
  const initial = createDemoDashboard();
  const next = dashboardReducer(initial, { type: 'monitoring/status-updated', status: 'active' });
  assert.equal(getMonitoringLabel(next.monitoringStatus), 'Monitoring active');
  assert.deepEqual(next.alertRecords, []);
  assert.equal(initial.monitoringStatus, 'inactive');
});

test('room and inlet labels, newest-first ordering, and PHT timestamps retain record meaning', () => {
  const rooms = createDemoDashboard().rooms;
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
