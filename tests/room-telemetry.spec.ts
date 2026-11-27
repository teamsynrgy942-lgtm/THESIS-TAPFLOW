import { expect, test } from './fixtures/auth';

test('selected room uses authenticated bounded reads and charts raw pulse history without deriving volume', async ({ page, context, auth }) => {
  let verified = false;
  let flowReads = 0;
  let statusReads = 0;
  const received = new Date(Date.now() - 1000).toISOString();
  const readings = [
    { id: 4, device_id: 'room2', pulses: 31, sample_ms: 15000, flow_lpm: null, received_at: received },
    { id: 3, device_id: 'room2', pulses: 0, sample_ms: 15000, flow_lpm: null, received_at: new Date(Date.now() - 30_000).toISOString() },
    { id: 2, device_id: 'room2', pulses: 17, sample_ms: 15000, flow_lpm: 9, received_at: new Date(Date.now() - 60_000).toISOString() },
    { id: 1, device_id: 'room2', pulses: 3, sample_ms: null, flow_lpm: null, received_at: null },
  ];
  await context.route('**/auth/v1/user', async (route) => {
    verified = true;
    await route.fulfill({ json: auth.session.user });
  });
  await context.route('**/rest/v1/**', async (route) => {
    expect(verified).toBe(true);
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers().authorization === `Bearer ${auth.session.access_token}`).toBe(true);
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/flow_readings')) {
      flowReads++;
      expect(url.searchParams.get('device_id')).toBe('eq.room2');
      if (url.searchParams.has('received_at')) {
        expect(url.searchParams.get('limit')).toBe('1000');
        expect(url.searchParams.get('order')).toBe('received_at.asc,id.asc');
      } else {
        expect(url.searchParams.get('limit')).toBe('60');
        expect(url.searchParams.get('order')).toBe('received_at.desc.nullslast');
      }
      await route.fulfill({ json: readings });
    } else {
      statusReads++;
      expect(url.pathname.endsWith('/room_status')).toBe(true);
      expect(url.searchParams.get('room_id')).toBe('in.(2)');
      expect(url.searchParams.get('limit')).toBe('1');
      expect(url.searchParams.get('order')).toBe('last_seen_at.desc.nullslast');
      await route.fulfill({ json: [{ room_id: 2, rfid_active: true, valve_commanded_on: false, bulb_commanded_on: null, last_seen_at: received }] });
    }
  });
  await page.goto('/rooms/room-2');
  const metrics = page.getByRole('region', { name: 'Room 2 reported metrics' });
  await expect(metrics.getByRole('group', { name: 'Raw pulses' })).toContainText('31 pulses');
  await expect(metrics.getByText('Active', { exact: true })).toBeVisible();
  await expect(metrics.getByText('OFF', { exact: true })).toBeVisible();
  await expect(metrics.getByText('Unknown', { exact: true })).toBeVisible();
  await expect(metrics.getByText(/15000 ms|Not calibrated|L\/min/)).toHaveCount(0);
  await expect(page.getByRole('group', { name: '3 pulse measurements; pulses per sample, by received timestamp' })).toBeVisible();
  await expect(page.locator('.rd-flow__series circle')).toHaveCount(3);
  const latestPoint = page.getByRole('button', { name: /31 pulses, 15000 ms measurement interval/ });
  await latestPoint.focus();
  await expect(page.getByRole('tooltip').locator('time')).toHaveAttribute('datetime', received);
  await page.getByText('Recorded samples (4)', { exact: true }).click();
  const history = page.getByRole('table', { name: 'Recorded pulse measurements' });
  await expect(history.locator('tbody tr')).toHaveCount(4);
  await expect(history.locator('tbody tr td:nth-child(2)')).toHaveText(['31', '0', '17', '3']);
  await expect(history.locator('tbody tr td:nth-child(3)')).toHaveText(['15000', '15000', '15000', 'Unavailable']);
  await expect(page.getByText('L/min', { exact: true })).toHaveCount(0);
  expect(flowReads).toBe(2);
  expect(statusReads).toBe(1);
});

