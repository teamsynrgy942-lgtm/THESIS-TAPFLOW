import { randomUUID } from 'node:crypto';
import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Session } from '@supabase/supabase-js';
import { mockRealtime } from './realtime';
import type { MockRealtime } from './realtime';

interface MockAuth {
  email: string;
  password: string;
  session: Session;
  signInError: { code: string; status: number } | null;
  logoutFails: boolean;
  refreshFails: boolean;
  delayMs: number;
  signIn: (page: Page) => Promise<void>;
}

export const test = base.extend<{ authenticated: boolean; auth: MockAuth; realtimeEnabled: boolean; realtime: MockRealtime }>({
  authenticated: [true, { option: true }],
  realtimeEnabled: [false, { option: true }],
  realtime: async ({ context, realtimeEnabled }, use) => {
    await use(await mockRealtime(context, realtimeEnabled));
  },
  auth: [async ({ page, context, authenticated, realtime: _realtime }, use) => {
    // Generated, synthetic credentials and tokens; all Auth requests stay in Playwright.
    const email = `${randomUUID()}@example.test`;
    const password = randomUUID();
    const userId = randomUUID();
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const session: Session = {
      access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, aud: 'authenticated', role: 'authenticated', exp: expiresAt })}.${encode('test-only')}`,
      refresh_token: randomUUID(),
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: expiresAt,
      user: { id: userId, email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
    };
    const auth: MockAuth = {
      email, password, session, signInError: null, logoutFails: false, refreshFails: false, delayMs: 0,
      async signIn(target) {
        await target.getByLabel('Email', { exact: true }).fill(email);
        await target.getByLabel('Password', { exact: true }).fill(password);
        await target.getByRole('button', { name: 'Sign In', exact: true }).click();
      },
    };

    await context.route('**/auth/v1/**', async (route) => {
      const url = new URL(route.request().url());
      if (auth.delayMs) await new Promise((resolve) => setTimeout(resolve, auth.delayMs));
      if (url.pathname.endsWith('/token')) {
        const isRefresh = url.searchParams.get('grant_type') === 'refresh_token';
        const failure = isRefresh
          ? auth.refreshFails ? { code: 'refresh_token_not_found', status: 400 } : null
          : auth.signInError;
        if (failure) {
          await route.fulfill({ status: failure.status, json: { code: failure.code, error_code: failure.code, msg: 'Authentication failed' } });
        } else {
          if (!isRefresh) expect(route.request().postDataJSON()).toMatchObject({ email, password });
          await route.fulfill({ json: session });
        }
      } else if (url.pathname.endsWith('/logout')) {
        expect(url.searchParams.get('scope')).toBe('local');
        await route.fulfill(auth.logoutFails
          ? { status: 500, json: { msg: 'Logout unavailable' } }
          : { status: 204, body: '' });
      } else if (url.pathname.endsWith('/user')) {
        await route.fulfill({ json: session.user });
      } else {
        await route.abort();
        throw new Error(`Unexpected Auth endpoint: ${url.pathname}`);
      }
    });

    // Page routes take priority over test-specific context mocks for sensor telemetry.
    await page.route('**/rest/v1/tapflow_r1_alerts*', async (route) => {
      expect(route.request().method()).toBe('GET');
      await route.fulfill({ json: [] });
    });

    // Overview, Room Details, and any secondary tabs keep their reads local.
    await context.route('**/rest/v1/', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({ json: { paths: {} } });
    });
    await context.route('**/rest/v1/**', async (route) => {
      expect(route.request().method()).toBe('GET');
      const url = new URL(route.request().url());
      const upperBound = url.searchParams.getAll('received_at').find((filter) => filter.startsWith('lte.'))?.slice(4);
      const receivedAt = new Date((upperBound ? Date.parse(upperBound) : Date.now()) - 1000).toISOString();
      if (url.pathname.endsWith('/flow_readings')) {
        const device = url.searchParams.get('device_id')?.slice(3);
        const pulses = device === 'main' ? 120 : Number(device?.slice(-1)) * 10;
        await route.fulfill({ json: [{ id: pulses, device_id: device, pulses, sample_ms: 15000, flow_lpm: null, received_at: receivedAt }] });
      } else if (url.pathname.endsWith('/room_status')) {
        const selectedIds = url.searchParams.get('room_id')?.match(/\d+/g)?.map(Number) ?? [1, 2, 3];
        await route.fulfill({ json: selectedIds.map((room_id) => ({
          room_id, rfid_active: room_id === 1, valve_commanded_on: room_id === 2,
          bulb_commanded_on: room_id === 3, last_seen_at: receivedAt,
        })) });
      } else if (url.pathname.endsWith('/tapflow_r1_alerts')) {
        await route.fulfill({ json: [] });
      } else if (url.pathname === '/rest/v1' || url.pathname === '/rest/v1/') {
        await route.fulfill({ json: { paths: {} } });
      } else {
        await route.abort();
        throw new Error('Unexpected telemetry table');
      }
    });

    if (authenticated) {
      await page.goto('/');
      await auth.signIn(page);
      await expect(page).toHaveURL('/overview');
      await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
      await expect(page.locator('.overview-check-time')).toContainText('Last checked');
    }
    await use(auth);
  }, { auto: true }],
});

export { expect };
