import { expect, test } from './fixtures/auth';

test.use({ authenticated: false });

for (const path of ['/overview', '/rooms', '/rooms/room-2', '/alerts']) {
  test(`signed-out visitors are redirected from ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('form', { name: 'Dashboard sign in' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Dashboard navigation' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /sign up/i })).toHaveCount(0);
  });
}

test('login returns to the requested page, refresh restores it, and logout protects history', async ({ page, auth }) => {
  await page.goto('/rooms/room-2?view=details#selected-room-title');
  await expect(page).toHaveURL('/');
  auth.delayMs = 400;
  await auth.signIn(page);
  await expect(page.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
  await expect(page).toHaveURL('/rooms/room-2?view=details#selected-room-title');
  await page.reload();
  await expect(page.getByRole('article', { name: 'Room 2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Alerts/ }).click();
  await page.getByRole('link', { name: /^View all alerts/ }).click();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Signing out…');
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('navigation', { name: 'Dashboard navigation' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
});

test('invalid credentials show an accessible error and allow a successful retry', async ({ page, auth }) => {
  auth.signInError = { code: 'invalid_credentials', status: 400 };
  await page.goto('/');
  await auth.signIn(page);
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeEnabled();
  await expect(page).toHaveURL('/');
  auth.signInError = null;
  await auth.signIn(page);
  await expect(page).toHaveURL('/overview');
});

for (const [code, status, message] of [
  ['email_not_confirmed', 400, 'Please contact your project administrator to confirm your account.'],
  ['over_request_rate_limit', 429, 'Too many sign-in attempts. Please wait a moment and try again.'],
  ['unexpected_failure', 500, 'Unable to sign in. Please check your connection and try again.'],
] as const) {
  test(`login handles ${code}`, async ({ page, auth }) => {
    auth.signInError = { code, status };
    await page.goto('/');
    await auth.signIn(page);
    await expect(page.getByRole('alert')).toHaveText(message);
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeEnabled();
  });
}

test('server logout failure is reported after the local session is cleared', async ({ page, auth }) => {
  await page.goto('/');
  await auth.signIn(page);
  auth.logoutFails = true;
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('You are signed out on this device, but server logout could not be confirmed. Please check your connection.');
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeEnabled();
  await page.goto('/overview');
  await expect(page).toHaveURL('/');
});

for (const refreshFails of [false, true]) {
  test(`expired session ${refreshFails ? 'returns to login when refresh is rejected' : 'refreshes before showing the dashboard'}`, async ({ page, auth }) => {
    await page.goto('/');
    await auth.signIn(page);
    await expect(page).toHaveURL('/overview');
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find((key) => key.endsWith('-auth-token'))!;
      const session = JSON.parse(localStorage.getItem(key)!);
      session.expires_at = Math.floor(Date.now() / 1000) - 60;
      localStorage.setItem(key, JSON.stringify(session));
    });
    auth.refreshFails = refreshFails;
    auth.delayMs = 600;
    await page.reload();
    await expect(page.getByRole('status')).toHaveText('Restoring your session…');
    await expect(page.getByRole('navigation', { name: 'Dashboard navigation' })).toHaveCount(0);
    if (refreshFails) {
      await expect(page).toHaveURL('/');
      await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    }
  });
}

test('logout synchronizes across tabs', async ({ page, context, auth }) => {
  await page.goto('/');
  await auth.signIn(page);
  await expect(page).toHaveURL('/overview');
  const otherTab = await context.newPage();
  await otherTab.goto('/alerts');
  await expect(otherTab.getByRole('heading', { name: 'Alerts', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(otherTab).toHaveURL('/');
  await expect(otherTab.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
});
