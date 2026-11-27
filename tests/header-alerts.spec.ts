import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/auth';

const endpoint = '**/rest/v1/tapflow_r1_alerts*';
const active = {
  id: '101', detected_at: '2026-11-23T10:16:00.000Z', room_id: 1,
  code: 'R1_MISSING_FLOW_SIGNAL', status: 'ACTIVE', evidence: {}, resolved_at: null,
};
const newer = { ...active, id: '102', detected_at: '2026-11-23T11:20:00.000Z', room_id: 2 };
const resolved = { ...active, id: '103', detected_at: '2026-11-23T12:00:00.000Z', room_id: 3,
  status: 'RESOLVED', resolved_at: '2026-11-23T12:10:00.000Z' };

const bell = (page: Page) => page.getByRole('button', { name: /^Alerts/ });
const preview = (page: Page) => page.getByRole('region', { name: 'Alerts preview', exact: true });

test.describe('shared header alert feed', () => {
  test.use({ realtimeEnabled: true, viewport: { width: 1440, height: 900 } });

  test('counts all active rooms, previews newest first without changing alerts, and keeps resolved history in the full log', async ({ page, realtime }) => {
    let records = [active, resolved, newer];
    let reads = 0;
    const methods: string[] = [];
    await page.route(endpoint, async (route) => {
      reads++;
      methods.push(route.request().method());
      await route.fulfill({ json: records });
    });
    await page.goto('/rooms/room-1');
    await expect(page.getByRole('region', { name: 'Room 1 reported metrics' })).toBeVisible();
    await expect(page.locator('.header-alerts__count')).toHaveText('2');
    await expect.poll(() => realtime.activeAlertCount).toBe(1);
    await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
    await expect(page.getByRole('navigation', { name: 'Dashboard navigation' }).getByRole('link', { name: 'Alerts', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'View Alerts', exact: true })).toHaveAttribute('href', '/alerts');
    const joinCount = realtime.alertJoins.length;
    const beforeReads = reads;
    const chart = page.getByRole('region', { name: 'Water flow', exact: true });
    const chartBefore = await chart.boundingBox();
    const metricsBefore = await page.getByRole('region', { name: 'Room 1 reported metrics' }).boundingBox();

    await bell(page).click();
    const panel = preview(page);
    await expect(panel.getByRole('heading', { name: 'Alerts', exact: true })).toBeVisible();
    await expect(panel.getByText('2 open', { exact: true })).toBeVisible();
    const items = panel.locator('.header-alerts__list > li');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('Room 2');
    await expect(items.nth(1)).toContainText('Room 1');
    await expect(items.nth(0)).toContainText('Possible Flow Sensor Failure');
    await expect(items.nth(0).locator('time')).toHaveAttribute('datetime', newer.detected_at);
    await expect(items.nth(0).locator('time')).toContainText(/Nov 23, 2026.*7:20 PM PHT/);
    await expect(panel.getByText('Open', { exact: true })).toHaveCount(2);
    await expect(panel.getByText('Room 3', { exact: true })).toHaveCount(0);
    await expect(panel.getByText('No recent telemetry', { exact: true })).toHaveCount(0);
    expect(await chart.boundingBox()).toEqual(chartBefore);
    expect(await page.getByRole('region', { name: 'Room 1 reported metrics' }).boundingBox()).toEqual(metricsBefore);
    await bell(page).click();
    await expect(panel).toHaveCount(0);
    await expect(page.locator('.header-alerts__count')).toHaveText('2');
    await bell(page).click();
    expect(reads).toBe(beforeReads);
    expect(realtime.activeAlertCount).toBe(1);
    expect(realtime.alertJoins).toHaveLength(joinCount);

    records = [{ ...active, status: 'RESOLVED', resolved_at: '2026-11-23T13:00:00.000Z' }, resolved, newer];
    realtime.change('tapflow_r1_alerts', 'UPDATE', records[0]);
    await expect(page.locator('.header-alerts__count')).toHaveText('1');
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText('Room 2');
    records = records.map((record) => ({ ...record, status: 'RESOLVED', resolved_at: '2026-11-23T13:00:00.000Z' }));
    realtime.change('tapflow_r1_alerts', 'UPDATE', records[2]);
    await expect(page.locator('.header-alerts__count')).toHaveCount(0);
    await expect(panel.getByText('No open alerts', { exact: true })).toBeVisible();
    const fullLog = panel.getByRole('link', { name: /^View all alerts/ });
    await expect(fullLog).toHaveAttribute('href', '/alerts');
    await fullLog.click();
    await expect(page).toHaveURL('/alerts');
    await expect(preview(page)).toHaveCount(0);
    const history = page.getByRole('table', { name: 'Alert history', exact: true });
    await expect(history.locator('tbody tr')).toHaveCount(3);
    await expect(history.getByText('Resolved', { exact: true })).toHaveCount(3);
    expect(realtime.alertJoins).toHaveLength(joinCount);
    expect(methods.every((method) => method === 'GET')).toBe(true);
  });
});

