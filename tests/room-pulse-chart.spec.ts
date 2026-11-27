import type { BrowserContext } from '@playwright/test';
import type { FlowReading } from '../src/features/telemetry/telemetry-types';
import { expect, test } from './fixtures/auth';

function sample(now: number, age: number, pulses: number, id: number, sampleMs = 15000): FlowReading {
  return { id, device_id: 'room1', pulses, sample_ms: sampleMs, flow_lpm: null, received_at: new Date(now - age - 1000).toISOString() };
}

async function mockRecords(context: BrowserContext, rows: FlowReading[], cap = 1000, onChart?: (url: URL) => void) {
  await context.route('**/rest/v1/flow_readings*', async (route) => {
    expect(route.request().method()).toBe('GET');
    const url = new URL(route.request().url());
    const filters = url.searchParams.getAll('received_at');
    if (!filters.length) {
      await route.fulfill({ json: [...rows].sort((a, b) => Date.parse(b.received_at!) - Date.parse(a.received_at!)).slice(0, 60) });
      return;
    }
    onChart?.(url);
    const start = Date.parse(filters.find((filter) => filter.startsWith('gte.'))!.slice(4));
    const end = Date.parse(filters.find((filter) => filter.startsWith('lte.'))!.slice(4));
    const matching = rows.filter((reading) => {
      const timestamp = Date.parse(reading.received_at!);
      return timestamp >= start && timestamp <= end;
    }).sort((a, b) => Date.parse(a.received_at!) - Date.parse(b.received_at!));
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const page = matching.slice(offset, offset + Math.min(cap, Number(url.searchParams.get('limit'))));
    await route.fulfill({ json: page, headers: {
      'content-range': `${page.length ? `${offset}-${offset + page.length - 1}` : '*'}/${matching.length}`,
      'access-control-expose-headers': 'content-range',
    } });
  });
}

test('chart defaults to 30 minutes, separates sessions, switches ranges, and preserves older table records', async ({ page, context }) => {
  const now = Date.now();
  await page.clock.install({ time: new Date(now) });
  await mockRecords(context, [
    sample(now, 4 * 86_400_000, 444, 1),
    sample(now, 23 * 3_600_000, 23, 2),
    sample(now, 45 * 60_000, 45, 3),
    sample(now, 10 * 60_000, 10, 4), sample(now, 10 * 60_000 - 15000, 11, 5),
    sample(now, 30_000, 20, 6), sample(now, 15_000, 0, 7),
  ]);
  await page.goto('/rooms/room-1');
  const range = page.getByRole('radiogroup', { name: 'Time range', exact: true });
  const curve = page.locator('.rd-flow__series .recharts-line-curve');
  await expect(range.getByRole('radio', { name: '30 min', exact: true })).toBeChecked();
  await expect(page.locator('.rd-flow__series circle')).toHaveCount(4);
  await expect(curve).toHaveAttribute('d', /^M[^ML]+L[^ML]+M[^ML]+L[^ML]+$/);
  const xs = await page.locator('.rd-flow__series circle').evaluateAll((points) => points.map((point) => Number(point.getAttribute('cx'))));
  expect(xs).toEqual([...xs].sort((a, b) => a - b));
  await expect(page.locator('.rd-pulse-chart__unit')).toHaveText('Pulses per sample');
  await expect(page.locator('.rd-pulse-chart__caption')).toContainText('Philippine Time (PHT)');
  const first = page.locator('.rd-flow__series circle').first();
  await first.focus();
  await expect(page.getByRole('tooltip')).toContainText('Raw pulses: 10');
  await expect(page.getByRole('tooltip')).toContainText('Measurement interval: 15000 ms');
  const firstTimestamp = now - 601_000;
  const firstTime = page.getByRole('tooltip').locator('time');
  await expect(firstTime).toHaveAttribute('datetime', new Date(firstTimestamp).toISOString());
  const manilaTime = new Date(firstTimestamp + 8 * 3_600_000).toISOString().slice(11, 19);
  await expect(firstTime).toContainText(`${manilaTime} PHT`);
  await first.press('ArrowRight');
  await expect(page.getByRole('tooltip')).toContainText('Raw pulses: 11');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await range.getByRole('radio', { name: '5 min', exact: true }).check();
  await expect(page.locator('.rd-flow__series circle')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /\b0 pulses\b/ })).toBeVisible();
  await expect(curve).toHaveAttribute('d', /^M[^ML]+L[^ML]+$/);
  await range.getByRole('radio', { name: '1 hour', exact: true }).check();
  await expect(page.locator('.rd-flow__series circle')).toHaveCount(5);
  await expect(curve).toHaveAttribute('d', /^M[^ML]+M[^ML]+L[^ML]+M[^ML]+L[^ML]+$/);
  await range.getByRole('radio', { name: '24 hours', exact: true }).check();
  await expect(page.locator('.rd-flow__series circle')).toHaveCount(6);
  await expect(curve).toHaveAttribute('d', /^M[^ML]+M[^ML]+M[^ML]+L[^ML]+M[^ML]+L[^ML]+$/);
  await page.getByText('Recorded samples (7)', { exact: true }).click();
  await expect(page.getByRole('table', { name: 'Recorded pulse measurements' }).getByRole('cell', { name: '444', exact: true })).toBeVisible();
});

