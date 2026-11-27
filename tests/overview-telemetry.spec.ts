import { expect, test } from './fixtures/auth';

test('loading and empty records do not invent zero readings or inactive command states', async ({ page, context }) => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await context.route('**/rest/v1/**', async (route) => {
    expect(route.request().method()).toBe('GET');
    await waiting;
    await route.fulfill({ json: [] });
  });
  try {
    await page.goto('/overview');
    await expect(page.getByText('Loading telemetry…', { exact: true })).toBeVisible();
    await expect(page.getByText('0.00', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Inactive', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('article', { name: 'Room 1', exact: true }).locator('dd')).toHaveText(Array(4).fill('Loading…'));
  } finally { release(); }
  await expect(page.getByText('Missing Data', { exact: true })).toHaveCount(4);
  await expect(page.getByText('Unavailable', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Unknown', { exact: true })).toHaveCount(12);
  await expect(page.getByText('No Flow', { exact: true })).toHaveCount(0);
});

test('heartbeat freshness, nullable values, and partial permission errors remain independent', async ({ page, context }) => {
  const now = Date.now();
  const recent = new Date(now - 1000).toISOString();
  const old = new Date(now - 300_000).toISOString();
  await context.route('**/rest/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const device = url.searchParams.get('device_id')?.slice(3);
    if (url.pathname.endsWith('/room_status')) {
      await route.fulfill({ json: [
        { room_id: 1, rfid_active: false, valve_commanded_on: true, bulb_commanded_on: null, last_seen_at: recent },
        { room_id: 2, rfid_active: true, valve_commanded_on: false, bulb_commanded_on: false, last_seen_at: old, updated_at: recent },
      ] });
    } else if (device === 'main') {
      await route.fulfill({ status: 403, json: { code: '42501', message: 'permission denied' } });
    } else {
      await route.fulfill({ json: [{ id: 1, device_id: device, pulses: 0, sample_ms: 1000, flow_lpm: device === 'room1' ? 0 : null, received_at: device === 'room1' ? old : recent }] });
    }
  });
  await page.goto('/overview');
  const main = page.getByRole('region', { name: 'Main water inlet' });
  await expect(main.getByText('Refresh failed', { exact: true })).toBeVisible();
  await expect(page.getByText('Some readings could not be refreshed.')).toBeVisible();
  const first = page.getByRole('article', { name: 'Room 1', exact: true });
  await expect(first.locator('.status-badge')).toHaveText('ON');
  await expect(first.locator('dd')).toHaveText(['Unknown', 'Inactive', 'ON', 'Unknown']);
  await expect(first.locator('time')).toHaveAttribute('datetime', recent);
  const second = page.getByRole('article', { name: 'Room 2', exact: true });
  await expect(second.getByText('Stale', { exact: true })).toBeVisible();
  await expect(second.locator('dd')).toHaveText(['No Flow', 'Unknown', 'Unknown', 'Unknown']);
  const third = page.getByRole('article', { name: 'Room 3', exact: true });
  await expect(third.getByText('Unknown', { exact: true }).first()).toBeVisible();
  await expect(third.locator('dd')).toHaveText(['No Flow', 'Unknown', 'Unknown', 'Unknown']);
  await expect(page.getByText('Offline', { exact: true })).toHaveCount(0);
});

test('Overview uses authenticated read-only queries and the latest returned samples without deriving flow rates', async ({ page, context, auth }) => {
  let verifiedUser = false;
  const queriedDevices = new Set<string>();
  let statusReads = 0;
  const timestamp = new Date().toISOString();
  await context.route('**/auth/v1/user', async (route) => {
    verifiedUser = true;
    await route.fulfill({ json: auth.session.user });
  });
  await context.route('**/rest/v1/**', async (route) => {
    expect(verifiedUser).toBe(true);
    expect(route.request().method()).toBe('GET');
    // Do not print credentials, even on assertion failures.
    expect(route.request().headers().authorization === `Bearer ${auth.session.access_token}`).toBe(true);
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/flow_readings')) {
      const device = url.searchParams.get('device_id')?.slice(3);
      if (url.searchParams.has('received_at')) {
        expect(device).toBe('main');
        return route.fulfill({ json: [] });
      }
      expect(['main', 'room1', 'room2', 'room3']).toContain(device);
      expect(url.searchParams.get('order')).toBe('received_at.desc.nullslast');
      expect(url.searchParams.get('limit')).toBe('5');
      queriedDevices.add(device!);
      await route.fulfill({ json: [
        { id: 2, device_id: device, pulses: 431, sample_ms: 1000, flow_lpm: null, received_at: timestamp },
        { id: 1, device_id: device, pulses: 999, sample_ms: 1000, flow_lpm: 9.5, received_at: new Date(Date.now() - 300_000).toISOString() },
      ] });
    } else {
      expect(url.pathname.endsWith('/room_status')).toBe(true);
      expect(url.searchParams.get('room_id')).toBe('in.(1,2,3)');
      statusReads++;
      await route.fulfill({ json: [] });
    }
  });
  await page.goto('/overview');
  await expect(page.getByText('Flow Detected', { exact: true })).toHaveCount(3);
  await expect(page.getByText('Unavailable', { exact: true })).toHaveCount(2);
  await expect(page.getByText(/431|999|pulses/i)).toHaveCount(0);
  await expect(page.getByText('L/min', { exact: true })).toHaveCount(0);
  expect([...queriedDevices].sort()).toEqual(['main', 'room1', 'room2', 'room3']);
  expect(statusReads).toBe(1);
});

test('partial refresh failures show each source error and recover to empty without retaining inaccessible values', async ({ page, context }) => {
  await page.clock.install();
  await page.goto('/overview');
  const first = page.getByRole('article', { name: 'Room 1', exact: true });
  await expect(first.getByText('Flow Detected', { exact: true })).toBeVisible();
  let failing = true;
  await context.route('**/rest/v1/**', async (route) => {
    expect(route.request().method()).toBe('GET');
    if (!failing) return route.fulfill({ json: [] });
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/room_status')) {
      return route.fulfill({ status: 503, json: { message: 'Temporarily unavailable' } });
    }
    if (url.searchParams.get('device_id') === 'eq.room1') {
      return route.fulfill({ status: 403, json: { code: '42501', message: 'Access denied' } });
    }
    await route.fallback();
  });
  await page.clock.runFor(20_000);
  await expect(page.getByText('Some readings could not be refreshed.')).toBeVisible();
  await expect(first.locator('dd')).toHaveText(['Unknown', 'Active', 'OFF', 'OFF']);
  await expect(page.getByRole('article', { name: 'Room 2', exact: true }).getByText('Flow Detected', { exact: true })).toBeVisible();
  failing = false;
  await page.clock.runFor(20_000);
  await expect(page.getByText('Some readings could not be refreshed.')).toHaveCount(0);
  await expect(page.getByText('Missing Data', { exact: true })).toHaveCount(4);
  await expect(page.getByText('Unknown', { exact: true })).toHaveCount(12);
});

