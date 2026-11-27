import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/auth';

const tableEndpoint = '**/rest/v1/tapflow_r1_alerts*';
const capabilityEndpoint = '**/rest/v1/rpc/tapflow_can_resolve_r1';
const resolveEndpoint = '**/rest/v1/rpc/resolve_tapflow_incident';
const incident = {
  id: '9007199254740993', room_id: 1, code: 'R1_MISSING_FLOW_SIGNAL',
  detected_at: '2026-11-27T01:00:00Z', last_detected_at: '2026-11-27T01:05:00Z',
  status: 'ACTIVE', evidence: {}, resolved_at: null as string | null, resolved_by: null as string | null,
};
const secondEpisode = {
  ...incident, id: '9007199254740995',
  detected_at: '2026-11-27T01:15:00Z', last_detected_at: '2026-11-27T01:16:00Z',
};

const history = (page: Page) => page.getByRole('table', { name: 'Alert history', exact: true });
const row = (page: Page, id = incident.id) => history(page).locator(`tr[data-alert-id="${id}"]`);
const resolutionDialog = (page: Page) => page.getByRole('dialog', { name: 'Mark alert as resolved', exact: true });

async function confirmResolution(page: Page, id = incident.id, remark?: string) {
  await row(page, id).getByRole('button', { name: 'Mark as Resolved', exact: true }).click();
  const dialog = resolutionDialog(page);
  await expect(dialog).toBeVisible();
  if (remark !== undefined) await dialog.getByLabel('Remark (optional)', { exact: true }).fill(remark);
  await dialog.getByRole('button', { name: 'Mark as Resolved', exact: true }).click();
}

async function allowResolution(page: Page, token: string) {
  await page.route(capabilityEndpoint, async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers().authorization === `Bearer ${token}`).toBe(true);
    await route.fulfill({ json: true });
  });
}

