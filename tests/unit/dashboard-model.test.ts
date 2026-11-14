import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDemoDashboard, dashboardReducer, formatUpdateTime, getRoomSummary } from '../../src/features/dashboard/dashboard-model.ts';

test('partial room updates retain device state, room identity, and the other rooms', () => {
  const initial = createDemoDashboard();
  const active = dashboardReducer(initial, {
    type: 'room/updated', roomId: 'room-2', updatedAt: '2026-11-13T03:00:00Z',
    changes: { status: 'active', rfidSession: 'active', valveCommand: 'open', lightCommand: 'on', currentFlow: 2.75 },
  });
  const next = dashboardReducer(active, {
    type: 'room/updated', roomId: 'room-2', updatedAt: '2026-11-13T03:00:05Z',
    changes: { currentFlow: 3.25, usedToday: 5 },
  });
  assert.equal(next.rooms[1].id, 'room-2');
  assert.equal(next.rooms[1].status, 'active');
  assert.equal(next.rooms[1].rfidSession, 'active');
  assert.equal(next.rooms[1].valveCommand, 'open');
  assert.equal(next.rooms[1].lightCommand, 'on');
  assert.equal(next.rooms[1].currentFlow, 3.25);
  assert.equal(next.rooms[1].usedToday, 5);
  assert.equal(next.rooms[0], initial.rooms[0]);
  assert.equal(next.rooms[2], initial.rooms[2]);
  assert.equal(initial.rooms[1].status, 'idle');
  assert.equal(next.updatedAt, '2026-11-13T03:00:05Z');
});

test('inlet updates merge measurements without changing room commands', () => {
  const initial = createDemoDashboard();
  const flowing = dashboardReducer(initial, {
    type: 'inlet/updated', changes: { currentFlow: 4.5, totalVolumeToday: 12 }, updatedAt: '2026-11-13T03:01:00Z',
  });
  const next = dashboardReducer(flowing, {
    type: 'inlet/updated', changes: { totalVolumeToday: 15 }, updatedAt: '2026-11-13T03:02:00Z',
  });
  assert.deepEqual(next.inlet, { currentFlow: 4.5, totalVolumeToday: 15 });
  assert.equal(next.rooms, initial.rooms);
});

test('alerts can be received and cleared without changing device commands', () => {
  const initial = createDemoDashboard();
  const alerted = dashboardReducer(initial, {
    type: 'alerts/replaced', alerts: [{ id: 'demo-1', roomId: 'room-3', severity: 'warning', message: 'Example alert' }],
    updatedAt: '2026-11-13T03:03:00Z',
  });
  assert.equal(alerted.alerts.length, 1);
  assert.equal(alerted.rooms, initial.rooms);
  const cleared = dashboardReducer(alerted, { type: 'alerts/replaced', alerts: [], updatedAt: '2026-11-13T03:04:00Z' });
  assert.equal(cleared.alerts.length, 0);
});

test('the overview summary follows room status changes', () => {
  const initial = createDemoDashboard();
  assert.equal(getRoomSummary(initial.rooms), 'All three rooms are idle.');
  const next = dashboardReducer(initial, {
    type: 'room/updated', roomId: 'room-1', changes: { status: 'active' }, updatedAt: initial.updatedAt,
  });
  assert.equal(getRoomSummary(next.rooms), '1 room active.');
});

test('update times use the PHT timezone from the design', () => {
  assert.equal(formatUpdateTime('2026-11-13T02:30:00Z'), '10:30 AM PHT');
});
