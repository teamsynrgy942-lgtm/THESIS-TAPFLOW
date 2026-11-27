import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures/auth';

async function expectCommands(room: Locator, overview: boolean, values: string[]) {
  if (overview) await expect(room.locator('.room-card__devices > div:nth-child(n + 2) dd')).toHaveText(values);
  else {
    for (const [index, label] of ['RFID Session', 'Valve Command', 'Light Command'].entries()) {
      await expect(room.getByRole('group', { name: label, exact: true }).locator('strong')).toHaveText(values[index]);
    }
  }
}

function flowActivity(room: Locator, overview: boolean) {
  return overview ? room.locator('.room-card__devices dd').first()
    : room.getByRole('group', { name: 'Raw pulses', exact: true }).locator('strong');
}

for (const routePath of ['/overview', '/rooms/room-1']) {
  const overview = routePath === '/overview';
  test(`${routePath}: reports age to Unknown, flow-only recovery cannot restore commands, and a resumed heartbeat restores them`, async ({ page, context }, testInfo) => {
    let clock = Date.now();
    await page.clock.install({ time: new Date(clock) });
    let heartbeat = new Date(clock - 1000).toISOString();
    let flowAt = heartbeat;
    let uploadingFlow = true;
    await context.route('**/rest/v1/**', async (route) => {
      expect(route.request().method()).toBe('GET');
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/room_status')) {
        const ids = url.searchParams.get('room_id')!.match(/\d+/g)!.map(Number);
        await route.fulfill({ json: ids.map((room_id) => ({
          room_id, rfid_active: true, valve_commanded_on: true, bulb_commanded_on: true,
          last_seen_at: heartbeat, updated_at: new Date(clock).toISOString(),
        })) });
      } else {
        if (uploadingFlow) flowAt = new Date(clock - 1000).toISOString();
        await route.fulfill({ json: [{
          id: 1, device_id: url.searchParams.get('device_id')!.slice(3),
          pulses: 42, sample_ms: 15000, flow_lpm: 1.25, received_at: flowAt,
        }] });
      }
    });
    await page.goto(routePath);
    const room = page.getByRole('article', { name: 'Room 1', exact: true });
    const activity = flowActivity(room, overview);
    const report = overview ? room : page.locator('.rd-room-status');
    const checkTime = page.locator(overview ? '.overview-check-time' : '.rd-check-time');
    async function advancePolling(ms: number) {
      const previous = await checkTime.getAttribute('datetime');
      clock += ms;
      await page.clock.runFor(ms);
      await expect(checkTime).not.toHaveAttribute('datetime', previous!);
    }
    await expectCommands(room, overview, ['Active', 'ON', 'ON']);
    await expect(activity).toHaveText(overview ? 'Flow Detected' : '42 pulses');
    await expect(report.getByText('ON', { exact: true }).first()).toBeVisible();
    for (let tick = 0; tick < 7; tick++) {
      await advancePolling(20_000);
    }
    await expectCommands(room, overview, ['Unknown', 'Unknown', 'Unknown']);
    await expect(report.getByText('Stale', { exact: true })).toBeVisible();
    await expect(activity).toHaveText(overview ? 'Flow Detected' : '42 pulses');
    if (overview) await expect(page.getByRole('region', { name: 'Main water inlet' }).locator('.status-badge')).toHaveText('ON');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.screenshot({ path: testInfo.outputPath('stale-command-states-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    uploadingFlow = false;
    await advancePolling(120_000);
    await expectCommands(room, overview, ['Unknown', 'Unknown', 'Unknown']);
    await expect(activity).toHaveText('Unknown');
    await expect(report.getByText('Stale', { exact: true })).toBeVisible();
    if (overview) {
      const main = page.getByRole('region', { name: 'Main water inlet' });
      await expect(main.locator('.status-badge')).toHaveText('Stale');
      await expect(main.locator('.inlet-card__metric').first().locator('strong')).toHaveText('Unknown');
      await expect(main.getByText('L/min', { exact: true })).toHaveCount(0);
    } else {
      await room.getByText('Recorded samples (1)', { exact: true }).click();
      await expect(room.getByRole('table', { name: 'Recorded pulse measurements' }).getByRole('cell', { name: '42', exact: true })).toBeVisible();
    }
    uploadingFlow = true;
    await advancePolling(20_000);
    await expect(activity).toHaveText(overview ? 'Flow Detected' : '42 pulses');
    await expectCommands(room, overview, ['Unknown', 'Unknown', 'Unknown']);
    if (overview) await expect(page.getByRole('region', { name: 'Main water inlet' }).locator('.status-badge')).toHaveText('ON');
    heartbeat = new Date(clock - 1000).toISOString();
    await advancePolling(20_000);
    await expectCommands(room, overview, ['Active', 'ON', 'ON']);
    await expect(report.getByText('ON', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Offline', { exact: true })).toHaveCount(0);
  });

  test(`${routePath}: a missing heartbeat keeps commands Unknown despite recent flow and database updates`, async ({ page, context }) => {
    const fresh = new Date(Date.now() - 1000).toISOString();
    await context.route('**/rest/v1/**', async (route) => {
      expect(route.request().method()).toBe('GET');
      const url = new URL(route.request().url());
      await route.fulfill({ json: url.pathname.endsWith('/room_status')
        ? [1, 2, 3].map((room_id) => ({ room_id, rfid_active: true, valve_commanded_on: true, bulb_commanded_on: true, last_seen_at: null, updated_at: fresh }))
        : [{ id: 1, device_id: url.searchParams.get('device_id')!.slice(3), pulses: 0, sample_ms: 15000, flow_lpm: null, received_at: fresh }] });
    });
    await page.goto(routePath);
    const room = page.getByRole('article', { name: 'Room 1', exact: true });
    await expectCommands(room, overview, ['Unknown', 'Unknown', 'Unknown']);
    await expect(flowActivity(room, overview)).toHaveText(overview ? 'No Flow' : '0 pulses');
    await expect((overview ? room : page.locator('.rd-room-status')).getByText('Unknown', { exact: true }).first()).toBeVisible();
  });
}
