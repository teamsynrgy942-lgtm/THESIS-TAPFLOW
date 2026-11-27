import { supabase } from '/src/lib/supabase.ts';
import { describeSupabaseError } from '/src/lib/supabase-error.ts';
import { parseR1Alert, parseR1AlertId, R1_ALERT_CODE, R1_ALERT_TABLE } from '/src/features/alerts/r1-alert-model.ts';
import { R1_ALERT_SELECT, r1ProjectHost, verifyR1Session } from '/src/features/alerts/r1-alert-service.ts';
import { subscribeToR1Alerts } from '/src/features/alerts/r1-alert-realtime.ts';

function assertDevelopment() {
  if (!import.meta.env.DEV) throw new Error('This check is only available in the development server.');
}

function safeError(error) {
  return describeSupabaseError(error, [import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY]);
}

/** Run in the existing signed-in Vite tab. IDs identify real rows to check, never substitute data. */
export async function checkR1Session(expectedIds = ['1', '3']) {
  assertDevelopment();
  if (!Array.isArray(expectedIds) || !expectedIds.length || expectedIds.some((id) => !parseR1AlertId(id))) {
    throw new Error('Provide the positive integer alert IDs to verify.');
  }
  expectedIds = expectedIds.map(String);
  let session;
  try {
    session = await verifyR1Session();
  } catch (error) {
    return { projectHost: r1ProjectHost, auth: { verified: false, error: error.diagnostics ?? safeError(error) }, select: null };
  }
  const auth = {
    verified: true,
    uid: session.userId,
    role: session.role,
    authUserRole: session.authUserRole,
    tokenIssuerHost: session.tokenIssuerHost,
    expiresAt: session.expiresAt,
    isAnonymous: session.isAnonymous,
  };

  // Run the dashboard's exact first-page query and a separate targeted SELECT.
  // The latter finds older IDs even if history exceeds the API page size.
  const base = () => supabase.schema('public').from(R1_ALERT_TABLE)
    .select(R1_ALERT_SELECT, { count: 'exact' }).eq('code', R1_ALERT_CODE)
    .order('detected_at', { ascending: false }).order('id', { ascending: false });
  const [history, expected] = await Promise.all([
    base().range(0, 999).retry(false).abortSignal(AbortSignal.timeout(15_000)),
    base().in('id', expectedIds).retry(false).abortSignal(AbortSignal.timeout(15_000)),
  ]);
  const screenIds = new Set([...document.querySelectorAll('.alert-history__table tbody tr[data-alert-id]')]
    .map((element) => element.dataset.alertId));
  const rows = Array.isArray(expected.data) ? expected.data : [];
  return {
    projectHost: r1ProjectHost,
    auth,
    select: {
      schema: 'public', table: R1_ALERT_TABLE, codeFilter: R1_ALERT_CODE, statusFilter: null,
      httpStatus: history.status,
      error: history.error ? safeError(history.error) : null,
      visibleCount: history.count,
      firstPageRows: Array.isArray(history.data) ? history.data.length : null,
    },
    expectedRecords: {
      httpStatus: expected.status,
      error: expected.error ? safeError(expected.error) : null,
      records: expectedIds.map((id) => {
        const row = rows.find((item) => String(item.id) === id);
        const alert = parseR1Alert(row);
        return {
          id, visibleToSession: Boolean(row), acceptedByFrontend: Boolean(alert), renderedInAlerts: screenIds.has(id),
          status: alert?.status ?? null, detectedAt: alert?.timestamp ?? null, resolvedAt: alert?.resolvedAt ?? null,
        };
      }),
      allVisibleAndRendered: expectedIds.every((id) => rows.some((row) => String(row.id) === id && parseR1Alert(row)) && screenIds.has(id)),
    },
  };
}

/** Observe real INSERT/UPDATE/DELETE traffic without creating or updating any records. */
export async function watchR1Realtime(durationMs = 15_000) {
  assertDevelopment();
  if (!Number.isFinite(durationMs) || durationMs < 1000 || durationMs > 60_000) {
    throw new Error('Observation duration must be between 1000 and 60000 milliseconds.');
  }
  const session = await verifyR1Session();
  const states = [];
  const changes = [];
  const stop = subscribeToR1Alerts((insertedId, event) => {
    changes.push({ event, id: insertedId, observedAt: new Date().toISOString() });
  }, (state) => states.push({ ...state, observedAt: new Date().toISOString() }));
  try {
    await new Promise((resolve) => window.setTimeout(resolve, durationMs));
    return {
      projectHost: r1ProjectHost, uid: session.userId, role: session.role, states, changes,
      note: 'A live channel alone does not prove event delivery. No observed changes can mean no backend event occurred during this window.',
    };
  } finally {
    stop();
  }
}
