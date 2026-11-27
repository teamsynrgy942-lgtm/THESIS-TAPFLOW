import { expect, test } from './fixtures/auth';

test.use({ viewport: { width: 1440, height: 900 } });

for (const roomNumber of [1, 2, 3]) {
  test(`Room ${roomNumber} shows compact telemetry in the TapFlow desktop layout`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
    await page.goto(`/rooms/room-${roomNumber}`);
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveTitle('TapFlow | Room Details');
    await expect(page.getByRole('heading', { name: 'Room Details', exact: true })).toBeVisible();
    await expect(page.locator('.rd-room-status')).toContainText('ON');
    await expect(page.getByRole('navigation', { name: 'Select room' }).getByRole('link', { name: `Room ${roomNumber}`, exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('article', { name: `Room ${roomNumber}`, exact: true })).toBeVisible();
    const metrics = page.getByRole('region', { name: `Room ${roomNumber} reported metrics` });
    await expect(metrics.getByRole('group')).toHaveCount(4);
    await expect(metrics.getByRole('group', { name: 'Raw pulses' })).toContainText(`${roomNumber * 10} pulses`);
    await expect(metrics.locator('time')).toHaveCount(0);
    await expect(metrics.getByRole('group', { name: 'RFID Session', exact: true })).toContainText(roomNumber === 1 ? 'Active' : 'Inactive');
    await expect(metrics.getByRole('group', { name: 'Valve Command', exact: true })).toContainText(roomNumber === 2 ? 'ON' : 'OFF');
    await expect(metrics.getByRole('group', { name: 'Light Command', exact: true })).toContainText(roomNumber === 3 ? 'ON' : 'OFF');
    await expect(page.getByText(/Not calibrated|Used today|Connectivity unknown/)).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Related alerts', exact: true }).getByText('No recorded alerts')).toBeVisible();
    await expect(page.locator('.rd-flow__series')).toHaveCount(1);

    const bounds = await page.locator('.rd-panel').evaluateAll((panels) => panels.map((panel) => {
      const { x, y, width, height } = panel.getBoundingClientRect();
      return { x, y, width, height };
    }));
    expect(bounds).toHaveLength(2);
    expect(bounds[0].x).toBe(264);
    expect(bounds[0].width).toBeGreaterThan(bounds[1].width);
    expect(bounds[0].height).toBeGreaterThanOrEqual(247.5);
    expect(bounds[1].x).toBeCloseTo(bounds[0].x + bounds[0].width + 15, 0);
    expect(bounds[1].y).toBe(bounds[0].y);
    const cardRows = await metrics.getByRole('group').evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().y));
    expect(new Set(cardRows).size).toBe(1);
    const sidebar = await page.getByRole('complementary').boundingBox();
    expect(sidebar!.width).toBe(232);
    await expect(page.getByText('Three-room prototype', { exact: true })).toHaveCount(0);
    const sidebarFooter = page.locator('.rd-sidebar-footer');
    await expect(sidebarFooter.locator('img')).toHaveCount(0);
    const footerBounds = await sidebarFooter.boundingBox();
    expect(footerBounds).toEqual({ x: 22, y: sidebar!.height - 58, width: 188, height: 34 });
    const topbar = await page.locator('.dashboard-topbar').boundingBox();
    expect(topbar!.height).toBe(69);
    const images = await page.locator('img').evaluateAll((elements: HTMLImageElement[]) => elements.map((image) => {
      const bounds = image.getBoundingClientRect();
      return { loaded: image.complete && image.naturalWidth > 0, local: new URL(image.src).origin === location.origin, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, width: bounds.width, height: bounds.height };
    }));
    expect(images.length).toBeGreaterThan(4);
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
    await expect(page.getByRole('region', { name: `Room ${roomNumber} reported metrics` })).toBeVisible();
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
    for (const title of ['Water flow', 'Related alerts']) {
      await expect(page.getByRole('region', { name: title, exact: true })).toBeVisible();
    }
    await page.getByText('Recorded samples (1)', { exact: true }).click();
    await expect(page.getByRole('table', { name: 'Recorded pulse measurements' })).toBeVisible();
    const history = page.getByRole('region', { name: 'Pulse sample history' });
    expect(await history.evaluate((region) => region.scrollWidth <= region.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    if (viewport.width === 390) await page.screenshot({ path: testInfo.outputPath('room-details-mobile.png'), fullPage: true });
    await page.getByRole('navigation', { name: 'Select room' }).getByRole('link', { name: 'Room 2', exact: true }).click();
    await expect(page).toHaveURL('/rooms/room-2');
    await expect(page.getByRole('article', { name: 'Room 2', exact: true })).toBeVisible();
  });
}
