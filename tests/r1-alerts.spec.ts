import type { Page, Route } from '@playwright/test';
import { expect, test } from './fixtures/auth';

const endpoint = '/rest/v1/tapflow_r1_alerts';
const code = 'R1_MISSING_FLOW_SIGNAL';
const resolved = {
  id: '9007199254740993',
  detected_at: '2025-01-01T16:05:00.000Z',
  room_id: 1,
  code,
  status: 'RESOLVED',
  evidence: { main_sample_count: 4, room_sample_count: 0, api_key: 'private-test-placeholder' },
  resolved_at: '2025-01-01T16:20:00.000Z',
};
const active = {
  id: '9007199254740994',
  detected_at: '2025-01-01T17:00:00.000Z',
  room_id: 2,
  code,
  status: 'ACTIVE',
  evidence: { main_sample_count: 3, room_sample_count: 0 },
  resolved_at: null,
};

async function routeAlerts(page: Page, accessToken: string, respond: (route: Route, url: URL) => Promise<void>) {
  await page.route(`**${endpoint}*`, async (route) => {
    const request = route.request();
    expect(request.method()).toBe('GET');
    expect(request.headers()['accept-profile']).toBe('public');
    expect(request.headers().authorization === `Bearer ${accessToken}`).toBe(true);
    const url = new URL(request.url());
    expect(url.searchParams.get('code')).toBe(`eq.${code}`);
    await respond(route, url);
  });
}

