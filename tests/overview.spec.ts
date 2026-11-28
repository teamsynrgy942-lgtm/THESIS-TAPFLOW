import { expect, test } from './fixtures/auth';

test.use({ viewport: { width: 1440, height: 900 } });

test('Overview retains the Figma shell and cards while displaying database telemetry', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
  await page.goto('/overview');
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveTitle('TapFlow | Overview');
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.locator('.overview-check-time')).toContainText('Last checked');

  for (const roomNumber of [1, 2, 3]) {
    const card = page.getByRole('article', { name: `Room ${roomNumber}`, exact: true });
    await expect(card.getByText('Recent report', { exact: true })).toBeVisible();
    await expect(card.getByText(roomNumber === 1 ? 'Active' : 'Inactive', { exact: true })).toBeVisible();
    await expect(card.getByText(roomNumber === 2 ? 'Open' : 'Closed', { exact: true })).toBeVisible();
    await expect(card.getByText(roomNumber === 3 ? 'On' : 'Off', { exact: true })).toBeVisible();
    await expect(card.getByText('Flow Detected', { exact: true })).toBeVisible();
    await expect(card.getByText(/not calibrated|pulses|used today/i)).toHaveCount(0);
    await expect(card.locator('time')).toHaveCount(0);
    await expect(card.getByRole('link', { name: `View Room ${roomNumber} details` })).toBeVisible();
  }
  const inlet = page.getByRole('region', { name: 'Main water inlet' });
  await expect(inlet.getByText('Recent report', { exact: true })).toBeVisible();
  await expect(inlet.getByText('Unavailable', { exact: true })).toHaveCount(2);

  const sidebar = await page.getByRole('complementary').boundingBox();
  expect(sidebar!.width).toBe(222);
  expect(sidebar!.height).toBe(900);
  const navigationIcons = await page.getByRole('navigation', { name: 'Dashboard navigation' }).locator('img').evaluateAll((images: HTMLImageElement[]) => images.map((image) => {
    const { x, y, width, height } = image.getBoundingClientRect();
    return { x, y, width, height, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, loaded: image.complete, local: new URL(image.src).origin === location.origin };
  }));
  expect(navigationIcons).toHaveLength(2);
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
    expect(card.y).toBeCloseTo(cards[0].y, 0);
    expect(card.width).toBeCloseTo(372, 0);
    expect(card.height).toBeCloseTo(cards[0].height, 0);
  });
  const inletBounds = await inlet.boundingBox();
  expect(inletBounds!.x).toBe(254);
  expect(inletBounds!.y).toBeCloseTo(cards[0].y + cards[0].height + 16, 0);
  expect(inletBounds!.width).toBeCloseTo(cards.at(-1)!.x + cards.at(-1)!.width - cards[0].x, 0);
  const logo = await page.locator('.dashboard-brand img').evaluate((image: HTMLImageElement) => ({
    loaded: image.complete && image.naturalWidth === 224 && image.naturalHeight === 224,
    local: new URL(image.src).origin === location.origin,
    width: image.getBoundingClientRect().width,
    height: image.getBoundingClientRect().height,
  }));
  expect(logo).toEqual({ loaded: true, local: true, width: 42, height: 42 });
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
  await page.getByRole('button', { name: /^Alerts/ }).click();
  await page.getByRole('link', { name: /^View all alerts/ }).click();
  await expect(page).toHaveURL('/alerts');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Alerts');
  await expect(page.getByText('No alert records yet', { exact: true })).toBeVisible();
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

for (const width of [320, 390, 768, 1024]) {
  test(`Overview adapts the room grid at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/overview');
    await expect(page.locator('.overview-check-time')).toContainText('Last checked');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const cards = await page.locator('.room-card').evaluateAll((items) => items.map((item) => item.getBoundingClientRect().top));
    expect(new Set(cards).size).toBe(width < 660 ? 3 : 2);
    if (width === 390) await page.screenshot({ path: testInfo.outputPath('overview-mobile.png'), fullPage: true });
    await page.getByRole('link', { name: 'View Room 3 details' }).click();
    await expect(page.getByRole('article', { name: 'Room 3', exact: true })).toBeVisible();
  });
}
