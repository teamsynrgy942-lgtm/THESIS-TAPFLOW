import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures/auth';

test.use({ realtimeEnabled: true });

async function freezeClock(page: Page) {
  const now = Date.now();
  await page.clock.install({ time: new Date(now) });
  const pausedAt = now + 5000;
  await page.clock.pauseAt(new Date(pausedAt));
  return pausedAt;
}

async function telemetryRecords(context: BrowserContext, now: number) {
  const state = {
    pulses: { main: 120, room1: 10, room2: 20, room3: 30 } as Record<string, number>,
    mainFlow: 1.25,
    commandedOn: false,
    calls: [] as URL[],
    hold: null as (() => Promise<void>) | null,
  };
  await context.route('**/rest/v1/**', async (route) => {
    expect(route.request().method()).toBe('GET');
    const url = new URL(route.request().url());
    state.calls.push(url);
    const device = url.searchParams.get('device_id')?.slice(3);
    // Snapshot before waiting, so a later event really can invalidate an in-flight read.
    const json = device ? [{
      id: state.pulses[device], device_id: device, pulses: state.pulses[device],
      sample_ms: 15000, flow_lpm: device === 'main' ? state.mainFlow : null, received_at: new Date(now - 1000).toISOString(),
    }] : (url.searchParams.get('room_id')?.match(/\d+/g)?.map(Number) ?? []).map((room_id) => ({
      room_id, rfid_active: state.commandedOn, valve_commanded_on: state.commandedOn,
      bulb_commanded_on: state.commandedOn, last_seen_at: new Date(now - 1000).toISOString(),
    }));
    if (device === 'main' && state.hold) await state.hold();
    await route.fulfill({ json });
  });
  return state;
}

function mainReads(calls: URL[]) {
  return calls.filter((url) => url.searchParams.get('device_id') === 'eq.main' && !url.searchParams.has('received_at')).length;
}

test('Overview refreshes flow INSERTs and room INSERT/UPDATEs immediately using the existing read paths', async ({ page, context, realtime }) => {
  const now = await freezeClock(page);
  const state = await telemetryRecords(context, now);
  await page.goto('/overview');
  await expect.poll(() => realtime.activeCount).toBe(1);
  await expect(page.locator('.overview-check-time')).toContainText('Last checked');
  const currentJoin = realtime.joins.at(-1)!;
  expect(currentJoin.bindings.map(({ event, schema, table }) => ({ event, schema, table }))).toEqual([
    { event: 'INSERT', schema: 'public', table: 'flow_readings' },
    { event: 'INSERT', schema: 'public', table: 'room_status' },
    { event: 'UPDATE', schema: 'public', table: 'room_status' },
  ]);
  const joins = realtime.joins.length;
  const main = page.getByRole('region', { name: 'Main water inlet' });
  const first = page.getByRole('article', { name: 'Room 1', exact: true });
  await expect(main.getByText('1.25', { exact: true })).toBeVisible();
  await expect(main.getByText('L/min', { exact: true })).toBeVisible();
  await expect(first.getByText('Flow Detected', { exact: true })).toBeVisible();

  state.pulses.main = 240;
  state.mainFlow = 2.80;
  // Payload values are invalidation hints; the UI must display the authenticated query result.
  realtime.change('flow_readings', 'INSERT', { device_id: 'main', pulses: 999, flow_lpm: 99 });
  await expect(main.getByText('2.80', { exact: true })).toBeVisible();
  state.pulses.room1 = 0;
  realtime.change('flow_readings', 'INSERT', { device_id: 'room1', pulses: 999 });
  await expect(first.getByText('No Flow', { exact: true })).toBeVisible();
  state.commandedOn = true;
  realtime.change('room_status', 'INSERT', { room_id: 1 });
  await expect(first.locator('dd')).toHaveText(['No Flow', 'Active', 'ON', 'ON']);
  state.commandedOn = false;
  realtime.change('room_status', 'UPDATE', { room_id: 1 });
  await expect(first.locator('dd')).toHaveText(['No Flow', 'Inactive', 'OFF', 'OFF']);
  await expect(page.locator('.overview-check-time')).toContainText('Last checked');
  expect(realtime.joins).toHaveLength(joins);
  expect(await page.evaluate(() => Date.now())).toBe(now);
});