test('the signed-in Alerts log pages through live history and shows recorded evidence in Philippine Time', async ({ page, auth }) => {
  const offsets: number[] = [];
  const records = [active, resolved];
  await page.setViewportSize({ width: 390, height: 844 });
  await routeAlerts(page, auth.session.access_token, async (route, url) => {
    const columns = url.searchParams.get('select')?.split(',') ?? [];
    expect(columns).toHaveLength(10);
    expect(columns[0]).toMatch(/^(?:id:)?id(?:::text)?$/);
    expect(columns.slice(1)).toEqual(['detected_at', 'room_id', 'code', 'status', 'evidence', 'resolved_at', 'last_detected_at', 'resolved_by', 'resolution_remark']);
    expect(url.searchParams.get('order')).toMatch(/^detected_at\.desc(?:\.nullslast)?,id\.desc$/);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    offsets.push(offset);
    // Enforce an API row cap below the requested page size.
    await route.fulfill({
      json: records.slice(offset, offset + 1),
      headers: { 'content-range': `${offset}-${offset}/${records.length}`, 'access-control-expose-headers': 'content-range' },
    });
  });
  await page.goto('/alerts');
  const table = page.getByRole('table', { name: 'Alert history', exact: true });
  const historical = table.getByRole('row').filter({ hasText: 'Room 1' });
  await expect(historical).toContainText(code);
  await expect(historical).toContainText('Resolved');
  await expect(historical.locator('time').first()).toContainText(/Jan 2, 2025.*12:05 AM/);
  await expect(historical.locator('time').last()).toContainText(/Jan 2, 2025.*12:20 AM/);
  await expect(historical.locator('time').last()).toHaveAttribute('datetime', resolved.resolved_at);
  await historical.getByText('Recorded evidence', { exact: true }).click();
  await expect(historical.getByText('Main samples', { exact: true })).toBeVisible();
  await expect(historical.getByText('4', { exact: true })).toBeVisible();
  await expect(historical.getByText('Room samples', { exact: true })).toBeVisible();
  await expect(historical.getByText('0', { exact: true })).toBeVisible();
  await expect(page.getByText('private-test-placeholder')).toHaveCount(0);
  await expect(table.getByRole('row').filter({ hasText: 'Room 2' })).toContainText('Active');
  await expect(page.getByText('New active alert', { exact: true })).toHaveCount(0);
  expect(offsets).toEqual([0, 1]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('the supplied Room 1 RESOLVED row renders as historical evidence', async ({ page, auth }) => {
  const knownShape = {
    id: '1',
    detected_at: '2026-11-23T08:42:12+00:00',
    room_id: 1,
    code,
    status: 'RESOLVED',
    evidence: { room_sample_count: 0 },
    resolved_at: null,
  };
  await routeAlerts(page, auth.session.access_token, (route, url) => {
    expect(url.searchParams.has('status')).toBe(false);
    return route.fulfill({ json: [knownShape] });
  });
  await page.goto('/alerts');
  const history = page.getByRole('table', { name: 'Alert history', exact: true });
  const historical = history.getByRole('row').filter({ hasText: 'Room 1' });
  await expect(historical).toContainText('Possible Flow Sensor Failure');
  await expect(historical).toContainText(code);
  await expect(historical.getByText('Resolved', { exact: true })).toBeVisible();
  await expect(historical.locator('time')).toHaveAttribute('datetime', knownShape.detected_at);
  await expect(historical.locator('time')).toContainText(/Nov(?:ember)? 23, 2026.*4:42 PM/);
  await expect(historical.getByText(/The Main sensor detected water flow while Room 1 reported zero flow pulses/)).toBeVisible();
  await historical.getByText('Recorded evidence', { exact: true }).click();
  await expect(historical.getByText('Room samples', { exact: true })).toBeVisible();
  await expect(historical.getByText('0', { exact: true })).toBeVisible();
  await expect(page.getByText('New active alert', { exact: true })).toHaveCount(0);
});

test('initial loading and a denied alert query are distinct from an empty log, with retry', async ({ page, auth }) => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  let fail = true;
  await routeAlerts(page, auth.session.access_token, async (route) => {
    if (!fail) return route.fulfill({ json: [] });
    await waiting;
    return route.fulfill({ status: 403, json: { code: '42501', message: 'Permission denied for table' } });
  });
  await page.goto('/alerts');
  const log = page.getByRole('region', { name: 'Alert log', exact: true });
  try {
    await expect(log.getByText('Loading alerts…', { exact: true })).toBeVisible();
    await expect(log.getByRole('heading', { name: 'No alert records yet' })).toHaveCount(0);
  } finally {
    release();
  }
  await expect(log.getByRole('alert')).toBeVisible();
  await expect(log.getByRole('heading', { name: 'No alert records yet' })).toHaveCount(0);
  fail = false;
  await log.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(log.getByRole('heading', { name: 'No alert records yet' })).toBeVisible();
  await expect(log.getByText('No R1 alert records are visible to this signed-in account.', { exact: true })).toBeVisible();
  await expect(log.getByRole('alert')).toHaveCount(0);
});

test('a successful HTTP response with no row array is an alert read error', async ({ page, auth }) => {
  await routeAlerts(page, auth.session.access_token, (route) => route.fulfill({ contentType: 'application/json', body: 'null' }));
  await page.goto('/alerts');
  const log = page.getByRole('region', { name: 'Alert log', exact: true });
  await expect(log.getByRole('alert')).toBeVisible();
  await expect(log.getByRole('heading', { name: 'No alert records yet' })).toHaveCount(0);
  await expect(log.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
});

test('a stored session rejected by Auth reports the status and code without selecting alerts', async ({ page }) => {
  let alertReads = 0;
  await page.route('**/auth/v1/user', (route) => route.fulfill({
    status: 401,
    json: { code: 'bad_jwt', error_code: 'bad_jwt', msg: 'JWT verification failed' },
  }));
  await page.route(`**${endpoint}*`, async (route) => {
    alertReads++;
    await route.fulfill({ json: [] });
  });

  await page.goto('/alerts');
  const log = page.getByRole('region', { name: 'Alert log', exact: true });
  await expect(log.getByRole('alert')).toContainText('Your Supabase session could not be verified');
  await expect(log.getByRole('alert')).toContainText('HTTP 401');
  await expect(log.getByRole('alert')).toContainText('bad_jwt');
  await expect(log.getByRole('heading', { name: 'No alert records yet' })).toHaveCount(0);
  expect(alertReads).toBe(0);
});

test.describe('signed-out R1 access', () => {
  test.use({ authenticated: false, realtimeEnabled: true });

  test('a signed-out visit to Alerts starts no database read or alert subscription', async ({ page, realtime }) => {
    let requests = 0;
    await page.route(`**${endpoint}*`, async (route) => {
      requests++;
      await route.fulfill({ json: [] });
    });
    await page.goto('/alerts');
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
    expect(requests).toBe(0);
    expect(realtime.alertJoins).toHaveLength(0);
  });
});

test.describe('R1 realtime', () => {
  test.use({ realtimeEnabled: true });

  test('a hung Auth verification times out and retry resumes synchronization without clearing last-known alerts', async ({ page, auth, realtime }) => {
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1_000));
    let records: unknown[] = [active];
    let holdAuth = false;
    let heldRequests = 0;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/auth/v1/user', async (route) => {
      if (holdAuth) {
        heldRequests++;
        await waiting;
      }
      await route.fulfill({ json: auth.session.user });
    });
    await routeAlerts(page, auth.session.access_token, (route) => route.fulfill({ json: records }));
    await page.goto('/alerts');
    const log = page.getByRole('region', { name: 'Alert log', exact: true });
    const row = log.locator(`tr[data-alert-id="${active.id}"]`);
    await expect.poll(() => realtime.activeAlertCount).toBe(1);
    await expect(row.getByText('Active', { exact: true })).toBeVisible();
    const joins = realtime.alertJoins.length;

    holdAuth = true;
    const updated = { ...active, status: 'RESOLVED', resolved_at: '2025-01-01T17:45:00.000Z' };
    records = [updated];
    realtime.change('tapflow_r1_alerts', 'UPDATE', updated);
    try {
      await expect.poll(() => heldRequests).toBeGreaterThanOrEqual(1);
      await page.clock.runFor(14_999);
      await expect(log.getByRole('alert')).toHaveCount(0);
      await page.clock.runFor(1);
      await expect(log.getByRole('alert')).toContainText('Could not verify your Supabase session. Check your connection and try again');
      await expect(log.getByRole('alert')).toContainText('Showing last known records.');
      await expect(row.getByText('Active', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Alerts, 1 open, last known', exact: true })).toBeVisible();

      holdAuth = false;
      await log.getByRole('button', { name: 'Retry', exact: true }).click();
      release();
      await expect(log.getByRole('alert')).toHaveCount(0);
      await expect(row.getByText('Resolved', { exact: true })).toBeVisible();
      await expect(row.locator('time').last()).toHaveAttribute('datetime', updated.resolved_at);
      await expect(page.getByRole('button', { name: 'Alerts, 0 open', exact: true })).toBeVisible();
      await expect(log.getByRole('table', { name: 'Alert history', exact: true }).locator('tbody tr')).toHaveCount(1);
      expect(realtime.activeAlertCount).toBe(1);
      expect(realtime.alertJoins).toHaveLength(joins);
    } finally { release(); }
  });

  test('one incident stays synchronized across Room Details, the bell, and Alerts after resolution', async ({ page, auth, realtime }) => {
    let records: unknown[] = [resolved];
    await routeAlerts(page, auth.session.access_token, (route) => route.fulfill({ json: records }));
    await page.goto('/rooms/room-2');
    const related = page.getByRole('region', { name: 'Related alerts', exact: true });
    await expect.poll(() => realtime.activeAlertCount).toBe(1);
    await expect(page.getByRole('button', { name: 'Alerts, 0 open', exact: true })).toBeVisible();
    await expect(related.getByText('No recorded alerts', { exact: true })).toBeVisible();
    const joins = realtime.alertJoins.length;

    records = [active, resolved];
    realtime.change('tapflow_r1_alerts', 'INSERT', active);
    await expect(related.getByRole('listitem')).toHaveCount(1);
    await expect(related.getByText('Possible Flow Sensor Failure', { exact: true })).toBeVisible();
    const bell = page.getByRole('button', { name: 'Alerts, 1 open', exact: true });
    await expect(bell).toBeVisible();
    await bell.click();
    const preview = page.getByRole('region', { name: 'Alerts preview', exact: true });
    await expect(preview.getByRole('listitem')).toHaveCount(1);
    await expect(preview.getByRole('listitem')).toContainText('Room 2');

    const updated = { ...active, status: 'RESOLVED', resolved_at: '2025-01-01T17:50:00.000Z' };
    records = [updated, resolved];
    realtime.change('tapflow_r1_alerts', 'UPDATE', updated);
    await expect(related.getByRole('listitem')).toHaveCount(0);
    await expect(related.getByText('No recorded alerts', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Alerts, 0 open', exact: true })).toBeVisible();
    await expect(preview.getByRole('listitem')).toHaveCount(0);
    await expect(preview.getByText('No open alerts', { exact: true })).toBeVisible();
    await preview.getByRole('link', { name: /^View all alerts/ }).click();
    await expect(page).toHaveURL('/alerts');
    const table = page.getByRole('table', { name: 'Alert history', exact: true });
    const incident = table.locator(`tr[data-alert-id="${active.id}"]`);
    await expect(table.locator('tbody tr')).toHaveCount(2);
    await expect(incident).toHaveCount(1);
    await expect(incident).toContainText('Room 2');
    await expect(incident.getByText('Resolved', { exact: true })).toBeVisible();
    await expect(incident.locator('time').last()).toHaveAttribute('datetime', updated.resolved_at);
    expect(realtime.activeAlertCount).toBe(1);
    expect(realtime.alertJoins).toHaveLength(joins);
  });

  test('a repeated successful Postgres subscription immediately reconciles the existing incident', async ({ page, auth, realtime }) => {
    await page.clock.install();
    const pausedAt = Date.now() + 1_000;
    await page.clock.pauseAt(new Date(pausedAt));
    let records: unknown[] = [active];
    let reads = 0;
    await routeAlerts(page, auth.session.access_token, async (route) => {
      await route.fulfill({ json: records });
      reads++;
    });
    await page.goto('/alerts');
    await expect.poll(() => realtime.activeAlertCount).toBe(1);
    await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
    const table = page.getByRole('table', { name: 'Alert history', exact: true });
    const incident = table.locator(`tr[data-alert-id="${active.id}"]`);
    await expect(incident.getByText('Active', { exact: true })).toBeVisible();
    const joins = realtime.alertJoins.length;
    const before = reads;

    const updated = { ...active, status: 'RESOLVED', resolved_at: '2025-01-01T17:55:00.000Z' };
    records = [updated];
    // A server-side Postgres re-registration need not report a channel outage first.
    realtime.alertSystemStatus('ok', 'Subscribed to PostgreSQL');
    await expect.poll(() => reads).toBeGreaterThan(before);
    await expect(incident.getByText('Resolved', { exact: true })).toBeVisible();
    await expect(incident.locator('time').last()).toHaveAttribute('datetime', updated.resolved_at);
    await expect(table.locator('tbody tr')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Alerts, 0 open', exact: true })).toBeVisible();
    expect(await page.evaluate(() => Date.now())).toBe(pausedAt);
    expect(realtime.activeAlertCount).toBe(1);
    expect(realtime.alertJoins).toHaveLength(joins);
  });

  test('a subscribed channel still polls an initially empty log and recovers both statuses without an event', async ({ page, auth, realtime }) => {
    await page.clock.install();
    let records: unknown[] = [];
    let alertReads = 0;
    await routeAlerts(page, auth.session.access_token, async (route) => {
      alertReads++;
      await route.fulfill({ json: records });
    });
    await page.goto('/alerts');
    const log = page.getByRole('region', { name: 'Alert log', exact: true });
    await expect.poll(() => realtime.activeAlertCount).toBe(1);
    // Let the initial read and the successful subscription's catch-up read finish.
    await expect.poll(() => alertReads).toBeGreaterThanOrEqual(2);
    await expect(log.getByRole('heading', { name: 'No alert records yet' })).toBeVisible();
    await expect(log.getByRole('status').filter({ hasText: 'Checking for changes every 15 seconds.' })).toHaveCount(0);
    const joins = realtime.alertJoins.length;
    const initialReads = alertReads;

    // Access can change without an INSERT/UPDATE event reaching this socket.
    records = [active, resolved];
    await page.clock.runFor(15_000);
    const table = log.getByRole('table', { name: 'Alert history', exact: true });
    await expect(table.locator('tbody tr')).toHaveCount(2);
    await expect(table.getByRole('row').filter({ hasText: 'Room 2' })).toContainText('Active');
    await expect(table.getByRole('row').filter({ hasText: 'Room 1' })).toContainText('Resolved');
    expect(alertReads).toBeGreaterThan(initialReads);
    expect(realtime.activeAlertCount).toBe(1);
    expect(realtime.alertJoins).toHaveLength(joins);
  });

  test('a new record notifies on Overview, repeated events do not duplicate it, and resolution preserves history', async ({ page, auth, realtime }) => {
    let records: unknown[] = [resolved];
    await routeAlerts(page, auth.session.access_token, (route) => route.fulfill({ json: records }));
    await page.goto('/overview');
    await expect.poll(() => realtime.activeAlertCount).toBe(1);
    await expect(page.locator('.overview-check-time')).toContainText('Last checked');
    const joinCount = realtime.alertJoins.length;
    expect(realtime.alertJoins.at(-1)?.bindings.map(({ table, schema, event }) => ({ table, schema, event }))).toEqual([
      { table: 'tapflow_r1_alerts', schema: 'public', event: 'INSERT' },
      { table: 'tapflow_r1_alerts', schema: 'public', event: 'UPDATE' },
      { table: 'tapflow_r1_alerts', schema: 'public', event: 'DELETE' },
    ]);
    const notifications = page.getByRole('region', { name: 'Alert notifications', exact: true });
    const latest = notifications.getByText('New active alert', { exact: true });
    await expect(latest).toHaveCount(0);

    records = [active, resolved];
    realtime.change('tapflow_r1_alerts', 'INSERT', active);
    await expect(latest).toBeVisible();
    await expect(notifications).toContainText('Possible Flow Sensor Failure');
    await expect(notifications).toContainText('Room 2');
    await expect(notifications.getByRole('link', { name: 'View alerts', exact: true })).toHaveAttribute('href', '/alerts');
    realtime.change('tapflow_r1_alerts', 'INSERT', active);
    await expect(latest).toHaveCount(1);
    await notifications.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
    await expect(latest).toHaveCount(0);

    await page.getByRole('button', { name: /^Alerts/ }).click();
    await page.getByRole('link', { name: /^View all alerts/ }).click();
    await expect(page).toHaveURL('/alerts');
    const table = page.getByRole('table', { name: 'Alert history', exact: true });
    const room2 = table.getByRole('row').filter({ hasText: 'Room 2' });
    await expect(room2).toContainText('Active');
    await expect(table.locator('tbody tr')).toHaveCount(2);
    expect(realtime.activeAlertCount).toBe(1);
    expect(realtime.alertJoins).toHaveLength(joinCount);

    const updated = { ...active, status: 'RESOLVED', resolved_at: '2025-01-01T17:10:00.000Z' };
    records = [updated, resolved];
    realtime.change('tapflow_r1_alerts', 'UPDATE', updated);
    await expect(room2).toContainText('Resolved');
    await expect(room2.locator('time').last()).toHaveAttribute('datetime', updated.resolved_at);
    await expect(table.locator('tbody tr')).toHaveCount(2);
    await expect(latest).toHaveCount(0);

    await page.getByRole('button', { name: 'Logout', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect.poll(() => realtime.activeAlertCount).toBe(0);
  });

  test('reconnection reloads an alert resolved while the websocket was disconnected', async ({ page, auth, realtime }) => {
    let records: unknown[] = [active];
    await routeAlerts(page, auth.session.access_token, (route) => route.fulfill({ json: records }));
    await page.goto('/alerts');
    await expect.poll(() => realtime.activeAlertCount).toBe(1);
    const row = page.getByRole('table', { name: 'Alert history' }).getByRole('row').filter({ hasText: 'Room 2' });
    await expect(row).toContainText('Active');
    await expect(page.getByText('New active alert')).toHaveCount(0);
    const joinCount = realtime.alertJoins.length;
    await realtime.disconnect();
    records = [{ ...active, status: 'RESOLVED', resolved_at: '2025-01-01T17:20:00.000Z' }];
    await expect.poll(() => realtime.alertJoins.length).toBeGreaterThan(joinCount);
    await expect(row).toContainText('Resolved');
    await expect(page.getByText('New active alert')).toHaveCount(0);
  });

  test('a publication error on a joined channel keeps history polling and recovers without another subscription', async ({ page, auth, realtime }) => {
    await page.clock.install();
    let records: unknown[] = [active];
    await routeAlerts(page, auth.session.access_token, (route) => route.fulfill({ json: records }));
    await page.goto('/alerts');
    await expect.poll(() => realtime.activeAlertCount).toBe(1);
    const table = page.getByRole('table', { name: 'Alert history', exact: true });
    const row = table.getByRole('row').filter({ hasText: 'Room 2' });
    await expect(row.getByText('Active', { exact: true })).toBeVisible();
    const joins = realtime.alertJoins.length;
    const fallback = page.getByRole('status').filter({ hasText: 'Checking for changes every 15 seconds.' });

    realtime.alertSystemStatus('error', 'RealtimeDisabledForConfiguration: public.tapflow_r1_alerts is not enabled for Realtime');
    await expect(fallback).toContainText('This table is not enabled for Realtime.');
    const updated = { ...active, status: 'RESOLVED', resolved_at: '2025-01-01T17:20:00.000Z' };
    records = [updated];
    await page.clock.runFor(15_000);
    await expect(row.getByText('Resolved', { exact: true })).toBeVisible();
    await expect(table.locator('tbody tr')).toHaveCount(1);
    expect(realtime.activeAlertCount).toBe(1);
    expect(realtime.alertJoins).toHaveLength(joins);

    records = [updated, resolved];
    realtime.alertSystemStatus('ok', 'Subscribed to PostgreSQL');
    await expect(fallback).toHaveCount(0);
    await expect(table.locator('tbody tr')).toHaveCount(2);
    await expect(page.getByText('New active alert', { exact: true })).toHaveCount(0);
    expect(realtime.alertJoins).toHaveLength(joins);
  });

  test('15-second polling synchronizes INSERT and resolution when Realtime never joins', async ({ page, auth, realtime }) => {
    await page.clock.install();
    realtime.acceptJoins = false;
    let records: unknown[] = [resolved];
    let reads = 0;
    await routeAlerts(page, auth.session.access_token, async (route) => {
      reads++;
      await route.fulfill({ json: records });
    });
    await page.goto('/alerts');
    const table = page.getByRole('table', { name: 'Alert history', exact: true });
    await expect(table.locator('tbody tr')).toHaveCount(1);
    expect(realtime.activeAlertCount).toBe(0);
    const initialReads = reads;
    records = [active, resolved];
    await page.clock.fastForward(15_000);
    await expect(table.locator('tbody tr')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Alerts, 1 open', exact: true })).toBeVisible();
    expect(reads).toBeGreaterThan(initialReads);
    const notification = page.getByRole('region', { name: 'Alert notifications', exact: true });
    await expect(notification.getByText('New active alert', { exact: true })).toBeVisible();

    records = [{ ...active, status: 'RESOLVED', resolved_at: '2025-01-01T17:30:00.000Z' }, resolved];
    await page.clock.fastForward(15_000);
    await expect(table.getByText('Resolved', { exact: true })).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Alerts, 0 open', exact: true })).toBeVisible();
    await expect(notification).toHaveCount(0);
    expect(realtime.activeAlertCount).toBe(0);
  });

  test('DELETE invalidates the authoritative log and count without trusting payload values', async ({ page, auth, realtime }) => {
    let records: unknown[] = [active, resolved];
    await routeAlerts(page, auth.session.access_token, (route) => route.fulfill({ json: records }));
    await page.goto('/alerts');
    await expect.poll(() => realtime.activeAlertCount).toBe(1);
    const table = page.getByRole('table', { name: 'Alert history', exact: true });
    await expect(table.locator('tbody tr')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Alerts, 1 open', exact: true })).toBeVisible();
    records = [resolved];
    // RLS DELETE events may contain only a primary key; every DELETE triggers a SELECT.
    realtime.change('tapflow_r1_alerts', 'DELETE', { id: active.id });
    await expect(table.locator('tbody tr')).toHaveCount(1);
    await expect(table.getByText('Resolved', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Alerts, 0 open', exact: true })).toBeVisible();
    expect(realtime.activeAlertCount).toBe(1);
  });

  test('events during a pending read coalesce and do not publish a stale alert or duplicate notification', async ({ page, auth, realtime }) => {
    let records: unknown[] = [resolved];
    let reads = 0;
    let pendingReads = 0;
    let maxPendingReads = 0;
    let holdNextRead = false;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    await routeAlerts(page, auth.session.access_token, async (route) => {
      reads++;
      pendingReads++;
      maxPendingReads = Math.max(maxPendingReads, pendingReads);
      const snapshot = structuredClone(records);
      if (holdNextRead) {
        holdNextRead = false;
        await waiting;
      }
      try { await route.fulfill({ json: snapshot }); }
      finally { pendingReads--; }
    });
    await page.goto('/alerts');
    await expect.poll(() => realtime.activeAlertCount).toBe(1);
    await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
    await expect(page.getByRole('table', { name: 'Alert history' }).locator('tbody tr')).toHaveCount(1);
    const before = reads;
    // Observe transient notifications, not only the final DOM after the follow-up read.
    await page.evaluate(() => {
      const observed: string[] = [];
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) for (const node of mutation.addedNodes) {
          if (node instanceof Element && (node.matches('.r1-notification') || node.querySelector('.r1-notification'))) {
            observed.push(node.textContent ?? '');
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      Object.assign(window, { r1TestNotifications: observed, r1TestObserver: observer });
    });
    records = [active, resolved];
    holdNextRead = true;
    realtime.change('tapflow_r1_alerts', 'INSERT', active);
    await expect.poll(() => reads).toBe(before + 1);
    records = [{ ...active, status: 'RESOLVED', resolved_at: '2025-01-01T17:40:00.000Z' }, resolved];
    try {
      realtime.change('tapflow_r1_alerts', 'UPDATE', { ...active, status: 'RESOLVED' });
      realtime.change('tapflow_r1_alerts', 'UPDATE', { ...active, status: 'RESOLVED' });
      // This synchronous catch-up also proves triggers during the read are queued.
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    } finally { release(); }
    const table = page.getByRole('table', { name: 'Alert history', exact: true });
    await expect(table.getByText('Resolved', { exact: true })).toHaveCount(2);
    await expect.poll(() => pendingReads).toBe(0);
    expect(reads).toBe(before + 2);
    expect(maxPendingReads).toBe(1);
    await expect(page.getByRole('button', { name: 'Alerts, 0 open', exact: true })).toBeVisible();
    const observed = await page.evaluate(() => {
      const state = window as unknown as { r1TestNotifications: string[]; r1TestObserver: MutationObserver };
      state.r1TestObserver.disconnect();
      return state.r1TestNotifications;
    });
    expect(observed).toEqual([]);
    expect(realtime.activeAlertCount).toBe(1);
  });

  test('focus, visibility, online, and returning to Alerts reconcile missed changes on one feed', async ({ page, auth, realtime }) => {
    await page.clock.install();
    const pausedAt = Date.now() + 1_000;
    await page.clock.pauseAt(new Date(pausedAt));
    let records: unknown[] = [resolved];
    let reads = 0;
    await routeAlerts(page, auth.session.access_token, async (route) => {
      reads++;
      await route.fulfill({ json: records });
    });
    await page.goto('/alerts');
    await expect.poll(() => realtime.activeAlertCount).toBe(1);
    await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
    const joins = realtime.alertJoins.length;
    const table = page.getByRole('table', { name: 'Alert history', exact: true });
    await expect(table.locator('tbody tr')).toHaveCount(1);

    for (const event of ['focus', 'visibilitychange', 'online'] as const) {
      const before = reads;
      records = [active, resolved];
      await page.evaluate((name) => {
        (name === 'visibilitychange' ? document : window).dispatchEvent(new Event(name));
      }, event);
      await expect(table.getByRole('row').filter({ hasText: 'Room 2' })).toContainText('Active');
      await expect(page.getByRole('button', { name: 'Alerts, 1 open', exact: true })).toBeVisible();
      expect(reads).toBeGreaterThan(before);
      records = [resolved];
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(table.locator('tbody tr')).toHaveCount(1);
    }

    await page.getByRole('link', { name: 'Overview', exact: true }).click();
    await expect(page).toHaveURL('/overview');
    const beforeReturn = reads;
    records = [active, resolved];
    await page.getByRole('button', { name: /^Alerts/ }).click();
    await page.getByRole('link', { name: /^View all alerts/ }).click();
    await expect(page).toHaveURL('/alerts');
    await expect(table.locator('tbody tr')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Alerts, 1 open', exact: true })).toBeVisible();
    expect(reads).toBeGreaterThan(beforeReturn);
    expect(realtime.activeAlertCount).toBe(1);
    expect(realtime.alertJoins).toHaveLength(joins);
    expect(await page.evaluate(() => Date.now())).toBe(pausedAt);
  });

  test('logout stops subscription, polling and catch-up listeners, and ignores a late read', async ({ page, auth, realtime }) => {
    await page.clock.install();
    let reads = 0;
    let hold = false;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    await routeAlerts(page, auth.session.access_token, async (route) => {
      reads++;
      if (hold) await waiting;
      await route.fulfill({ json: [active] });
    });
    await page.goto('/alerts');
    await expect.poll(() => realtime.activeAlertCount).toBe(1);
    await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
    await expect(page.getByRole('button', { name: 'Alerts, 1 open', exact: true })).toBeVisible();
    const before = reads;
    hold = true;
    realtime.change('tapflow_r1_alerts', 'UPDATE', active);
    await expect.poll(() => reads).toBe(before + 1);
    try {
      await page.getByRole('button', { name: 'Logout', exact: true }).click();
      await expect(page).toHaveURL('/');
      await expect.poll(() => realtime.activeAlertCount).toBe(0);
    } finally { release(); }
    const stopped = reads;
    await page.clock.runFor(45_000);
    await page.evaluate(() => {
      for (const name of ['focus', 'online']) window.dispatchEvent(new Event(name));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(reads).toBe(stopped);
    await expect(page.getByRole('region', { name: 'Alert notifications', exact: true })).toHaveCount(0);
  });
});