test('bell supports keyboard toggling and closes on Escape, outside click, and room navigation', async ({ page }) => {
  await page.goto('/overview');
  await bell(page).focus();
  await page.keyboard.press('Enter');
  await expect(bell(page)).toHaveAttribute('aria-expanded', 'true');
  const panelId = await bell(page).getAttribute('aria-controls');
  expect(panelId).toBeTruthy();
  await expect(preview(page)).toHaveAttribute('id', panelId!);
  await preview(page).getByRole('link', { name: /^View all alerts/ }).focus();
  await page.keyboard.press('Escape');
  await expect(preview(page)).toHaveCount(0);
  await expect(bell(page)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(preview(page)).toBeVisible();
  await page.getByRole('heading', { name: 'Overview', exact: true }).click();
  await expect(preview(page)).toHaveCount(0);
  await bell(page).click();
  await bell(page).click();
  await expect(bell(page)).toHaveAttribute('aria-expanded', 'false');
  await bell(page).click();
  await page.getByRole('navigation', { name: 'Dashboard navigation' }).getByRole('link', { name: 'Room Details', exact: true }).click();
  await expect(page).toHaveURL('/rooms');
  await expect(preview(page)).toHaveCount(0);
  await bell(page).click();
  await page.getByRole('navigation', { name: 'Select room' }).getByRole('link', { name: 'Room 2', exact: true }).click();
  await expect(page).toHaveURL('/rooms/room-2');
  await expect(preview(page)).toHaveCount(0);
  await expect(bell(page)).toHaveAttribute('aria-expanded', 'false');
});

test('loading and failed alert reads are distinct from a successful empty preview', async ({ page }) => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  let failed = true;
  await page.route(endpoint, async (route) => {
    if (!failed) return route.fulfill({ json: [] });
    await waiting;
    return route.fulfill({ status: 403, json: { code: '42501', message: 'Permission denied' } });
  });
  await page.goto('/overview');
  await bell(page).click();
  const panel = preview(page);
  try {
    await expect(panel.getByRole('status')).toContainText('Loading alerts…');
    await expect(panel.getByText('No open alerts', { exact: true })).toHaveCount(0);
    await expect(panel.getByText('0 open', { exact: true })).toHaveCount(0);
    await expect(page.locator('.header-alerts__count')).toHaveCount(0);
  } finally { release(); }
  await expect(panel.getByRole('alert')).toContainText('Your account cannot read the alert log');
  await expect(panel.getByText('No open alerts', { exact: true })).toHaveCount(0);
  await expect(panel.getByText('0 open', { exact: true })).toHaveCount(0);
  failed = false;
  await panel.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(panel.getByText('No open alerts', { exact: true })).toBeVisible();
  await expect(panel.getByText('0 open', { exact: true })).toBeVisible();
  await expect(page.locator('.header-alerts__count')).toHaveCount(0);
});

test('telemetry notes require successful stale or empty data for the actual affected room', async ({ page, context }) => {
  let mode: 'stale' | 'empty' | 'failed' = 'stale';
  await page.route(endpoint, (route) => route.fulfill({ json: [active, newer] }));
  const stale = new Date(Date.now() - 300_000).toISOString();
  await context.route('**/rest/v1/**', async (route) => {
    if (mode === 'failed') return route.fulfill({ status: 503, json: { message: 'Telemetry unavailable' } });
    if (mode === 'empty') return route.fulfill({ json: [] });
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/room_status')) {
      const selectedIds = url.searchParams.get('room_id')?.match(/\d+/g)?.map(Number) ?? [1, 2, 3];
      await route.fulfill({ json: selectedIds.map((room_id) => ({
        room_id, rfid_active: null, valve_commanded_on: null, bulb_commanded_on: null, last_seen_at: stale,
      })) });
    } else {
      const device = url.searchParams.get('device_id')?.slice(3);
      await route.fulfill({ json: [{ id: 1, device_id: device, pulses: 0, sample_ms: 15000, received_at: stale }] });
    }
  });
  for (const result of ['stale', 'failed', 'empty'] as const) {
    mode = result;
    await page.goto('/overview');
    await expect(page.locator('.overview-check-time')).toContainText('Last checked');
    await bell(page).click();
    await expect(preview(page).locator('.header-alerts__list > li')).toHaveCount(2);
    await expect(preview(page).getByText('No recent telemetry', { exact: true })).toHaveCount(result === 'failed' ? 0 : 2);
  }
  await page.goto('/rooms/room-1');
  await expect(page.locator('.rd-check-time')).toBeVisible();
  await bell(page).click();
  const items = preview(page).locator('.header-alerts__list > li');
  await expect(items.filter({ hasText: 'Room 1' }).getByText('No recent telemetry', { exact: true })).toBeVisible();
  await expect(items.filter({ hasText: 'Room 2' }).getByText('No recent telemetry', { exact: true })).toHaveCount(0);
  await page.goto('/alerts');
  await bell(page).click();
  await expect(preview(page).getByText('No recent telemetry', { exact: true })).toHaveCount(0);
});

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`preview overlays both dashboards within the ${viewport.width}px mobile viewport`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const records = Array.from({ length: 8 }, (_, index) => ({ ...active, id: String(index + 1), room_id: index % 3 + 1 }));
    await page.route(endpoint, (route) => route.fulfill({ json: records }));
    for (const path of ['/overview', '/rooms/room-1']) {
      await page.goto(path);
      await expect(page.locator('.header-alerts__count')).toHaveText('8');
      const before = await page.locator('.dashboard-content').boundingBox();
      await bell(page).click();
      const panel = preview(page);
      await expect(panel).toBeVisible();
      const bounds = await panel.boundingBox();
      const bellBounds = await bell(page).boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds!.y).toBeGreaterThanOrEqual(bellBounds!.y + bellBounds!.height);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      expect(await page.locator('.dashboard-content').boundingBox()).toEqual(before);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
      await expect(panel.getByRole('link', { name: /^View all alerts/ })).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`header-alerts-${path.includes('rooms') ? 'room' : 'overview'}-${viewport.width}.png`) });
    }
  });
}
