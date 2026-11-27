import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures/auth';

test('telemetry diagnostic route and code are unavailable in production', async ({ page, context }) => {
  let telemetryRequests = 0;
  await context.route('**/rest/v1/**', async (route) => { telemetryRequests++; await route.abort(); });
  await page.goto('/dev/telemetry');
  await expect(page.getByRole('heading', { name: 'Page not found', exact: true })).toBeVisible();
  expect(telemetryRequests).toBe(0);
  const assets = join(process.cwd(), 'dist', 'assets');
  const bundle = readdirSync(assets).filter((file) => /\.(js|css)$/.test(file))
    .map((file) => readFileSync(join(assets, file), 'utf8')).join('\n');
  // Assert booleans only: never dump the built bundle or its environment configuration.
  for (const text of ['Telemetry diagnostics', 'telemetry-page']) {
    expect(bundle.includes(text), `Production contains diagnostic marker: ${text}`).toBe(false);
  }
});
