import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

for (const roomNumber of [1, 2, 3]) {
  test(`Room ${roomNumber} matches the Figma layout with demo values and honest empty states`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
    await page.goto(`/rooms/room-${roomNumber}`);
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveTitle('TapFlow | Room Details');
    await expect(page.getByRole('heading', { name: 'Room Details', exact: true })).toBeVisible();
    await expect(page.getByText('Demo data', { exact: true })).toBeVisible();
    await expect(page.getByText('Last updated: No live data')).toBeVisible();
    await expect(page.getByText('Connectivity unknown', { exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Select room' }).getByRole('link', { name: `Room ${roomNumber}`, exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('article', { name: `Room ${roomNumber}`, exact: true })).toBeVisible();
    const metrics = page.getByRole('region', { name: `Room ${roomNumber} demo metrics` });
    for (const value of ['0.00', 'Inactive', 'Closed', 'Off']) await expect(metrics.getByText(value, { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Water flow', exact: true }).getByText('No flow readings yet')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Water usage history', exact: true }).getByText('No usage history yet')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Recent activity', exact: true }).getByText('No recent activity')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Related alerts', exact: true }).getByText('No active alerts')).toBeVisible();
    await expect(page.locator('.rd-flow__series')).toHaveCount(0);

    const bounds = await page.locator('.rd-panel').evaluateAll((panels) => panels.map((panel) => {
      const { x, y, width, height } = panel.getBoundingClientRect();
      return { x, y, width, height };
    }));
    expect(bounds).toHaveLength(4);
    expect(bounds[0].x).toBe(264);
    expect(bounds[0].y).toBeCloseTo(360.89, 0);
    expect(bounds[0].width).toBeCloseTo(632.24, 0);
    expect(bounds[0].height).toBeCloseTo(247.5, 0);
    expect(bounds[1].x).toBeCloseTo(911.24, 0);
    expect(bounds[2].y).toBeCloseTo(623.39, 0);
    expect(bounds[3].y).toBeCloseTo(623.39, 0);
    const sidebar = await page.getByRole('complementary').boundingBox();
    expect(sidebar!.width).toBe(232);
    await expect(page.getByText('Three-room prototype', { exact: true })).toHaveCount(0);
    const sidebarFooter = page.locator('.rd-sidebar-footer');
    await expect(sidebarFooter.locator('img')).toHaveCount(0);
    const footerBounds = await sidebarFooter.boundingBox();
    expect(footerBounds).toEqual({ x: 22, y: 842, width: 188, height: 34 });
    const topbar = await page.locator('.dashboard-topbar').boundingBox();
    expect(topbar!.height).toBe(69);
    const images = await page.locator('img').evaluateAll((elements: HTMLImageElement[]) => elements.map((image) => {
      const bounds = image.getBoundingClientRect();
      return { loaded: image.complete && image.naturalWidth > 0, local: new URL(image.src).origin === location.origin, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, width: bounds.width, height: bounds.height };
    }));
    expect(images).toHaveLength(16);
    for (const image of images) {
      expect(image.loaded).toBe(true);
      expect(image.local).toBe(true);
      expect(image.width).toBeGreaterThan(0);
      expect(image.height).toBeGreaterThan(0);
      // SVGs retain the exact intrinsic 16, 17, or 20 px geometry from Figma.
      if (image.width !== 42) {
        expect(image.width).toBe(image.naturalWidth);
        expect(image.height).toBe(image.naturalHeight);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
    await page.screenshot({ path: testInfo.outputPath(`room-${roomNumber}-desktop.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}

test('room selection updates the URL, data identity, active link, refresh, and browser history', async ({ page }) => {
  await page.goto('/rooms');
  await expect(page.getByRole('article', { name: 'Room 1', exact: true })).toBeVisible();
  const selector = page.getByRole('navigation', { name: 'Select room' });
  for (const roomNumber of [2, 3, 1]) {
    await selector.getByRole('link', { name: `Room ${roomNumber}`, exact: true }).click();
    await expect(page).toHaveURL(`/rooms/room-${roomNumber}`);
    await expect(page.getByRole('region', { name: `Room ${roomNumber} demo metrics` })).toBeVisible();
    await expect(selector.locator('[aria-current="page"]')).toHaveCount(1);
  }
  await page.reload();
  await expect(selector.getByRole('link', { name: 'Room 1', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect(page).toHaveURL('/rooms/room-3');
  await expect(page.getByRole('article', { name: 'Room 3', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'View Alerts', exact: true }).click();
  await expect(page).toHaveURL('/alerts');
  await page.getByRole('navigation', { name: 'Dashboard navigation' }).getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page).toHaveURL('/overview');
});

test('the selector supports keyboard navigation', async ({ page }) => {
  await page.goto('/rooms/room-1');
  const roomTwo = page.getByRole('navigation', { name: 'Select room' }).getByRole('link', { name: 'Room 2', exact: true });
  await roomTwo.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/rooms/room-2');
  await expect(page.getByRole('article', { name: 'Room 2', exact: true })).toBeVisible();
});

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }]) {
  test(`Room Details is usable at ${viewport.width} x ${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/rooms/room-3');
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    for (const title of ['Water flow', 'Water usage history', 'Recent activity', 'Related alerts']) {
      await expect(page.getByRole('region', { name: title, exact: true })).toBeVisible();
    }
    if (viewport.width === 390) await page.screenshot({ path: testInfo.outputPath('room-details-mobile.png'), fullPage: true });
    await page.getByRole('navigation', { name: 'Select room' }).getByRole('link', { name: 'Room 2', exact: true }).click();
    await expect(page).toHaveURL('/rooms/room-2');
    await expect(page.getByRole('article', { name: 'Room 2', exact: true })).toBeVisible();
  });
}