test('20-second polling refreshes records, retains failed samples, ages freshness, and stops on Alerts', async ({ page, context }) => {
  const start = Date.now();
  await page.clock.install({ time: new Date(start) });
  let mainReads = 0;
  let failed = false;
  let timestamp = new Date(start - 1000).toISOString();
  await context.route('**/rest/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const device = url.searchParams.get('device_id')?.slice(3);
    expect(route.request().method()).toBe('GET');
    if (device === 'main' && !url.searchParams.has('received_at')) mainReads++;
    if (failed) return route.fulfill({ status: 503, json: { message: 'Temporarily unavailable' } });
    if (url.pathname.endsWith('/room_status')) return route.fulfill({ json: [] });
    await route.fulfill({ json: [{ id: mainReads, device_id: device, pulses: mainReads * 7, sample_ms: 1000, flow_lpm: device === 'main' ? mainReads * 0.75 : null, received_at: timestamp }] });
  });
  await page.goto('/overview');
  const main = page.getByRole('region', { name: 'Main water inlet' });
  await expect(main.getByText('0.75', { exact: true })).toBeVisible();
  timestamp = new Date(start + 19_000).toISOString();
  await page.clock.runFor(20_000);
  await expect(main.getByText('1.50', { exact: true })).toBeVisible();
  expect(mainReads).toBe(2);
  failed = true;
  await page.clock.runFor(20_000);
  await expect(page.getByText('Some readings could not be refreshed.')).toBeVisible();
  await expect(main.getByText('1.50', { exact: true })).toBeVisible();
  await page.clock.runFor(120_000);
  await expect(main.getByText('Stale', { exact: true })).toBeVisible();
  await expect(main.getByText('Unknown', { exact: true })).toBeVisible();
  await expect(main.getByText('L/min', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /^Alerts/ }).click();
  await page.getByRole('link', { name: /^View all alerts/ }).click();
  await expect(page.getByRole('heading', { name: 'No alert records yet' })).toBeVisible();
  const before = mainReads;
  await page.clock.runFor(60_000);
  expect(mainReads).toBe(before);
});

test('polling does not overlap a pending request and cancels when leaving Overview', async ({ page, context }) => {
  await page.clock.install();
  let verifications = 0;
  let sensorReads = 0;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  // Stall Auth verification, which cannot be aborted via the SDK, then navigate away.
  await context.route('**/auth/v1/user', async (route) => {
    verifications++;
    await waiting;
    await route.fallback();
  });
  await context.route('**/rest/v1/**', async (route) => {
    if (/\/(flow_readings|room_status)$/.test(new URL(route.request().url()).pathname)) sensorReads++;
    await route.fallback();
  });
  try {
    await page.goto('/overview');
    await expect(page.getByText('Loading telemetry…', { exact: true })).toBeVisible();
    await expect.poll(() => verifications).toBeGreaterThan(0);
    await page.clock.runFor(60_000);
    // R1 independently retries its Auth verification; this owner's sensor reads
    // must stay blocked while its original verification remains pending.
    await expect(page.getByText(/^Loading telemetry/)).toBeVisible();
    expect(sensorReads).toBe(0);
    await page.getByRole('button', { name: /^Alerts/ }).click();
    await page.getByRole('link', { name: /^View all alerts/ }).click();
    await expect(page.getByRole('heading', { name: 'Alerts', exact: true })).toBeVisible();
    await page.clock.runFor(40_000);
    expect(sensorReads).toBe(0);
  } finally { release(); }
  await expect(page.getByRole('heading', { name: 'No alert records yet', exact: true })).toBeVisible();
  await page.clock.runFor(40_000);
  expect(sensorReads).toBe(0);
});
