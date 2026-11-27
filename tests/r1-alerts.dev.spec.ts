import { expect, test } from './fixtures/auth';

test.use({ authenticated: false, realtimeEnabled: true });

test('R1 StrictMode keeps one feed and logs sanitized subscription, event, and refresh diagnostics', async ({ page, auth, realtime }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1_000));
  const logs: { message: string; values: unknown[] }[] = [];
  const pendingLogs: Promise<void>[] = [];
  page.on('console', (entry) => {
    if (!entry.text().startsWith('[TapFlow R1]')) return;
    pendingLogs.push(Promise.all(entry.args().map((argument) => argument.jsonValue()))
      .then((values) => { logs.push({ message: entry.text(), values }); }));
  });
  const active = {
    id: '71', detected_at: '2026-11-25T01:00:00Z', room_id: 2,
    code: 'R1_MISSING_FLOW_SIGNAL', status: 'ACTIVE', resolved_at: null,
    evidence: { note: 'private-test-evidence' },
  };
  let records: unknown[] = [];
  let reads = 0;
  await page.route('**/rest/v1/tapflow_r1_alerts*', async (route) => {
    reads++;
    await route.fulfill({ json: records });
  });
  await page.goto('/');
  await auth.signIn(page);
  await expect(page).toHaveURL('/overview');
  await expect.poll(() => realtime.activeAlertCount).toBe(1);
  await expect(page.getByRole('button', { name: 'Alerts, 0 open', exact: true })).toBeVisible();
  await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
  expect(realtime.alertJoins).toHaveLength(1);
  await expect.poll(() => logs.some(({ message }) => message.startsWith('[TapFlow R1] SUBSCRIBED'))).toBe(true);

  records = [active];
  realtime.change('tapflow_r1_alerts', 'INSERT', { ...active, evidence: { note: 'do-not-log-payload' } });
  await expect(page.getByRole('button', { name: 'Alerts, 1 open', exact: true })).toBeVisible();
  await expect.poll(() => logs.some(({ values }) => values[0] === '[TapFlow R1] Database event'
    && (values[1] as { event?: string })?.event === 'INSERT')).toBe(true);
  await expect.poll(() => logs.some(({ values }) => values[0] === '[TapFlow R1] Refresh applied'
    && (values[1] as { reason?: string })?.reason === 'INSERT')).toBe(true);
  await expect(page.getByRole('region', { name: 'Alert notifications' })).toBeVisible();

  realtime.alertSystemStatus('error', 'Test subscription failure access_token=synthetic-secret');
  await expect.poll(() => logs.some(({ values }) => JSON.stringify(values).includes('[redacted]'))).toBe(true);
  await Promise.all(pendingLogs);
  const diagnostics = JSON.stringify(logs);
  for (const confidential of ['synthetic-secret', 'do-not-log-payload', 'private-test-evidence', auth.session.access_token]) {
    expect(diagnostics.includes(confidential)).toBe(false);
  }
  expect(realtime.alertJoins).toHaveLength(1);
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect.poll(() => realtime.activeAlertCount).toBe(0);
  await expect.poll(() => logs.some(({ message }) => message === '[TapFlow R1] Subscription cleanup')).toBe(true);
});