test('Room Details distinguishes loading and empty records without assuming zero flow or inactive commands', async ({ page, context }) => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await context.route('**/rest/v1/**', async (route) => {
    await waiting;
    await route.fulfill({ json: [] });
  });
  try {
    await page.goto('/rooms/room-1');
    await expect(page.getByText('Loading pulse measurements…', { exact: true })).toBeVisible();
    for (const label of ['Raw pulses', 'RFID Session', 'Valve Command', 'Light Command']) {
      await expect(page.getByRole('group', { name: label, exact: true }).getByText('Loading…', { exact: true })).toBeVisible();
    }
  } finally { release(); }
  await expect(page.getByText('No measurements during this period', { exact: true })).toBeVisible();
  await expect(page.locator('.rd-room-status')).toContainText('Missing Data');
  await expect(page.getByRole('group', { name: 'Raw pulses', exact: true })).toContainText('Missing data');
  await expect(page.getByRole('region', { name: 'Room 1 reported metrics' }).getByText('Unknown', { exact: true })).toHaveCount(3);
  await expect(page.locator('.rd-pulse-history')).toHaveCount(0);
  await expect(page.locator('.rd-flow__series')).toHaveCount(0);
  await expect(page.getByText('0.00', { exact: true })).toHaveCount(0);
});

test('room reporting uses the heartbeat first and never treats unrelated updates as connectivity', async ({ page, context }) => {
  const recent = new Date(Date.now() - 1000).toISOString();
  const stale = new Date(Date.now() - 300_000).toISOString();
  await context.route('**/rest/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/room_status')) {
      const id = Number(url.searchParams.get('room_id')?.match(/\d+/)?.[0]);
      await route.fulfill({ json: [{
        room_id: id, rfid_active: false, valve_commanded_on: true, bulb_commanded_on: false,
        last_seen_at: id === 1 ? stale : id === 2 ? recent : null, updated_at: recent,
      }] });
    } else {
      const device = url.searchParams.get('device_id')?.slice(3);
      await route.fulfill({ json: [{ id: 1, device_id: device, pulses: 0, sample_ms: 1000, flow_lpm: null, received_at: device === 'room1' ? recent : stale }] });
    }
  });
  await page.goto('/rooms/room-1');
  await expect(page.locator('.rd-room-status')).toContainText('Stale');
  await expect(page.getByRole('group', { name: 'Raw pulses' })).toContainText('0 pulses');
  for (const name of ['RFID Session', 'Valve Command', 'Light Command']) {
    await expect(page.getByRole('group', { name })).toContainText('Unknown');
  }
  await page.getByRole('navigation', { name: 'Select room' }).getByRole('link', { name: 'Room 2', exact: true }).click();
  await expect(page.locator('.rd-room-status')).toContainText('ON');
  await expect(page.getByRole('group', { name: 'Raw pulses' })).toContainText('Unknown');
  await expect(page.getByRole('group', { name: 'Valve Command' })).toContainText('ON');
  await page.getByRole('navigation', { name: 'Select room' }).getByRole('link', { name: 'Room 3', exact: true }).click();
  await expect(page.locator('.rd-room-status')).toContainText('Stale');
  await expect(page.getByText('Offline', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Light Command' })).toContainText('Unknown');
});

