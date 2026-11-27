import { expect, test } from './fixtures/auth';

test.use({ authenticated: false });

test('welcome loads its original assets and renders without runtime errors', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`);
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveTitle('TapFlow | Welcome');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'RFID-Based Automatic Water and Electrical Line Control with Water Flow Anomaly Detection System',
  );
  await expect(page.getByRole('img', { name: 'TapFlow', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();

  const assets = await page.locator('img').evaluateAll((images: HTMLImageElement[]) =>
    images.map((image) => ({
      loaded: image.complete && image.naturalWidth > 0,
      local: new URL(image.src).origin === window.location.origin,
      renderedWidth: image.getBoundingClientRect().width,
      renderedHeight: image.getBoundingClientRect().height,
    })),
  );
  expect(assets).toHaveLength(3);
  for (const asset of assets) {
    expect(asset.loaded).toBe(true);
    expect(asset.local).toBe(true);
    expect(asset.renderedWidth).toBeGreaterThan(0);
    expect(asset.renderedHeight).toBeGreaterThan(0);
  }
  expect(await page.evaluate(() => document.fonts.check('740 55px "Inter Variable"'))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('welcome-desktop.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('keyboard login opens Overview, survives refresh, and returns to Welcome', async ({ page, auth }) => {
  await page.goto('/');
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
  await page.keyboard.type(auth.email);
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.keyboard.type(auth.password);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/overview');
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('TapFlow | Overview');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to Welcome' }).click();
  await expect(page).toHaveURL('/');
  await page.goBack();
  await expect(page).toHaveURL('/overview');
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1920, height: 1080 },
]) {
  test(`welcome stays usable at ${viewport.width} x ${viewport.height}`, async ({ page, auth }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    const heading = page.getByRole('heading', { level: 1 });
    const action = page.getByRole('button', { name: 'Sign In', exact: true });
    await expect(heading).toBeVisible();
    await expect(action).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
    const headingBounds = await heading.boundingBox();
    const actionBounds = await action.boundingBox();
    expect(headingBounds!.x).toBeGreaterThanOrEqual(0);
    expect(headingBounds!.x + headingBounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(actionBounds!.height).toBeGreaterThanOrEqual(44);
    if (viewport.width === 390) {
      await page.screenshot({ path: testInfo.outputPath('welcome-mobile.png'), fullPage: true });
    }

    await auth.signIn(page);
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  });
}

test('unknown routes offer a working path back to Welcome', async ({ page }) => {
  await page.goto('/missing-page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to Welcome' }).click();
  await expect(page).toHaveURL('/');
});
