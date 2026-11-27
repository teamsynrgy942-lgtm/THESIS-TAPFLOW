import { expect, test } from './fixtures/auth';

const active = {
  id: '42',
  detected_at: '2026-11-27T02:00:00.000Z',
  room_id: 2,
  code: 'R1_MISSING_FLOW_SIGNAL',
  status: 'ACTIVE',
  evidence: { room_sample_count: 0 },
  resolved_at: null,
};

test('staff resolution stays hidden until the reviewed database function exists', async ({ page }) => {
  await page.goto('/alerts');
  await expect(page.getByText('Mark as Resolved is not available until the reviewed database function is deployed. Active incidents stay in this log.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark as Resolved', exact: true })).toHaveCount(0);
});

test('an authorization failure leaves the incident active and a successful call refreshes that row', async ({ page, auth }) => {
  let denied = true;
  let records: unknown[] = [active];
  const bodies: unknown[] = [];
  await page.route('**/rest/v1/', async (route) => {
    await route.fulfill({ json: { paths: { '/rpc/resolve_tapflow_incident': { post: {} } } } });
  });
  await page.route('**/rest/v1/tapflow_r1_alerts*', async (route) => {
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers().authorization === `Bearer ${auth.session.access_token}`).toBe(true);
    await route.fulfill({ json: records });
  });
  await page.route('**/rest/v1/rpc/resolve_tapflow_incident', async (route) => {
    expect(route.request().method()).toBe('POST');
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    expect(body.p_alert_id).toBe(active.id);
    expect(body).not.toHaveProperty('resolved_by');
    expect(body).not.toHaveProperty('resolved_at');
    if (denied) {
      await route.fulfill({ status: 403, json: { code: '42501', message: 'permission denied for function resolve_tapflow_incident' } });
      return;
    }
    records = [{
      ...active, status: 'RESOLVED', resolved_at: '2026-11-27T03:00:00.000Z',
      evidence: { room_sample_count: 0, resolution_note: body.p_remarks },
    }];
    await route.fulfill({ json: records[0] });
  });

  await page.goto('/alerts');
  const row = page.getByRole('row').filter({ hasText: 'Room 2' });
  await expect(row.getByRole('button', { name: 'Mark as Resolved', exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Mark as Resolved', exact: true }).click();
  await page.getByLabel('Resolution remarks (optional)', { exact: true }).fill('Valve wiring reseated');
  await page.getByRole('button', { name: 'Confirm resolution', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('not authorized');
  await expect(row.getByText('Active', { exact: true })).toBeVisible();

  denied = false;
  await page.getByRole('button', { name: 'Confirm resolution', exact: true }).click();
  await expect(row.getByText('Resolved', { exact: true })).toBeVisible();
  await row.getByText('Recorded evidence', { exact: true }).click();
  await expect(row.getByText('Valve wiring reseated', { exact: true })).toBeVisible();
  expect(bodies).toHaveLength(2);
});

test('All, Active, and Resolved filters keep both incident states available', async ({ page, auth }) => {
  const resolved = { ...active, id: '43', room_id: 1, status: 'RESOLVED', resolved_at: '2026-11-27T02:30:00.000Z' };
  await page.route('**/rest/v1/tapflow_r1_alerts*', async (route) => {
    expect(route.request().headers().authorization === `Bearer ${auth.session.access_token}`).toBe(true);
    await route.fulfill({ json: [active, resolved] });
  });
  await page.goto('/alerts');
  const table = page.getByRole('table', { name: 'Alert history', exact: true });
  await expect(table.getByRole('row').filter({ hasText: 'Room 2' })).toContainText('Active');
  await expect(table.getByRole('row').filter({ hasText: 'Room 1' })).toContainText('Resolved');
  await page.getByRole('radio', { name: 'Active', exact: true }).check();
  await expect(table.getByRole('row').filter({ hasText: 'Room 1' })).toHaveCount(0);
  await expect(table.getByRole('row').filter({ hasText: 'Room 2' })).toContainText('Active');
  await page.getByRole('radio', { name: 'Resolved', exact: true }).check();
  await expect(table.getByRole('row').filter({ hasText: 'Room 2' })).toHaveCount(0);
  await expect(table.getByRole('row').filter({ hasText: 'Room 1' })).toContainText('Resolved');
});
