import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoRoomHistories, formatActivityTime, formatHistoryDate, selectRoomAlerts } from '../../src/features/rooms/room-details-model.ts';
import type { DashboardAlert } from '../../src/features/dashboard/dashboard-model.ts';

test('all rooms start without fabricated flow, usage, or activity records', () => {
  for (const history of Object.values(demoRoomHistories)) {
    assert.deepEqual(history, { flowReadings: [], usageRecords: [], activities: [] });
  }
  assert.notEqual(demoRoomHistories['room-1'], demoRoomHistories['room-2']);
});

test('related alerts contain only alerts for the selected room', () => {
  const alerts: DashboardAlert[] = [
    { id: '1', roomId: 'room-1', severity: 'warning', message: 'Room 1 demo warning' },
    { id: '2', roomId: 'room-2', severity: 'critical', message: 'Room 2 demo warning' },
    { id: '3', severity: 'warning', message: 'System demo warning' },
  ];
  assert.deepEqual(selectRoomAlerts(alerts, 'room-2').map((alert) => alert.id), ['2']);
  assert.deepEqual(selectRoomAlerts(alerts, 'room-3'), []);
  assert.equal(alerts.length, 3);
});

test('historical date and activity labels use PHT across a UTC date boundary', () => {
  assert.equal(formatHistoryDate('2026-11-13T17:30:00Z'), 'Nov 14, 2026');
  assert.equal(formatActivityTime('2026-11-13T17:30:00Z'), '1:30 AM PHT');
});
