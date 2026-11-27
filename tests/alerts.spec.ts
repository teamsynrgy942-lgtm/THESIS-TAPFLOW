import { expect, test } from './fixtures/auth';

test.use({ viewport: { width: 1440, height: 900 } });

test('Alerts keeps the desktop shell and shows an empty log without fictional records or statuses', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
  await page.goto('/alerts');
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveTitle('TapFlow | Alerts');
  await expect(page.getByRole('heading', { level: 1, name: 'Alerts', exact: true })).toBeVisible();
  await expect(page.getByText('Demo data', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Last updated: No live data')).toHaveCount(0);
  await expect(page.getByText('No active alerts', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/No anomaly detected/)).toHaveCount(0);
  const log = page.getByRole('region', { name: 'Alert log', exact: true });
  await expect(log.getByRole('heading', { name: 'No alert records yet', exact: true })).toBeVisible();
  await expect(log.getByRole('table')).toHaveCount(0);
  const sidebar = await page.getByRole('complementary').boundingBox();
  expect(sidebar!.width).toBe(232);
  await expect(page.getByText('Three-room prototype', { exact: true })).toHaveCount(0);
  const sidebarFooter = page.locator('.rd-sidebar-footer');
  await expect(sidebarFooter.locator('img')).toHaveCount(0);
  expect(await sidebarFooter.boundingBox()).toEqual({ x: 22, y: 842, width: 188, height: 34 });
  expect((await page.locator('.dashboard-topbar').boundingBox())!.height).toBe(69);
  const logBounds = await log.boundingBox();
  expect(logBounds!.x).toBe(264);
  expect(logBounds!.width).toBe(1144);
  const assets = await page.locator('img').evaluateAll((images: HTMLImageElement[]) => images.map((image) => ({
    loaded: image.complete && image.naturalWidth > 0,
    local: new URL(image.src).origin === location.origin,
    naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
    width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height,
  })));
  expect(assets.length).toBeGreaterThanOrEqual(4);
  for (const asset of assets) {
    expect(asset.loaded).toBe(true);
    expect(asset.local).toBe(true);
    expect(asset.width).toBeGreaterThan(0);
    if (asset.width !== 42) {
      expect(asset.width).toBe(asset.naturalWidth);
      expect(asset.height).toBe(asset.naturalHeight);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  await page.screenshot({ path: testInfo.outputPath('alerts-desktop.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('Alerts header, refresh, room links, and Welcome navigation work', async ({ page }) => {
  await page.goto('/overview');
  const nav = page.getByRole('navigation', { name: 'Dashboard navigation' });
  await expect(nav.getByRole('link', { name: 'Alerts', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /^Alerts/ }).click();
  await page.getByRole('link', { name: /^View all alerts/ }).click();
  await expect(page).toHaveURL('/alerts');
  await expect(page.getByRole('button', { name: /^Alerts/ })).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'No alert records yet' })).toBeVisible();
  await nav.getByRole('link', { name: 'Room Details', exact: true }).click();
  await expect(page).toHaveURL('/rooms');
  await page.getByRole('link', { name: 'View Alerts', exact: true }).click();
  await expect(page).toHaveURL('/alerts');
  await page.getByRole('link', { name: 'Back to Welcome', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: 'Open Dashboard' })).toBeVisible();
});

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }]) {
  test(`Alerts keeps its empty state readable at ${viewport.width} x ${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/alerts');
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    const empty = page.getByRole('heading', { name: 'No alert records yet' });
    await expect(empty).toBeVisible();
    const emptyBounds = await empty.boundingBox();
    expect(emptyBounds!.x).toBeGreaterThanOrEqual(0);
    expect(emptyBounds!.x + emptyBounds!.width).toBeLessThanOrEqual(viewport.width);
    if (viewport.width === 390) await page.screenshot({ path: testInfo.outputPath('alerts-mobile.png'), fullPage: true });
    await page.getByRole('navigation', { name: 'Dashboard navigation' }).getByRole('link', { name: 'Overview', exact: true }).click();
    await expect(page).toHaveURL('/overview');
  });
}