test('Room Details refreshes selected-room metrics, history, and current chart range without duplicating the channel', async ({ page, context, realtime }) => {
  const now = Date.now();
  await page.clock.install({ time: new Date(now) });
  const state = await telemetryRecords(context, now);
  await page.goto('/rooms/room-1');
  await expect.poll(() => realtime.activeCount).toBe(1);
  await expect(page.locator('.rd-data-status')).toContainText('Last checked:');
  const chartPoint = page.locator('.rd-flow__series circle');
  await expect(chartPoint).toHaveAttribute('aria-label', /\b10 pulses\b/);
  const joins = realtime.joins.length;
  await page.getByRole('radio', { name: '1 hour', exact: true }).check();
  await expect(page.locator('.rd-data-status')).toContainText('Last checked:');
  const before = state.calls.length;
  state.pulses.room1 = 55;
  // Unrelated rows cannot invalidate the selected room.
  realtime.change('flow_readings', 'INSERT', { device_id: 'main' });
  realtime.change('flow_readings', 'INSERT', { device_id: 'room2' });
  realtime.change('room_status', 'UPDATE', { room_id: 2 });
  realtime.change('flow_readings', 'INSERT', { device_id: 'room1' });
  await expect(chartPoint).toHaveAttribute('aria-label', /\b55 pulses\b/);
  await expect(page.locator('.rd-data-status')).toContainText('Last checked:');
  expect(state.calls.length - before).toBe(3);
  expect(state.calls.slice(before).every((url) => url.searchParams.get('device_id') === 'eq.room1'
    || url.searchParams.get('room_id') === 'in.(1)')).toBe(true);
  const chart = state.calls.slice(before).find((url) => url.searchParams.has('received_at'))!;
  const bounds = chart.searchParams.getAll('received_at');
  expect(Date.parse(bounds.find((bound) => bound.startsWith('lte.'))!.slice(4))
    - Date.parse(bounds.find((bound) => bound.startsWith('gte.'))!.slice(4))).toBe(3_600_000);
  await page.getByText('Recorded samples (1)', { exact: true }).click();
  await expect(page.getByRole('table', { name: 'Recorded pulse measurements' }).locator('tbody td:nth-child(2)')).toHaveText(['55']);
  state.commandedOn = true;
  realtime.change('room_status', 'INSERT', { room_id: 1 });
  await expect(page.getByRole('group', { name: 'RFID Session', exact: true }).getByText('Active', { exact: true })).toBeVisible();
  state.commandedOn = false;
  realtime.change('room_status', 'UPDATE', { room_id: 1 });
  await expect(page.getByRole('group', { name: 'Valve Command', exact: true }).getByText('OFF', { exact: true })).toBeVisible();
  expect(realtime.joins).toHaveLength(joins);

  await page.getByRole('navigation', { name: 'Select room' }).getByRole('link', { name: 'Room 2', exact: true }).click();
  await expect(chartPoint).toHaveAttribute('aria-label', /\b20 pulses\b/);
  await expect(page.locator('.rd-data-status')).toContainText('Last checked:');
  const selectedReads = state.calls.length;
  state.pulses.room2 = 66;
  realtime.change('flow_readings', 'INSERT', { device_id: 'room1' });
  realtime.change('flow_readings', 'INSERT', { device_id: 'room2' });
  await expect(chartPoint).toHaveAttribute('aria-label', /\b66 pulses\b/);
  await expect(page.locator('.rd-data-status')).toContainText('Last checked:');
  expect(state.calls.length - selectedReads).toBe(3);
  const elapsed = await page.evaluate(() => Date.now()) - now;
  expect(elapsed).toBeLessThan(20_000);
});