test.describe('R1 incident lifecycle', () => {
  test.use({ realtimeEnabled: true });

  for (const capability of ['not-staff', 'missing-action', 'denied'] as const) {
    test(`${capability} hides resolution even when editable user metadata claims staff privileges`, async ({ page, auth }) => {
      Object.assign(auth.session.user.user_metadata, { role: 'admin', staff: true, is_staff: true });
      await page.evaluate(() => {
        const key = Object.keys(localStorage).find((name) => /^sb-.*-auth-token$/.test(name));
        if (!key) throw new Error('Synthetic signed-in session was not persisted.');
        const session = JSON.parse(localStorage.getItem(key)!);
        session.user.user_metadata = { ...session.user.user_metadata, role: 'admin', staff: true, is_staff: true };
        localStorage.setItem(key, JSON.stringify(session));
      });
      let capabilityReads = 0;
      let mutations = 0;
      await page.route(capabilityEndpoint, async (route) => {
        capabilityReads++;
        await route.fulfill(capability === 'not-staff'
          ? { json: false }
          : capability === 'missing-action'
            ? { status: 404, json: { code: 'PGRST202', message: 'Capability action is not installed' } }
            : { status: 403, json: { code: '42501', message: 'Staff access required' } });
      });
      await page.route(resolveEndpoint, async (route) => {
        mutations++;
        await route.fulfill({ status: 403, json: { code: '42501', message: 'Staff access required' } });
      });
      await page.route(tableEndpoint, (route) => route.fulfill({ json: [incident] }));
      await page.goto('/alerts');
      await expect(row(page).getByText('Active', { exact: true })).toBeVisible();
      await expect.poll(() => capabilityReads).toBeGreaterThan(0);
      await expect(history(page).getByRole('button', { name: 'Mark as Resolved', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Alerts, 1 open', exact: true })).toBeVisible();
      expect(mutations).toBe(0);
    });
  }

  test('the existing alert log remains readable before the lifecycle migration is installed', async ({ page, auth }) => {
    const legacy = {
      id: incident.id, room_id: incident.room_id, code: incident.code,
      detected_at: incident.detected_at, status: incident.status,
      evidence: incident.evidence, resolved_at: incident.resolved_at,
    };
    let extendedReads = 0;
    let legacyReads = 0;
    let capabilityReads = 0;
    await page.route(capabilityEndpoint, async (route) => {
      capabilityReads++;
      await route.fulfill({ status: 404, json: { code: 'PGRST202', message: 'Capability action is not installed' } });
    });
    await page.route(tableEndpoint, async (route) => {
      expect(route.request().method()).toBe('GET');
      expect(route.request().headers().authorization === `Bearer ${auth.session.access_token}`).toBe(true);
      const columns = new URL(route.request().url()).searchParams.get('select')?.split(',') ?? [];
      const optionalColumns = columns.filter((column) => ['last_detected_at', 'resolved_by', 'resolution_remark'].includes(column));
      if (optionalColumns.length) {
        extendedReads++;
        expect(columns).toHaveLength(7 + optionalColumns.length);
        await route.fulfill({ status: 400, json: { code: '42703', message: `column tapflow_r1_alerts.${optionalColumns[0]} does not exist` } });
        return;
      }
      legacyReads++;
      expect(columns).toHaveLength(7);
      expect(columns).not.toContain('resolved_by');
      await route.fulfill({ json: [legacy] });
    });
    await page.goto('/alerts');
    await expect(row(page).getByText('Active', { exact: true })).toBeVisible();
    await expect(row(page).locator(`time[datetime="${legacy.detected_at}"]`)).toBeVisible();
    await expect.poll(() => capabilityReads).toBeGreaterThan(0);
    expect(extendedReads).toBeGreaterThan(0);
    expect(legacyReads).toBeGreaterThan(0);
    await expect(history(page).locator('tbody tr')).toHaveCount(1);
    await expect(history(page).getByRole('button', { name: 'Mark as Resolved', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Alert log', exact: true }).getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Alerts, 1 open', exact: true })).toBeVisible();
  });

  test('missing detector lifecycle fields retain the stored resolver and resolution remark', async ({ page, auth }) => {
    const resolved = {
      ...incident, status: 'RESOLVED', resolved_at: '2026-11-27T01:20:00Z',
      resolved_by: auth.session.user.id, resolution_remark: 'Signal wire repaired.',
    };
    let extendedReads = 0;
    let compatibleReads = 0;
    await page.route(tableEndpoint, async (route) => {
      const columns = new URL(route.request().url()).searchParams.get('select')?.split(',') ?? [];
      if (columns.includes('last_detected_at')) {
        extendedReads++;
        await route.fulfill({ status: 400, json: { code: '42703', message: 'column tapflow_r1_alerts.last_detected_at does not exist' } });
        return;
      }
      compatibleReads++;
      expect(columns).toContain('resolved_by');
      expect(columns).toContain('resolution_remark');
      await route.fulfill({ json: [resolved] });
    });
    await page.goto('/alerts');
    await expect(row(page).getByText('Resolved', { exact: true })).toBeVisible();
    await expect(row(page)).toContainText(resolved.resolved_by);
    await expect(row(page)).toContainText(resolved.resolution_remark);
    expect(extendedReads).toBeGreaterThan(0);
    expect(compatibleReads).toBeGreaterThan(0);
  });

  test('Cancel and Escape send no resolution; an optional blank remark can then be confirmed', async ({ page, auth }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await allowResolution(page, auth.session.access_token);
    let records = [incident];
    let mutations = 0;
    const confirmed = {
      ...incident, status: 'RESOLVED', resolved_at: '2026-11-27T01:20:00Z', resolved_by: auth.session.user.id,
      resolution_remark: null,
    };
    await page.route(tableEndpoint, (route) => route.fulfill({ json: records }));
    await page.route(resolveEndpoint, async (route) => {
      mutations++;
      expect(route.request().postDataJSON()).toEqual({ p_incident_id: incident.id, p_remark: null });
      records = [confirmed];
      await route.fulfill({ json: confirmed });
    });
    await page.goto('/alerts');
    const open = row(page).getByRole('button', { name: 'Mark as Resolved', exact: true });
    const dialog = resolutionDialog(page);
    await open.click();
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Remark (optional)', { exact: true }).fill('Do not save this canceled remark.');
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(568);
    await page.screenshot({ path: 'test-results/r1-resolution-confirmation-mobile.png' });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(row(page).getByText('Active', { exact: true })).toBeVisible();
    expect(mutations).toBe(0);
    await open.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(row(page).getByText('Active', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Alerts, 1 open', exact: true })).toBeVisible();
    expect(mutations).toBe(0);
    await confirmResolution(page, incident.id, '  \n  ');
    await expect(dialog).not.toBeVisible();
    await expect(row(page).getByText('Resolved', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Alerts, 0 open', exact: true })).toBeVisible();
    await expect(history(page).locator('tbody tr')).toHaveCount(1);
    expect(mutations).toBe(1);
  });

  test('confirmed resolution saves the optional remark, refreshes the shared feed, and leaves the second same-room alert active', async ({ page, auth, realtime }) => {
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1_000));
    await allowResolution(page, auth.session.access_token);
    let records = [incident, secondEpisode];
    let reads = 0;
    let mutations = 0;
    const remark = 'Reconnected the Room 1 flow sensor signal wire.';
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const confirmed = {
      ...incident, status: 'RESOLVED', resolved_at: '2026-11-27T01:20:00Z', resolved_by: auth.session.user.id,
      resolution_remark: remark,
    };
    await page.route(tableEndpoint, async (route) => {
      reads++;
      await route.fulfill({ json: records });
    });
    await page.route(resolveEndpoint, async (route) => {
      mutations++;
      expect(route.request().method()).toBe('POST');
      expect(route.request().headers().authorization === `Bearer ${auth.session.access_token}`).toBe(true);
      expect(route.request().postDataJSON()).toEqual({ p_incident_id: incident.id, p_remark: remark });
      await waiting;
      records = [confirmed, secondEpisode];
      await route.fulfill({ json: confirmed });
    });
    await page.goto('/alerts');
    await expect.poll(() => realtime.activeAlertCount).toBe(1);
    await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
    await expect(history(page).locator('tbody tr')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Alerts, 2 open', exact: true })).toBeVisible();
    const joins = realtime.alertJoins.length;
    const readsBeforeResolution = reads;
    await row(page).getByRole('button', { name: 'Mark as Resolved', exact: true }).click();
    const dialog = resolutionDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Room 1');
    expect(mutations).toBe(0);
    await dialog.getByLabel('Remark (optional)', { exact: true }).fill(`  ${remark}  `);
    await page.screenshot({ path: 'test-results/r1-resolution-confirmation-desktop.png' });
    await dialog.getByRole('button', { name: 'Mark as Resolved', exact: true }).click();
    try {
      await expect.poll(() => mutations).toBe(1);
      const pending = row(page).locator('.alert-history__resolve');
      await expect(pending).toBeDisabled();
      await pending.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
      await expect(dialog.getByRole('button', { name: /^Resolving/ })).toBeDisabled();
      await expect(row(page).getByText('Active', { exact: true })).toBeVisible();
      await expect(row(page).getByText('Resolved', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Alerts, 2 open', exact: true })).toBeVisible();
      expect(mutations).toBe(1);
    } finally { release(); }
    await expect(row(page).getByText('Resolved', { exact: true })).toBeVisible();
    await expect(dialog).not.toBeVisible();
    await expect.poll(() => reads).toBeGreaterThan(readsBeforeResolution);
    await expect(row(page).locator(`time[datetime="${confirmed.resolved_at}"]`)).toBeVisible();
    await expect(row(page)).toContainText(auth.session.user.id);
    await expect(row(page)).toContainText(remark);
    await expect(row(page).getByRole('button', { name: 'Mark as Resolved', exact: true })).toHaveCount(0);
    await expect(row(page, secondEpisode.id).getByText('Active', { exact: true })).toBeVisible();
    await expect(row(page, secondEpisode.id).getByRole('button', { name: 'Mark as Resolved', exact: true })).toBeVisible();
    await expect(history(page).locator('tbody tr')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Alerts, 1 open', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Alerts, 1 open', exact: true }).click();
    const preview = page.getByRole('region', { name: 'Alerts preview', exact: true });
    await expect(preview.locator('.header-alerts__list > li')).toHaveCount(1);
    await expect(preview.locator('time')).toHaveAttribute('datetime', secondEpisode.detected_at);
    expect(realtime.alertJoins).toHaveLength(joins);
    // The persisted feed also keeps the resolution and remark after a full reload.
    await page.reload();
    await expect(row(page).getByText('Resolved', { exact: true })).toBeVisible();
    await expect(row(page)).toContainText(remark);
    await expect(row(page, secondEpisode.id).getByText('Active', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Alerts, 1 open', exact: true })).toBeVisible();
    expect(mutations).toBe(1);
  });

  test('a pending older alert snapshot cannot overwrite a server-confirmed resolution', async ({ page, auth, realtime }) => {
    await page.clock.install();
    const pausedAt = Date.now() + 1_000;
    await page.clock.pauseAt(new Date(pausedAt));
    await allowResolution(page, auth.session.access_token);
    const confirmed = {
      ...incident, status: 'RESOLVED', resolved_at: '2026-11-27T01:20:00Z', resolved_by: auth.session.user.id,
    };
    let records = [incident];
    let reads = 0;
    let holdOld = false;
    let holdFresh = false;
    let oldStarted = false;
    let freshStarted = false;
    let releaseOld!: () => void;
    let releaseFresh!: () => void;
    const oldWaiting = new Promise<void>((resolve) => { releaseOld = resolve; });
    const freshWaiting = new Promise<void>((resolve) => { releaseFresh = resolve; });
    await page.route(tableEndpoint, async (route) => {
      reads++;
      const snapshot = structuredClone(records);
      if (holdOld) {
        holdOld = false;
        oldStarted = true;
        await oldWaiting;
      } else if (holdFresh) {
        freshStarted = true;
        await freshWaiting;
      }
      await route.fulfill({ json: snapshot });
    });
    await page.route(resolveEndpoint, async (route) => {
      expect(route.request().postDataJSON()).toEqual({ p_incident_id: incident.id, p_remark: null });
      records = [confirmed];
      await route.fulfill({ json: confirmed });
    });
    await page.goto('/alerts');
    await expect.poll(() => realtime.activeAlertCount).toBe(1);
    await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
    await expect(row(page).getByText('Active', { exact: true })).toBeVisible();
    const joins = realtime.alertJoins.length;
    holdOld = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    try {
      await expect.poll(() => oldStarted).toBe(true);
      // Keep the later catch-up read pending too, so it cannot conceal an
      // accidental reapplication of the old ACTIVE snapshot.
      holdFresh = true;
      await confirmResolution(page);
      await expect(row(page).getByText('Resolved', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Alerts, 0 open', exact: true })).toBeVisible();
      releaseOld();
      await expect.poll(() => freshStarted).toBe(true);
      await page.clock.runFor(50);
      await expect(row(page).getByText('Resolved', { exact: true })).toBeVisible();
      await expect(row(page).getByText('Active', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Alerts, 0 open', exact: true })).toBeVisible();
      expect(await page.evaluate(() => Date.now())).toBe(pausedAt + 50);
    } finally {
      releaseOld();
      releaseFresh();
    }
    await expect(row(page).locator(`time[datetime="${confirmed.resolved_at}"]`)).toBeVisible();
    await expect(history(page).locator('tbody tr')).toHaveCount(1);
    expect(realtime.alertJoins).toHaveLength(joins);
  });

  for (const failure of ['staff-revoked', 'missing-resolution-action', 'server-error', 'unconfirmed-response', 'wrong-incident'] as const) {
    test(`${failure} keeps the incident open and reports a resolution error`, async ({ page, auth }) => {
      await allowResolution(page, auth.session.access_token);
      let mutations = 0;
      await page.route(tableEndpoint, (route) => route.fulfill({ json: [incident] }));
      await page.route(resolveEndpoint, async (route) => {
        mutations++;
        expect(route.request().postDataJSON()).toEqual({ p_incident_id: incident.id, p_remark: null });
        await route.fulfill(failure === 'staff-revoked'
          ? { status: 403, json: { code: '42501', message: 'Staff access required' } }
          : failure === 'missing-resolution-action'
            ? { status: 404, json: { code: 'PGRST202', message: 'Resolution action is not installed' } }
            : failure === 'server-error'
              ? { status: 500, json: { code: 'XX000', message: 'Resolution update failed' } }
              : failure === 'wrong-incident'
                ? { json: { ...incident, id: secondEpisode.id, status: 'RESOLVED', resolved_at: '2026-11-27T01:20:00Z', resolved_by: auth.session.user.id } }
                : { json: incident });
      });
      await page.goto('/alerts');
      await confirmResolution(page);
      const error = resolutionDialog(page).getByRole('alert');
      await expect(error).toBeVisible();
      if (failure === 'staff-revoked') await expect(error).toContainText('Staff access required');
      if (failure === 'missing-resolution-action') await expect(error).toContainText('Resolution action is not installed');
      if (failure === 'server-error') await expect(error).toContainText('Resolution update failed');
      await expect(row(page).getByText('Active', { exact: true })).toBeVisible();
      await expect(row(page).getByText('Resolved', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Alerts, 1 open', exact: true })).toBeVisible();
      expect(mutations).toBe(1);
    });
  }

  test('a failed resolution can be retried with its remark while other active alerts stay open', async ({ page, auth }) => {
    await allowResolution(page, auth.session.access_token);
    const remark = 'Repaired the signal connection.';
    const confirmed = {
      ...incident, status: 'RESOLVED', resolved_at: '2026-11-27T01:20:00Z',
      resolved_by: auth.session.user.id, resolution_remark: remark,
    };
    let records = [incident, secondEpisode];
    let mutations = 0;
    await page.route(tableEndpoint, async (route) => {
      expect(route.request().method()).toBe('GET');
      expect(new URL(route.request().url()).searchParams.has('status')).toBe(false);
      await route.fulfill({ json: records });
    });
    await page.route(resolveEndpoint, async (route) => {
      mutations++;
      expect(route.request().method()).toBe('POST');
      expect(route.request().headers().authorization === `Bearer ${auth.session.access_token}`).toBe(true);
      expect(route.request().postDataJSON()).toEqual({ p_incident_id: incident.id, p_remark: remark });
      if (mutations === 1) {
        await route.fulfill({ status: 500, json: { code: 'XX000', message: 'Resolution update failed' } });
      } else {
        records = [confirmed, secondEpisode];
        await route.fulfill({ json: confirmed });
      }
    });
    await page.goto('/alerts');
    await confirmResolution(page, incident.id, remark);
    const dialog = resolutionDialog(page);
    await expect(dialog.getByRole('alert')).toContainText('Resolution update failed');
    await expect(dialog.getByLabel('Remark (optional)', { exact: true })).toHaveValue(remark);
    await expect(page.getByRole('button', { name: 'Alerts, 2 open', exact: true })).toBeVisible();
    expect(mutations).toBe(1);
    await dialog.getByRole('button', { name: 'Mark as Resolved', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(row(page).getByText('Resolved', { exact: true })).toBeVisible();
    await expect(row(page)).toContainText(remark);
    await expect(row(page, secondEpisode.id).getByText('Active', { exact: true })).toBeVisible();
    await expect(history(page).locator('tbody tr')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Alerts, 1 open', exact: true })).toBeVisible();
    expect(mutations).toBe(2);
  });

  test('repeat detections update Last detected on one row and a new episode adds another while resolved history remains', async ({ page, auth, realtime }) => {
    await allowResolution(page, auth.session.access_token);
    const resolved = {
      ...incident, id: '9007199254740991', status: 'RESOLVED',
      detected_at: '2026-11-27T00:30:00Z', last_detected_at: '2026-11-27T00:35:00Z',
      resolved_at: '2026-11-27T00:50:00Z', resolved_by: auth.session.user.id,
    };
    let records = [incident, resolved];
    await page.route(tableEndpoint, (route) => route.fulfill({ json: records }));
    await page.goto('/alerts');
    await expect.poll(() => realtime.activeAlertCount).toBe(1);
    await expect(history(page).locator('tbody tr')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Alerts, 1 open', exact: true })).toBeVisible();
    const joins = realtime.alertJoins.length;
    const repeated = { ...incident, last_detected_at: '2026-11-27T01:10:00Z' };
    records = [repeated, resolved];
    realtime.change('tapflow_r1_alerts', 'UPDATE', repeated);
    realtime.change('tapflow_r1_alerts', 'UPDATE', repeated);
    await expect(row(page).getByText(/Last detected/)).toBeVisible();
    await expect(row(page).locator(`time[datetime="${repeated.last_detected_at}"]`)).toBeVisible();
    await expect(row(page).locator(`time[datetime="${incident.detected_at}"]`)).toBeVisible();
    await expect(history(page).locator('tbody tr')).toHaveCount(2);
    records = [secondEpisode, repeated, resolved];
    realtime.change('tapflow_r1_alerts', 'INSERT', secondEpisode);
    realtime.change('tapflow_r1_alerts', 'INSERT', secondEpisode);
    await expect(history(page).locator('tbody tr')).toHaveCount(3);
    await expect(row(page, secondEpisode.id)).toHaveCount(1);
    await expect(row(page, resolved.id).getByText('Resolved', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Alerts, 2 open', exact: true })).toBeVisible();
    expect(realtime.alertJoins).toHaveLength(joins);
  });
});
