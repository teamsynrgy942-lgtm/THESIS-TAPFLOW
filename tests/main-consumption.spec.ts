import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures/auth';

const DAY_START = '2025-04-14T16:00:00.000Z';
const DAY_END = '2025-04-15T16:00:00.000Z';
const NEXT_DAY_END = '2025-04-16T16:00:00.000Z';

test.use({ timezoneId: 'America/Los_Angeles', realtimeEnabled: true });

function reading(id: number, receivedAt: string, rate: number | null, interval: number | null = 15_000) {
  return { id, device_id: 'main', received_at: receivedAt, flow_lpm: rate, sample_ms: interval, pulses: 100_000 * id };
}

async function pauseClock(page: Page, instant: string) {
  const timestamp = Date.parse(instant);
  await page.clock.install({ time: timestamp - 5_000 });
  await page.clock.pauseAt(timestamp);
}

async function mockReadings(context: BrowserContext, rows: ReturnType<typeof reading>[]) {
  const requests: { start: string; end: string; cutoff: string; offset: number }[] = [];
  await context.route('**/rest/v1/flow_readings*', async (route) => {
    const request = route.request();
    const { searchParams } = new URL(request.url());
    const bounds = searchParams.getAll('received_at');
    if (!bounds.length) return route.fallback();
    expect(request.method()).toBe('GET');
    expect(searchParams.get('device_id')).toBe('eq.main');
    expect(searchParams.get('select')?.split(',')).toEqual(['id', 'device_id', 'flow_lpm', 'sample_ms', 'received_at']);
    expect(searchParams.get('order')).toBe('received_at.asc,id.asc');
    const start = bounds.find((bound) => bound.startsWith('gte.'))?.slice(4);
    const end = bounds.find((bound) => bound.startsWith('lt.'))?.slice(3);
    const cutoff = bounds.find((bound) => bound.startsWith('lte.'))?.slice(4);
    if (!start || !end || !cutoff) throw new Error('Main daily query has no complete day and snapshot bounds');
    const offset = Number(searchParams.get('offset') ?? 0);
    if (offset === 0) expect(request.headers().prefer).toContain('count=exact');
    requests.push({ start, end, cutoff, offset });

    const matching = rows.filter((row) => row.received_at >= start && row.received_at < end && row.received_at <= cutoff)
      .sort((a, b) => a.received_at.localeCompare(b.received_at) || a.id - b.id);
    // Simulate a server row cap smaller than the page requested by the client.
    const data = matching.slice(offset, offset + 2);
    await route.fulfill({
      json: data,
      headers: {
        'content-range': `${data.length ? `${offset}-${offset + data.length - 1}` : '*'}/${matching.length}`,
        'access-control-expose-headers': 'content-range',
      },
    });
  });
  return requests;
}

function consumptionMetric(page: Page) {
  return page.getByRole('region', { name: 'Main water inlet' }).locator('.inlet-card__metric').filter({
    has: page.getByText('Water Used Today', { exact: true }),
  });
}

