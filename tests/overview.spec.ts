import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

test('Overview matches the 1440 x 900 Figma geometry and initial demo values', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
  await page.goto('/overview');
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveTitle('TapFlow | Overview');
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByText('All three rooms are idle.')).toBeVisible();
  await expect(page.getByText('No active alerts', { exact: true })).toBeVisible();
  await expect(page.getByText('Last update 10:30 AM PHT')).toBeVisible();

  for (const roomNumber of [1, 2, 3]) {
    const card = page.getByRole('article', { name: `Room ${roomNumber}`, exact: true });
    await expect(card.getByText('Idle', { exact: true })).toBeVisible();
    await expect(card.getByText('Inactive', { exact: true })).toBeVisible();
    await expect(card.getByText('Closed', { exact: true })).toBeVisible();
    await expect(card.getByText('Off', { exact: true })).toBeVisible();
    await expect(card.getByText('0.00', { exact: true })).toBeVisible();
    await expect(card.getByText('0 L', { exact: true })).toBeVisible();
    await expect(card.getByRole('link', { name: `View Room ${roomNumber} details` })).toBeVisible();
  }
  const inlet = page.getByRole('region', { name: 'Main water inlet' });
  await expect(inlet.getByText('No flow detected')).toBeVisible();
  await expect(inlet.getByText('0.00', { exact: true })).toBeVisible();

  const sidebar = await page.getByRole('complementary').boundingBox();
  expect(sidebar!.width).toBe(222);
  expect(sidebar!.height).toBe(900);
  const navigationIcons = await page.getByRole('navigation', { name: 'Dashboard navigation' }).locator('img').evaluateAll((images: HTMLImageElement[]) => images.map((image) => {
    const { x, y, width, height } = image.getBoundingClientRect();
    return { x, y, width, height, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, loaded: image.complete, local: new URL(image.src).origin === location.origin };
  }));
  expect(navigationIcons).toHaveLength(3);
  navigationIcons.forEach((icon, index) => {
    expect(icon.loaded).toBe(true);
    expect(icon.local).toBe(true);
    expect(icon.naturalWidth).toBe(20);
    expect(icon.naturalHeight).toBe(20);
    expect(icon.width).toBe(20);
    expect(icon.height).toBe(20);
    expect(icon.x).toBe(29);
    expect(icon.y).toBe(122 + index * 52);
  });
  const cards = await page.locator('.room-card').evaluateAll((elements) => elements.map((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  }));
  expect(cards).toHaveLength(3);
  cards.forEach((card, index) => {
    expect(card.x).toBeCloseTo(254 + 391 * index, 0);
    expect(card.y).toBeCloseTo(255.99, 0);
    expect(card.width).toBeCloseTo(372, 0);
    expect(card.height).toBeCloseTo(252, 0);
  });
  const inletBounds = await inlet.boundingBox();
  expect(inletBounds!.x).toBe(254);
  expect(inletBounds!.y).toBeCloseTo(523.99, 0);
  expect(inletBounds!.height).toBeCloseTo(133, 0);
  const logo = await page.locator('.dashboard-brand img').evaluate((image: HTMLImageElement) => ({
    loaded: image.complete && image.naturalWidth === 42,
    local: new URL(image.src).origin === location.origin,
    width: image.getBoundingClientRect().width,
    height: image.getBoundingClientRect().height,
  }));
  expect(logo).toEqual({ loaded: true, local: true, width: 38, height: 38 });
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
  expect(dimensions).toEqual({ width: 1440, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('overview-desktop.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('sidebar navigation and the Welcome brand link work', async ({ page }) => {
  await page.goto('/overview');
  const navigation = page.getByRole('navigation', { name: 'Dashboard navigation' });
  await expect(navigation.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute('aria-current', 'page');
  await navigation.getByRole('link', { name: 'Room Details', exact: true }).click();
  await expect(page).toHaveURL('/rooms');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Details');
  await expect(navigation.getByRole('link', { name: 'Room Details', exact: true })).toHaveAttribute('aria-current', 'page');
  await navigation.getByRole('link', { name: 'Alerts', exact: true }).click();
  await expect(page).toHaveURL('/alerts');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Alerts');
  await expect(page.getByText('No alert records yet', { exact: true })).toBeVisible();
  await expect(page.getByText('Monitoring not yet active', { exact: true })).toBeVisible();
  await navigation.getByRole('link', { name: 'Overview', exact: true }).click();
  await page.getByRole('link', { name: 'Back to Welcome', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: 'Open Dashboard' })).toBeVisible();
});

for (const roomNumber of [1, 2, 3]) {
  test(`View details opens Room ${roomNumber} and survives a refresh`, async ({ page }) => {
    await page.goto('/overview');
    await page.getByRole('link', { name: `View Room ${roomNumber} details`, exact: true }).click();
    await expect(page).toHaveURL(`/rooms/room-${roomNumber}`);
    await expect(page.getByRole('article', { name: `Room ${roomNumber}`, exact: true })).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(1);
    await page.reload();
    await expect(page.getByRole('article', { name: `Room ${roomNumber}`, exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Dashboard navigation' }).getByRole('link', { name: 'Room Details', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('link', { name: 'Back to Overview' }).click();
    await expect(page).toHaveURL('/overview');
    await expect(page.getByRole('article')).toHaveCount(3);
  });
}

test('the room selector switches details and unknown room URLs recover safely', async ({ page }) => {
  await page.goto('/rooms/room-1');
  await page.getByRole('navigation', { name: 'Select room' }).getByRole('link', { name: 'Room 3' }).click();
  await expect(page.getByRole('article', { name: 'Room 3', exact: true })).toBeVisible();
  await page.goto('/rooms/missing');
  await expect(page.getByText('The requested room could not be found.')).toBeVisible();
  await page.getByRole('navigation', { name: 'Select room' }).getByRole('link', { name: 'Room 1' }).click();
  await expect(page.getByRole('article', { name: 'Room 1', exact: true })).toBeVisible();
});

test('Overview remains usable on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/overview');
  const size = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(size.content).toBeLessThanOrEqual(size.viewport);
  await page.getByRole('link', { name: 'View Room 3 details' }).click();
  await expect(page.getByRole('article', { name: 'Room 3', exact: true })).toBeVisible();
});
