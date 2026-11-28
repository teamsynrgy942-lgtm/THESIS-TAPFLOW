import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/auth';

const tableEndpoint = '**/rest/v1/tapflow_r1_alerts*';
const capabilityEndpoint = '**/rest/v1/rpc/tapflow_can_resolve_r1';
const resolveEndpoint = '**/rest/v1/rpc/resolve_tapflow_incident';
const title = 'Unauthorized Water Flow';
const incident = {
  id: '9007199254740993', room_id: 2, code: 'R2_UNAUTHORIZED_WATER_FLOW', status: 'ACTIVE',
  detected_at: '2026-11-27T16:00:00Z', resolved_at: null as string | null,
};
const sameRoomR1 = { ...incident, id: '9007199254740994', code: 'R1_MISSING_FLOW_SIGNAL' };
const otherRoomR2 = { ...incident, id: '9007199254740995', room_id: 3 };

const history = (page: Page) => page.getByRole('table', { name: 'Alert history', exact: true });
const row = (page: Page, id = incident.id) => history(page).locator(`tr[data-alert-id="${id}"]`);
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Mark alert as resolved', exact: true });
const resolveButton = (page: Page, id = incident.id) => row(page, id).getByRole('button', { name: 'Mark as Resolved', exact: true });

test.use({ realtimeEnabled: true });

test('staff resolution records the R2 audit fields and keeps the other incidents open', async ({ page, auth, realtime }) => {
  const remark = 'Inspected the Room 2 valve and corrected the source of the flow.';
  const confirmed = {
    ...incident, status: 'RESOLVED', resolved_at: '2026-11-27T16:20:00Z',
    resolved_by: auth.session.user.id, resolution_remark: remark,
  };
  let records = [incident, sameRoomR1, otherRoomR2];
  let mutations = 0;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });

  await page.route(capabilityEndpoint, (route) => route.fulfill({ json: true }));
  await page.route(tableEndpoint, async (route) => {
    expect(route.request().method()).toBe('GET');
    await route.fulfill({ json: records });
  });
  await page.route(resolveEndpoint, async (route) => {
    mutations++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers().authorization === `Bearer ${auth.session.access_token}`).toBe(true);
    expect(route.request().postDataJSON()).toEqual({ p_incident_id: incident.id, p_remark: remark });
    await waiting;
    records = [confirmed, sameRoomR1, otherRoomR2];
    await route.fulfill({ json: confirmed });
  });

  await page.goto('/alerts');
  await expect.poll(() => realtime.activeAlertCount).toBe(1);
  await expect(page.getByRole('button', { name: 'Alerts, 3 open', exact: true })).toBeVisible();
  await resolveButton(page).click();
  await expect(dialog(page)).toContainText(title);
  await expect(dialog(page)).toContainText('Room 2');
  await expect(dialog(page)).toContainText(/inspect.*address/i);
  expect(mutations).toBe(0);
  await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
  expect(mutations).toBe(0);
  await resolveButton(page).click();
  await dialog(page).getByLabel('Remark (optional)', { exact: true }).fill(`  ${remark}  `);
  try {
    await dialog(page).getByRole('button', { name: 'Mark as Resolved', exact: true }).click();
    await expect.poll(() => mutations).toBe(1);
    await expect(dialog(page).getByRole('button', { name: /^Resolving/ })).toBeDisabled();
    await dialog(page).locator('form').evaluate((form) => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await expect(row(page).getByText('Active', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Alerts, 3 open', exact: true })).toBeVisible();
    expect(mutations).toBe(1);
  } finally { release(); }

  await expect(dialog(page)).not.toBeVisible();
  await expect(row(page).getByText('Resolved', { exact: true })).toBeVisible();
  await expect(row(page).locator(`time[datetime="${confirmed.resolved_at}"]`)).toContainText(/Nov 28, 2026.*12:20 AM PHT/);
  await expect(row(page)).toContainText(auth.session.user.id);
  await expect(row(page)).toContainText(remark);
  await expect(resolveButton(page)).toHaveCount(0);
  for (const other of [sameRoomR1, otherRoomR2]) {
    await expect(row(page, other.id).getByText('Active', { exact: true })).toBeVisible();
    await expect(resolveButton(page, other.id)).toBeVisible();
  }
  await expect(history(page).locator('tbody tr')).toHaveCount(3);

  await page.getByRole('button', { name: 'Alerts, 2 open', exact: true }).click();
  const preview = page.getByRole('region', { name: 'Alerts preview', exact: true });
  await expect(preview.getByRole('listitem').filter({ hasText: title })).toHaveCount(1);
  await expect(preview.getByRole('listitem').filter({ hasText: title })).toContainText('Room 3');
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Room Details', exact: true }).click();
  await page.getByRole('navigation', { name: 'Select room', exact: true }).getByRole('link', { name: 'Room 2', exact: true }).click();
  const related = page.getByRole('region', { name: 'Related alerts', exact: true });
  await expect(related.getByRole('listitem')).toHaveCount(1);
  await expect(related.getByText('Possible Flow Sensor Failure', { exact: true })).toBeVisible();
  expect(mutations).toBe(1);
});

test('an account without staff capability can view R2 but has no resolution action', async ({ page }) => {
  const checkedCapability = page.waitForResponse((response) => response.url().endsWith('/rpc/tapflow_can_resolve_r1'));
  await page.route(tableEndpoint, (route) => route.fulfill({ json: [incident] }));
  await page.goto('/alerts');
  expect(await (await checkedCapability).json()).toBe(false);
  await expect(row(page).getByText(title, { exact: true })).toBeVisible();
  await expect(row(page).getByText('Active', { exact: true })).toBeVisible();
  await expect(resolveButton(page)).toHaveCount(0);
});

for (const failure of [
  { status: 403, code: '42501', message: 'Staff access required' },
  { status: 500, code: 'XX000', message: 'Resolution update failed' },
]) {
  test(`R2 remains active when resolution returns HTTP ${failure.status}`, async ({ page }) => {
    let mutations = 0;
    await page.route(capabilityEndpoint, (route) => route.fulfill({ json: true }));
    await page.route(tableEndpoint, (route) => route.fulfill({ json: [incident] }));
    await page.route(resolveEndpoint, async (route) => {
      mutations++;
      expect(route.request().postDataJSON()).toEqual({ p_incident_id: incident.id, p_remark: null });
      await route.fulfill({ status: failure.status, json: { code: failure.code, message: failure.message } });
    });
    await page.goto('/alerts');
    await resolveButton(page).click();
    await dialog(page).getByRole('button', { name: 'Mark as Resolved', exact: true }).click();
    await expect(dialog(page).getByRole('alert')).toContainText(failure.message);
    await expect(dialog(page).getByRole('button', { name: 'Mark as Resolved', exact: true })).toBeEnabled();
    await expect(row(page).getByText('Active', { exact: true })).toBeVisible();
    await expect(row(page).getByText('Resolved', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Alerts, 1 open', exact: true })).toBeVisible();
    expect(mutations).toBe(1);
  });
}