test('Main uses all paginated Philippine-day samples and refreshes recorded liters on Realtime', async ({ page, context, realtime }) => {
  const asOf = '2025-04-15T15:59:50.000Z';
  await pauseClock(page, asOf);
  const firstSample = reading(2, DAY_START, 8);
  const rows = [
    reading(1, '2025-04-14T15:59:59.999Z', 600),
    firstSample,
    firstSample,
    reading(3, '2025-04-15T08:00:00.000Z', 2.5, 90_000),
    reading(4, '2025-04-15T08:00:15.000Z', null),
    reading(5, '2025-04-15T08:00:30.000Z', -20),
    reading(6, '2025-04-15T08:00:45.000Z', 20, 0),
    reading(7, '2025-04-15T08:01:00.000Z', 0),
    reading(8, '2025-04-15T15:59:59.999Z', 600),
    reading(9, DAY_END, 600),
  ];
  const requests = await mockReadings(context, rows);
  await page.goto('/overview');
  await expect.poll(() => realtime.activeCount).toBe(1);
  await expect(page.locator('.overview-check-time')).toContainText('Last checked');

  const metric = consumptionMetric(page);
  await expect(metric.locator('strong')).toHaveText('5.75');
  await expect(metric.getByText('L', { exact: true })).toBeVisible();
  await expect(metric.getByText('Incomplete total', { exact: true })).toBeVisible();
  expect([...new Set(requests.map(({ offset }) => offset))]).toEqual([0, 2, 4, 6]);
  expect(requests.every(({ start, end, cutoff }) => start === DAY_START && end === DAY_END && cutoff === asOf)).toBe(true);

  const newRow = reading(10, asOf, 1, 60_000);
  rows.push(newRow);
  // The payload is only an invalidation signal. Values must come from the verified read.
  realtime.change('flow_readings', 'INSERT', { ...newRow, flow_lpm: 999 });
  await expect(metric.locator('strong')).toHaveText('6.75');
  await expect(page.locator('.overview-check-time')).toContainText('Last checked');
  const beforeDuplicate = requests.length;
  realtime.change('flow_readings', 'INSERT', newRow);
  await expect.poll(() => requests.length).toBeGreaterThan(beforeDuplicate);
  await expect(page.locator('.overview-check-time')).toContainText('Last checked');
  await expect(metric.locator('strong')).toHaveText('6.75');
});

test('Main treats a valid zero as measured volume and starts the next Philippine day on time', async ({ page, context }) => {
  await pauseClock(page, '2025-04-15T15:59:57.000Z');
  const rows = [
    reading(1, '2025-04-15T15:58:00.000Z', 14, null),
    reading(2, '2025-04-15T15:59:30.000Z', 0),
    reading(3, DAY_END, null),
  ];
  const requests = await mockReadings(context, rows);
  await page.goto('/overview');

  const metric = consumptionMetric(page);
  await expect(metric.locator('strong')).toHaveText('0.00');
  await expect(metric.getByText('L', { exact: true })).toBeVisible();
  await page.clock.runFor(3_001);
  await expect.poll(() => requests.some(({ start, end }) => start === DAY_END && end === NEXT_DAY_END)).toBe(true);
  await expect(metric.locator('strong')).toHaveText('Unavailable');
  await expect(metric.getByText('L', { exact: true })).toHaveCount(0);
});

test('Main shows later-page failures as an incomplete subtotal and recovers on Realtime', async ({ page, context, realtime }) => {
  await pauseClock(page, '2025-04-14T16:00:46.000Z');
  const rows = [
    reading(1, '2025-04-14T16:00:15.000Z', 4),
    reading(2, '2025-04-14T16:00:30.000Z', 8),
    reading(3, '2025-04-14T16:00:45.000Z', 12),
  ];
  await mockReadings(context, rows);
  let failLaterPage = true;
  await context.route('**/rest/v1/flow_readings*', async (route) => {
    const { searchParams } = new URL(route.request().url());
    if (searchParams.get('device_id') !== 'eq.main') return route.fallback();
    if (!searchParams.has('received_at')) return route.fulfill({ json: [rows[2]] });
    if (failLaterPage && searchParams.get('offset') === '2') {
      return route.fulfill({ status: 503, json: { message: 'Temporarily unavailable' } });
    }
    await route.fallback();
  });
  await page.goto('/overview');
  await expect.poll(() => realtime.activeCount).toBe(1);
  await expect(page.locator('.overview-check-time')).toContainText('Last checked');
  const inlet = page.getByRole('region', { name: 'Main water inlet' });
  const metric = consumptionMetric(page);
  await expect(inlet.getByText('12.00', { exact: true })).toBeVisible();
  await expect(inlet.getByText('L/min', { exact: true })).toBeVisible();
  await expect(metric.locator('strong')).toHaveText('3.00');
  await expect(metric.getByText('Incomplete total')).toBeVisible();

  failLaterPage = false;
  realtime.change('flow_readings', 'INSERT', rows[2]);
  await expect(metric.locator('strong')).toHaveText('6.00');
  await expect(metric.getByText('Incomplete total')).toHaveCount(0);
});
