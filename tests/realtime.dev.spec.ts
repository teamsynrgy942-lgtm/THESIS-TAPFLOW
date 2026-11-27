import { expect, test } from './fixtures/auth';

test.use({ authenticated: false, realtimeEnabled: true });

test('development StrictMode reuses one subscription and logs sanitized statuses/errors', async ({ page, context, auth, realtime }) => {
  const now = Date.now();
  await page.clock.install({ time: new Date(now) });
  await page.clock.pauseAt(new Date(now));
  const logs: { type: string; text: string }[] = [];
  page.on('console', (message) => logs.push({ type: message.type(), text: message.text() }));
  let mainReads = 0;
  await context.route('**/rest/v1/flow_readings*', async (route) => {
    const { searchParams } = new URL(route.request().url());
    if (searchParams.get('device_id') === 'eq.main' && !searchParams.has('received_at')) mainReads++;
    await route.fallback();
  });
  await page.goto('/');
  await auth.signIn(page);
  await expect(page).toHaveURL('/overview');
  await expect.poll(() => logs.some(({ type, text }) => type === 'debug' && text === '[TapFlow Realtime] SUBSCRIBED')).toBe(true);
  await expect(page.locator('.overview-check-time')).toContainText('Last checked');
  expect(realtime.joins).toHaveLength(1);
  expect(realtime.activeCount).toBe(1);
  const before = mainReads;
  realtime.change('flow_readings', 'INSERT', { device_id: 'main' });
  await expect.poll(() => mainReads).toBe(before + 1);
  await expect(page.locator('.overview-check-time')).toContainText('Last checked');
  expect(realtime.joins).toHaveLength(1);

  realtime.channelError('Test channel failure access_token=synthetic-secret');
  await expect.poll(() => logs.some(({ type, text }) => type === 'error'
    && text.includes('[TapFlow Realtime] CHANNEL_ERROR') && text.includes('[redacted]'))).toBe(true);
  expect(logs.some(({ text }) => text.includes('synthetic-secret') || text.includes(auth.session.access_token))).toBe(false);
  await page.getByRole('button', { name: /^Alerts/ }).click();
  await page.getByRole('link', { name: /^View all alerts/ }).click();
  await expect.poll(() => realtime.activeCount).toBe(0);
  await expect.poll(() => logs.some(({ type, text }) => type === 'debug' && text === '[TapFlow Realtime] CLOSED')).toBe(true);
});