test('events during a pending fetch are coalesced into one follow-up read and channels stop on unmount/logout', async ({ page, context, realtime }) => {
  const now = await freezeClock(page);
  const state = await telemetryRecords(context, now);
  await page.goto('/overview');
  await expect.poll(() => realtime.activeCount).toBe(1);
  await expect(page.locator('.overview-check-time')).toContainText('Last checked');
  const before = mainReads(state.calls);
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  state.hold = () => waiting;
  try {
    state.pulses.main = 241;
    state.mainFlow = 3.14;
    realtime.change('flow_readings', 'INSERT', { device_id: 'main' });
    await expect.poll(() => mainReads(state.calls)).toBe(before + 1);
    state.pulses.main = 242;
    state.mainFlow = 3.41;
    realtime.change('flow_readings', 'INSERT', { device_id: 'main' });
    realtime.change('room_status', 'UPDATE', { room_id: 1 });
    realtime.change('room_status', 'INSERT', { room_id: 2 });
  } finally {
    state.hold = null;
    release();
  }
  await expect(page.getByRole('region', { name: 'Main water inlet' }).getByText('3.41', { exact: true })).toBeVisible();
  await expect(page.locator('.overview-check-time')).toContainText('Last checked');
  expect(mainReads(state.calls)).toBe(before + 2);

  await page.getByRole('button', { name: /^Alerts/ }).click();
  await page.getByRole('link', { name: /^View all alerts/ }).click();
  await expect.poll(() => realtime.activeCount).toBe(0);
  const stopped = state.calls.length;
  realtime.change('flow_readings', 'INSERT', { device_id: 'main' });
  await page.clock.runFor(60_000);
  expect(state.calls).toHaveLength(stopped);
  await page.getByRole('link', { name: 'Room Details', exact: true }).click();
  await expect.poll(() => realtime.activeCount).toBe(1);
  await expect(page.locator('.rd-data-status')).toContainText('Last checked:');
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect.poll(() => realtime.activeCount).toBe(0);
  const afterLogout = state.calls.length;
  await page.clock.runFor(40_000);
  expect(state.calls).toHaveLength(afterLogout);
});

test('joining and reconnecting refresh snapshots missed while Realtime was unavailable', async ({ page, context, realtime }) => {
  const now = await freezeClock(page);
  const state = await telemetryRecords(context, now);
  realtime.acceptJoins = false;
  await page.goto('/overview');
  await expect(page.locator('.overview-check-time')).toContainText('Last checked');
  await expect.poll(() => realtime.joins.length).toBeGreaterThan(1);
  const before = mainReads(state.calls);
  state.pulses.main = 250;
  state.mainFlow = 4.01;
  realtime.resume();
  await expect(page.getByRole('region', { name: 'Main water inlet' }).getByText('4.01', { exact: true })).toBeVisible();
  await expect(page.locator('.overview-check-time')).toContainText('Last checked');
  expect(mainReads(state.calls)).toBe(before + 1);
  const joins = realtime.joins.length;
  await realtime.disconnect();
  state.pulses.main = 251;
  state.mainFlow = 4.12;
  await page.clock.runFor(5000);
  await expect.poll(() => realtime.joins.length).toBeGreaterThan(joins);
  await expect(page.getByRole('region', { name: 'Main water inlet' }).getByText('4.12', { exact: true })).toBeVisible();
  await expect.poll(() => realtime.activeCount).toBe(1);
  expect(await page.evaluate(() => Date.now())).toBe(now + 5000);
});

test('20-second polling remains available when Realtime never subscribes', async ({ page, context, realtime }) => {
  const now = Date.now();
  await page.clock.install({ time: new Date(now) });
  const state = await telemetryRecords(context, now);
  realtime.acceptJoins = false;
  await page.goto('/rooms/room-1');
  const chartPoint = page.locator('.rd-flow__series circle');
  await expect(chartPoint).toHaveAttribute('aria-label', /\b10 pulses\b/);
  await expect(page.locator('.rd-data-status')).toContainText('Last checked:');
  const before = state.calls.length;
  state.pulses.room1 = 77;
  await page.clock.fastForward(20_000);
  await expect(chartPoint).toHaveAttribute('aria-label', /\b77 pulses\b/);
  expect(state.calls.length - before).toBe(3);
  expect(realtime.activeCount).toBe(0);
});