test('an empty selected period does not fall back to historical lines or rescale other intervals', async ({ page, context }) => {
  const now = Date.now();
  await mockRecords(context, [sample(now, 2 * 3_600_000, 88, 1), sample(now, 86_400_000 * 4, 99, 2), sample(now, 15_000, 5, 3, 1000)]);
  await page.goto('/rooms/room-1');
  await expect(page.getByText('No measurements during this period', { exact: true })).toBeVisible();
  await expect(page.locator('.rd-flow__series')).toHaveCount(0);
  await expect(page.getByText('The chart uses 15-second samples. See recorded samples for other intervals.')).toBeVisible();
  await page.getByRole('radio', { name: '1 hour', exact: true }).check();
  await expect(page.getByText('No measurements during this period', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: '24 hours', exact: true }).check();
  await expect(page.locator('.rd-flow__series circle')).toHaveCount(1);
  await expect(page.locator('.rd-flow__series .recharts-line-curve')).toHaveCount(0);
  await page.getByText('Recorded samples (3)', { exact: true }).click();
  await expect(page.getByRole('table', { name: 'Recorded pulse measurements' }).locator('tbody tr')).toHaveCount(3);
});

test('24-hour queries page through API row caps instead of truncating the chart to the latest 60 samples', async ({ page, context }) => {
  const now = Date.now();
  await page.clock.install({ time: new Date(now) });
  const rows = Array.from({ length: 1105 }, (_, index) => sample(now, index * 15000, index % 40, index));
  const offsets: number[] = [];
  await mockRecords(context, rows, 500, (url) => {
    const filters = url.searchParams.getAll('received_at');
    const duration = Date.parse(filters.find((filter) => filter.startsWith('lte.'))!.slice(4)) - Date.parse(filters.find((filter) => filter.startsWith('gte.'))!.slice(4));
    if (duration === 86_400_000) offsets.push(Number(url.searchParams.get('offset')));
  });
  await page.goto('/rooms/room-1');
  await expect(page.locator('.rd-flow__series circle')).toHaveCount(120);
  await page.getByRole('radio', { name: '24 hours', exact: true }).check();
  await expect(page.locator('.rd-flow__series circle')).toHaveCount(1105);
  expect(offsets).toEqual([0, 500, 1000]);
  await expect(page.locator('.rd-flow__series .recharts-line-curve')).toHaveAttribute('d', /^M[^M]+$/);
  await page.getByText('Recorded samples (60)', { exact: true }).click();
  await expect(page.getByRole('table', { name: 'Recorded pulse measurements' }).locator('tbody tr')).toHaveCount(60);
});

test.describe('legacy demo parameter', () => {
  test.use({ realtimeEnabled: true });

  test('an old demo URL still renders authenticated room telemetry only', async ({ page, context, realtime }) => {
    const now = Date.now();
    await mockRecords(context, [sample(now, 0, 42, 1)]);
    await page.goto('/rooms/room-1?mode=demo');
    await expect.poll(() => realtime.activeCount).toBe(1);
    await expect(page.getByRole('button', { name: /\b42 pulses\b/ })).toBeVisible();
    await expect(page.locator('.rd-flow__series circle')).toHaveCount(1);
    await expect(page.getByText(/Demo Mode|Simulated data|Back to live readings/i)).toHaveCount(0);
    const roomTwo = page.getByRole('navigation', { name: 'Select room' }).getByRole('link', { name: 'Room 2' });
    await expect(roomTwo).toHaveAttribute('href', '/rooms/room-2');
  });
});

test('changing range aborts older chart requests and preserves the 20-second refresh for the selected period', async ({ page, context }) => {
  const now = Date.now();
  await page.clock.install({ time: new Date(now) });
  let release!: () => void;
  let pending = 0;
  let hourlyReads = 0;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await mockRecords(context, [sample(now, 15_000, 42, 1)]);
  await context.route('**/rest/v1/flow_readings*', async (route) => {
    const filters = new URL(route.request().url()).searchParams.getAll('received_at');
    if (filters.length) {
      const duration = Date.parse(filters.find((filter) => filter.startsWith('lte.'))!.slice(4)) - Date.parse(filters.find((filter) => filter.startsWith('gte.'))!.slice(4));
      if (duration === 1_800_000) { pending++; await waiting; }
      if (duration === 3_600_000) hourlyReads++;
    }
    await route.fallback();
  });
  try {
    await page.goto('/rooms/room-1');
    await expect.poll(() => pending).toBe(1);
    await page.getByRole('radio', { name: '1 hour', exact: true }).check();
    await expect(page.locator('.rd-flow__series circle')).toHaveCount(1);
  } finally { release(); }
  await expect(page.getByRole('radio', { name: '1 hour', exact: true })).toBeChecked();
  await page.clock.runFor(20_000);
  await expect.poll(() => hourlyReads).toBe(2);
  await expect(page.locator('.rd-flow__series circle')).toHaveCount(1);
});

test.describe('mobile pulse chart', () => {
  test.use({ viewport: { width: 320, height: 780 }, hasTouch: true });
  test('touch tooltips and axis labels fit the existing card on a narrow screen', async ({ page, context }, testInfo) => {
    const now = Date.now();
    await mockRecords(context, [sample(now, 15_000, 7, 1)]);
    await page.goto('/rooms/room-1');
    const point = page.locator('.rd-flow__series circle').first();
    const controls = await page.locator('.rd-pulse-chart__controls').boundingBox();
    const plot = await page.locator('.rd-flow__plot').boundingBox();
    expect(plot!.y).toBeGreaterThanOrEqual(controls!.y + controls!.height);
    await point.tap();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toContainText('Raw pulses: 7');
    await expect(tooltip).toContainText('Measurement interval: 15000 ms');
    const bounds = await tooltip.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await expect(page.locator('.rd-pulse-chart__ticks time')).toHaveCount(3);
    await page.screenshot({ path: testInfo.outputPath('pulse-chart-mobile-tooltip.png'), fullPage: true });
  });
});
