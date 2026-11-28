import { expect, test } from './fixtures/auth';

const tableName = 'tapflow_r1_alerts';
const endpoint = `**/rest/v1/${tableName}*`;
const title = 'Unauthorized Water Flow';
const r1 = {
  id: '1', room_id: 2, status: 'ACTIVE', code: 'R1_MISSING_FLOW_SIGNAL',
  detected_at: '2025-01-01T16:00:00Z', resolved_at: null, evidence: { room_sample_count: 0 },
};

function r2Incident(room: number) {
  return {
    id: String(room + 1), room_id: room, status: 'ACTIVE', code: 'R2_UNAUTHORIZED_WATER_FLOW',
    detected_at: `2025-01-01T16:0${room}:00Z`, resolved_at: null,
    evidence: { previous_pulses: 0, latest_pulses: 17, sample_ms: 15000, rfid_active: false },
  };
}

function description(room: number) {
  return `Room ${room} reported sustained water-flow pulses while recent room status indicated an inactive RFID session and a valve commanded OFF.`;
}

test.use({ realtimeEnabled: true });

test('R2 realtime incidents appear independently in every room alongside R1', async ({ page, realtime }) => {
  const room2 = r2Incident(2);
  let records: Record<string, unknown>[] = [r1];
  await page.route(endpoint, (route) => route.fulfill({ json: records }));
  await page.goto('/rooms/room-2');
  const related = page.getByRole('region', { name: 'Related alerts', exact: true });
  await expect.poll(() => realtime.activeAlertCount).toBe(1);
  await expect(related.getByRole('listitem')).toHaveCount(1);
  const joins = realtime.alertJoins.length;

  records = [room2, r1];
  realtime.change(tableName, 'INSERT', room2);
  await expect(related.getByRole('listitem')).toHaveCount(2);
  await expect(related.getByText('Possible Flow Sensor Failure', { exact: true })).toBeVisible();
  const roomAlert = related.getByRole('listitem').filter({ hasText: title });
  await expect(roomAlert.getByText(description(2), { exact: true })).toBeVisible();
  await roomAlert.getByText('Recorded evidence', { exact: true }).click();
  await expect(roomAlert.getByText('Latest pulses', { exact: true })).toBeVisible();
  await expect(roomAlert.getByText('17', { exact: true })).toBeVisible();

  const notification = page.getByRole('region', { name: 'Alert notifications', exact: true });
  await expect(notification).toContainText(`${title} · Room 2`);
  const updated = { ...room2, evidence: { ...room2.evidence, latest_pulses: 24 } };
  records = [updated, r1];
  realtime.change(tableName, 'UPDATE', updated);
  await expect(roomAlert.getByText('24', { exact: true })).toBeVisible();
  await expect(notification.getByText('1 more active alert', { exact: true })).toHaveCount(0);
  await notification.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
  await expect(notification).toHaveCount(0);

  const replayed = { ...updated, evidence: { ...updated.evidence, latest_pulses: 28 } };
  records = [replayed, r1];
  realtime.change(tableName, 'INSERT', room2);
  realtime.change(tableName, 'UPDATE', replayed);
  await expect(roomAlert.getByText('28', { exact: true })).toBeVisible();
  await expect(notification).toHaveCount(0);

  const room1 = r2Incident(1);
  const room3 = r2Incident(3);
  records = [room3, replayed, room1, r1];
  realtime.change(tableName, 'INSERT', room1);
  realtime.change(tableName, 'INSERT', room3);
  const bell = page.getByRole('button', { name: 'Alerts, 4 open', exact: true });
  await bell.click();
  const preview = page.getByRole('region', { name: 'Alerts preview', exact: true });
  await expect(preview.getByRole('listitem')).toHaveCount(4);
  const r2Items = preview.getByRole('listitem').filter({ hasText: title });
  await expect(r2Items).toHaveCount(3);
  for (const room of [1, 2, 3]) await expect(r2Items.getByText(`Room ${room}`, { exact: true })).toHaveCount(1);
  await bell.click();

  const selector = page.getByRole('navigation', { name: 'Select room', exact: true });
  for (const room of [1, 3]) {
    await selector.getByRole('link', { name: `Room ${room}`, exact: true }).click();
    await expect(related.getByRole('listitem')).toHaveCount(1);
    await expect(related.getByText(description(room), { exact: true })).toBeVisible();
  }
  await related.getByRole('link', { name: 'View Alerts', exact: true }).click();
  const table = page.getByRole('table', { name: 'Alert history', exact: true });
  await expect(table.locator('tbody tr')).toHaveCount(4);
  for (const incident of [room1, room2, room3]) {
    const row = table.locator(`tr[data-alert-id="${incident.id}"]`);
    await expect(row.getByText(title, { exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: `Room ${incident.room_id}`, exact: true })).toBeVisible();
    await expect(row.getByText(description(incident.room_id), { exact: true })).toBeVisible();
    await expect(row.getByText('Active', { exact: true })).toBeVisible();
  }

  const resolved = { ...replayed, status: 'RESOLVED', resolved_at: '2025-01-01T16:30:00Z' };
  records = [room3, resolved, room1, r1];
  realtime.change(tableName, 'UPDATE', resolved);
  const resolvedRow = table.locator(`tr[data-alert-id="${resolved.id}"]`);
  await expect(resolvedRow.getByText('Resolved', { exact: true })).toBeVisible();
  await expect(resolvedRow.locator(`time[datetime="${resolved.resolved_at}"]`)).toContainText(/Jan 2, 2025.*12:30 AM PHT/);
  await expect(table.locator(`tr[data-alert-id="${r1.id}"]`).getByText('Active', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Alerts, 3 open', exact: true })).toBeVisible();
  expect(realtime.activeAlertCount).toBe(1);
  expect(realtime.alertJoins).toHaveLength(joins);
});

test('polling discovers an R2 incident and reconciles evidence without notifying again', async ({ page, realtime }) => {
  await page.clock.install();
  realtime.acceptJoins = false;
  let records: ReturnType<typeof r2Incident>[] = [];
  await page.route(endpoint, (route) => route.fulfill({ json: records }));
  await page.goto('/alerts');
  await expect(page.getByRole('heading', { name: 'No alert records yet' })).toBeVisible();

  const incident = r2Incident(1);
  records = [incident];
  await page.clock.fastForward(15_000);
  const notification = page.getByRole('region', { name: 'Alert notifications', exact: true });
  await expect(notification).toContainText(`${title} · Room 1`);
  await expect(page.getByRole('button', { name: 'Alerts, 1 open', exact: true })).toBeVisible();
  await notification.getByRole('button', { name: 'Dismiss notification', exact: true }).click();

  const row = page.getByRole('table', { name: 'Alert history', exact: true }).locator(`tr[data-alert-id="${incident.id}"]`);
  await row.getByText('Recorded evidence', { exact: true }).click();
  await expect(row.getByText('0', { exact: true })).toBeVisible();
  await expect(row.getByText('No', { exact: true })).toBeVisible();
  records = [{ ...incident, evidence: { ...incident.evidence, latest_pulses: 24 } }];
  await page.clock.fastForward(15_000);
  await expect(row.getByText('24', { exact: true })).toBeVisible();
  await expect(row).toHaveCount(1);
  await expect(notification).toHaveCount(0);
  expect(realtime.activeAlertCount).toBe(0);
});