test('20-second refresh retains labeled transient failures, clears denied history, recovers, and stops on Alerts', async ({ page, context }) => {
  const start = Date.now();
  const timestamp = new Date(start - 1000).toISOString();
  await page.clock.install({ time: new Date(start) });
  let mode: 'records' | 'network' | 'permission' | 'empty' = 'records';
  let flowReads = 0;
  await context.route('**/rest/v1/**', async (route) => {
    expect(route.request().method()).toBe('GET');
    const url = new URL(route.request().url());
    const flow = url.pathname.endsWith('/flow_readings');
    if (flow && !url.searchParams.has('received_at')) flowReads++;
    if (mode === 'network') return route.fulfill({ status: 503, json: { message: 'Temporarily unavailable' } });
    if (mode === 'permission' && flow) return route.fulfill({ status: 403, json: { code: '42501', message: 'Access denied' } });
    if (mode === 'empty') return route.fulfill({ json: [] });
    await route.fulfill({ json: flow
      ? [{ id: flowReads, device_id: 'room1', pulses: flowReads * 11, sample_ms: 15000, flow_lpm: null, received_at: timestamp }]
      : [{ room_id: 1, rfid_active: false, valve_commanded_on: false, bulb_commanded_on: false, last_seen_at: timestamp }] });
  });
  await page.goto('/rooms/room-1');
  await expect(page.getByRole('button', { name: /\b11 pulses\b/ })).toBeVisible();
  await page.clock.runFor(20_000);
  await expect(page.getByRole('button', { name: /\b22 pulses\b/ })).toBeVisible();
  expect(flowReads).toBe(2);
  mode = 'network';
  await page.clock.runFor(20_000);
  await expect(page.getByRole('alert')).toHaveCount(3);
  await expect(page.getByRole('alert').filter({ hasText: 'Last known records shown.' })).toHaveCount(2);
  await expect(page.getByRole('button', { name: /\b22 pulses\b/ })).toBeVisible();
  await page.clock.runFor(120_000);
  await expect(page.locator('.rd-room-status')).toContainText('Stale');
  mode = 'permission';
  await page.clock.runFor(20_000);
  await expect(page.getByRole('alert')).toHaveCount(2);
  for (const error of await page.getByRole('alert').all()) await expect(error).toContainText('Access denied');
  await expect(page.locator('.rd-flow__series')).toHaveCount(0);
  await expect(page.locator('.rd-pulse-history')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Raw pulses' })).toContainText('Missing data');
  mode = 'empty';
  await page.clock.runFor(20_000);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('No measurements during this period', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Room 1 reported metrics' }).getByText('Unknown', { exact: true })).toHaveCount(3);
  await page.getByRole('link', { name: 'View Alerts', exact: true }).click();
  await expect(page).toHaveURL('/alerts');
  const before = flowReads;
  await page.clock.runFor(60_000);
  expect(flowReads).toBe(before);
});

test('switching rooms cancels pending reads and never displays another room’s history', async ({ page, context }) => {
  let release!: () => void;
  let pendingReads = 0;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await context.route('**/rest/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('device_id') === 'eq.room1' || url.searchParams.get('room_id') === 'in.(1)') {
      pendingReads++;
      await waiting;
    }
    await route.fallback();
  });
  try {
    await page.goto('/rooms/room-1');
    await expect.poll(() => pendingReads).toBe(3);
    await page.getByRole('navigation', { name: 'Select room' }).getByRole('link', { name: 'Room 2', exact: true }).click();
    await expect(page.getByRole('button', { name: /\b20 pulses\b/ })).toBeVisible();
  } finally { release(); }
  await expect(page.getByRole('article', { name: 'Room 2', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /\b10 pulses\b/ })).toHaveCount(0);
  await page.getByText('Recorded samples (1)', { exact: true }).click();
  await expect(page.getByRole('table', { name: 'Recorded pulse measurements' }).locator('tbody td:nth-child(2)')).toHaveText(['20']);
});

test('pending authentication never overlaps polling or starts reads after leaving Room Details', async ({ page, context, auth }) => {
  await page.clock.install();
  let verifications = 0;
  let reads = 0;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await context.route('**/auth/v1/user', async (route) => {
    verifications++;
    await waiting;
    await route.fulfill({ json: auth.session.user });
  });
  await context.route('**/rest/v1/**', async (route) => {
    if (/\/(flow_readings|room_status)$/.test(new URL(route.request().url()).pathname)) reads++;
    await route.fallback();
  });
  try {
    await page.goto('/rooms/room-1');
    await expect.poll(() => verifications).toBeGreaterThan(0);
    const metrics = page.getByRole('region', { name: 'Room 1 reported metrics', exact: true });
    await expect(metrics.getByText(/^Loading/)).toHaveCount(4);
    await page.clock.runFor(60_000);
    // Count this owner's table reads independently of R1's Auth retries.
    await expect(metrics.getByText(/^Loading/)).toHaveCount(4);
    expect(reads).toBe(0);
    await page.getByRole('button', { name: /^Alerts/ }).click();
    await page.getByRole('link', { name: /^View all alerts/ }).click();
    await expect(page.getByRole('heading', { name: 'Alerts', exact: true })).toBeVisible();
    await page.clock.runFor(40_000);
    expect(reads).toBe(0);
  } finally { release(); }
  await expect(page.getByRole('heading', { name: 'No alert records yet', exact: true })).toBeVisible();
  await page.clock.runFor(40_000);
  expect(reads).toBe(0);
});
