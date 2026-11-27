import type { BrowserContext, Route } from '@playwright/test';
import { expect, test } from './fixtures/auth';

const columns = 'id,device_id,pulses,sample_ms,flow_lpm,received_at';
const deviceIds = ['main', 'room1', 'room2', 'room3'];

async function mockReads(context: BrowserContext, respond: (route: Route, table: string, device: string) => Promise<void>) {
  await context.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const table = url.pathname.split('/').at(-1)!;
    expect(request.method()).toBe('GET');
    expect(request.headers()['accept-profile']).toBe('public');
    if (table === 'flow_readings') {
      expect(url.searchParams.get('select')).toBe(columns);
      expect(url.searchParams.get('order')).toBe('received_at.desc.nullslast');
      expect(url.searchParams.get('limit')).toBe('5');
      expect(deviceIds.map((id) => `eq.${id}`).includes(url.searchParams.get('device_id')!)).toBe(true);
    } else {
      expect(table).toBe('room_status');
      expect(url.searchParams.get('room_id')).toBe('in.(1,2,3)');
      expect(url.searchParams.get('limit')).toBe('3');
    }
    await respond(route, table, url.searchParams.get('device_id')?.slice(3) ?? '');
  });
}

test('verified session authorizes five bounded queries and preserves nulls, timestamps, and raw readings', async ({ page, context, auth }, testInfo) => {
  let userVerified = false;
  const queriedDevices = new Set<string>();
  let roomRequests = 0;
  await context.route('**/auth/v1/user', async (route) => {
    userVerified = true;
    await route.fulfill({ json: auth.session.user });
  });
  await mockReads(context, async (route, table, device) => {
    expect(userVerified).toBe(true);
    // Only assert a boolean, so even a failed test never prints authorization headers.
    expect(route.request().headers().authorization === `Bearer ${auth.session.access_token}`).toBe(true);
    if (table === 'flow_readings') {
      queriedDevices.add(device);
      await route.fulfill({ json: Array.from({ length: 5 }, (_, index) => ({
        id: index + 1, device_id: device, pulses: 120 - index, sample_ms: 1000,
        flow_lpm: index === 0 ? null : 0, received_at: `2026-11-14T10:00:0${5 - index}Z`,
      })) });
    } else {
      roomRequests++;
      await route.fulfill({ json: [1, 2, 3].map((room_id) => ({
        room_id, rfid_active: false, valve_commanded_on: true, bulb_commanded_on: null,
        updated_at: '2026-11-14T10:00:00Z', rfid_updated_at: null, last_seen_at: '2026-11-14T09:59:00Z', last_rfid_at: null,
        internal_note: 'must not be displayed',
      })) });
    }
  });
  await page.goto('/dev/telemetry');
  await expect(page.getByRole('heading', { name: 'Telemetry diagnostics', exact: true })).toBeVisible();
  await expect(page.getByText('Signed-in user verified with Supabase Auth.')).toBeVisible();
  for (const device of deviceIds) {
    const section = page.getByRole('region', { name: `Flow readings: ${device}`, exact: true });
    await expect(section.getByRole('status')).toHaveText('Success — 5 record(s) retrieved.');
    const records = JSON.parse((await section.locator('pre').textContent())!);
    expect(records[0].flow_lpm).toBeNull();
    expect(records[0].pulses).toBe(120);
    expect(records[1].flow_lpm).toBe(0);
  }
  for (const id of [1, 2, 3]) {
    const section = page.getByRole('region', { name: `Room status: ${id}`, exact: true });
    const records = JSON.parse((await section.locator('pre').textContent())!);
    expect(records[0]).toEqual({
      room_id: id, rfid_active: false, valve_commanded_on: true, bulb_commanded_on: null,
      timestamps: { updated_at: '2026-11-14T10:00:00Z', rfid_updated_at: null, last_seen_at: '2026-11-14T09:59:00Z', last_rfid_at: null },
    });
  }
  expect([...queriedDevices].sort()).toEqual([...deviceIds].sort());
  expect(roomRequests).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('telemetry-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('telemetry-mobile.png') });
});

test('independent outcomes distinguish permissions, empty visibility, schema errors, and network errors', async ({ page, context }) => {
  await mockReads(context, async (route, table, device) => {
    if (table === 'room_status') return route.fulfill({ json: [
      { room_id: 1, rfid_active: true, valve_commanded_on: false, bulb_commanded_on: false },
    ] });
    if (device === 'main') return route.fulfill({ status: 403, json: { code: '42501', message: 'permission denied for table flow_readings' } });
    if (device === 'room1') return route.fulfill({ json: [] });
    if (device === 'room2') return route.fulfill({ status: 404, json: { code: 'PGRST205', message: 'Table not found in schema cache' } });
    return route.abort('failed');
  });
  await page.goto('/dev/telemetry');
  const main = page.getByRole('region', { name: 'Flow readings: main', exact: true });
  await expect(main.getByRole('alert')).toContainText('Permission denied / access restriction');
  await expect(main.getByRole('alert')).toContainText('42501');
  const empty = page.getByRole('region', { name: 'Flow readings: room1', exact: true });
  await expect(empty.getByRole('status')).toHaveText('Success — zero visible rows.');
  await expect(empty).toContainText('an empty result cannot distinguish these cases');
  await expect(page.getByRole('region', { name: 'Flow readings: room2', exact: true })).toContainText('Configuration or schema error');
  await expect(page.getByRole('region', { name: 'Flow readings: room3', exact: true })).toContainText('Network error');
  await expect(page.getByRole('region', { name: 'Room status: 1', exact: true })).toContainText('Success — 1 record(s) retrieved.');
  await expect(page.getByRole('region', { name: 'Room status: 2', exact: true })).toContainText('Success — zero visible rows.');
  await expect(page.getByRole('region', { name: 'Room status: 3', exact: true })).toContainText('Success — zero visible rows.');
});

test('read-only observer verifies heartbeat advancement separately from successful flow uploads', async ({ page, context }) => {
  const start = Date.now();
  await page.clock.install({ time: new Date(start) });
  let heartbeat = new Date(start - 1000).toISOString();
  let flowAt = heartbeat;
  await mockReads(context, async (route, table, device) => {
    await route.fulfill({ json: table === 'flow_readings'
      ? [{ id: 1, device_id: device, pulses: 10, sample_ms: 15000, flow_lpm: null, received_at: flowAt }]
      : [1, 2, 3].map((room_id) => ({ room_id, rfid_active: true, valve_commanded_on: true, bulb_commanded_on: true, last_seen_at: heartbeat })) });
  });
  await page.goto('/dev/telemetry');
  const table = page.getByRole('table', { name: 'Reporting timestamp observations' });
  await expect(table.getByRole('row', { name: /Room 1/ })).toContainText('Baseline recorded');
  await page.getByLabel('Observe reporting timestamps every 20 seconds').check();
  flowAt = new Date(start + 19000).toISOString();
  await page.clock.runFor(20000);
  await expect(table.getByRole('row', { name: /Room 1/ })).toContainText('Timestamp unchanged between reads');
  await expect(table.getByRole('row', { name: /Main/ })).toContainText('Timestamp advanced between reads');
  heartbeat = new Date(start + 39000).toISOString();
  await page.clock.runFor(20000);
  await expect(table.getByRole('row', { name: /Room 1/ })).toContainText('Timestamp advanced between reads');
  await expect(table.getByRole('row', { name: /Room 1/ }).locator('td').nth(2)).toHaveText(heartbeat);
});

for (const failure of ['expired', 'network', 'configuration'] as const) {
  test(`getUser ${failure} failure prevents every telemetry query`, async ({ page, context }) => {
    let queryCount = 0;
    await context.route('**/rest/v1/**', async (route) => { queryCount++; await route.abort(); });
    await context.route('**/auth/v1/user', async (route) => {
      if (failure === 'network') return route.abort('failed');
      await route.fulfill({ status: 401, json: failure === 'expired'
        ? { code: 'bad_jwt', error_code: 'bad_jwt', msg: 'JWT expired' }
        : { message: 'Invalid API key' } });
    });
    await page.goto('/dev/telemetry');
    await expect(page.getByRole('alert')).toContainText(failure === 'expired'
      ? 'Missing or expired authentication session' : failure === 'network' ? 'Network error' : 'Configuration or schema error');
    await expect(page.getByText('No telemetry queries were run.', { exact: false })).toBeVisible();
    expect(queryCount).toBe(0);
  });
}

test('refresh reruns verification and clears earlier errors', async ({ page, context }) => {
  let failed = true;
  await mockReads(context, async (route) => {
    await route.fulfill(failed
      ? { status: 403, json: { code: '42501', message: 'permission denied' } }
      : { json: [] });
  });
  await page.goto('/dev/telemetry');
  await expect(page.getByRole('alert')).toHaveCount(7);
  failed = false;
  await page.getByRole('button', { name: 'Refresh readings' }).click();
  await expect(page.getByText('Success — zero visible rows.', { exact: true })).toHaveCount(7);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('diagnostic errors redact credential-shaped values', async ({ page, context, auth }) => {
  await mockReads(context, async (route) => {
    await route.fulfill({ status: 400, json: {
      code: 'XX000',
      message: `Diagnostic error: access_token=${auth.session.access_token} refresh_token=${auth.session.refresh_token}`,
    } });
  });
  await page.goto('/dev/telemetry');
  await expect(page.getByRole('alert')).toHaveCount(7);
  const body = await page.locator('body').textContent();
  expect(body!.includes(auth.session.access_token)).toBe(false);
  expect(body!.includes(auth.session.refresh_token)).toBe(false);
  await expect(page.getByRole('alert').first()).toContainText('[redacted]');
});

test.describe('signed out', () => {
  test.use({ authenticated: false });
  test('protects the diagnostic and returns to it after login', async ({ page, context, auth }) => {
    let reads = 0;
    await mockReads(context, async (route) => { reads++; await route.fulfill({ json: [] }); });
    await page.goto('/dev/telemetry');
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('form', { name: 'Dashboard sign in' })).toBeVisible();
    expect(reads).toBe(0);
    await auth.signIn(page);
    await expect(page).toHaveURL('/dev/telemetry');
    await expect(page.getByText('Success — zero visible rows.', { exact: true })).toHaveCount(7);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('form', { name: 'Dashboard sign in' })).toBeVisible();
  });
});
