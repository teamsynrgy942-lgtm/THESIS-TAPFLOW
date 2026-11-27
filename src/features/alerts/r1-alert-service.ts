import { supabase } from '../../lib/supabase';
import { describeSupabaseError } from '../../lib/supabase-error';
import type { AlertRecord } from './alert-model';
import { parseR1Alert, R1_ALERT_CODE, R1_ALERT_TABLE } from './r1-alert-model';

const PAGE_SIZE = 1000;
const AUTH_TIMEOUT_MS = 15_000;
export const R1_LEGACY_ALERT_SELECT = 'id::text, detected_at, room_id, code, status, evidence, resolved_at';
export const R1_ALERT_SELECT = `${R1_LEGACY_ALERT_SELECT}, last_detected_at, resolved_by, resolution_remark`;
export const r1ProjectHost = new URL(import.meta.env.VITE_SUPABASE_URL).hostname;

export interface R1SessionInfo {
  userId: string;
  role: string;
  authUserRole: string | undefined;
  tokenIssuerHost: string | null;
  expiresAt: number | undefined;
  isAnonymous: boolean;
}

let lastEmptyAccount: string | undefined;

export class R1AlertReadError extends Error {
  constructor(message: string, readonly accessDenied = false,
    readonly diagnostics?: ReturnType<typeof describeSupabaseError> & { httpStatus: number }) {
    super(message);
  }
}

/** Auth requests have no AbortSignal option; stop awaiting them on timeout or unmount. */
function awaitAuth<T>(request: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    // Attach both handlers even after cancellation so a late Auth failure is handled.
    request.then((value) => {
      signal.removeEventListener('abort', abort);
      resolve(value);
    }, (error: unknown) => {
      signal.removeEventListener('abort', abort);
      reject(error);
    });
  });
}

function readFailure(status: number, error: unknown, phase: 'auth' | 'select', session?: R1SessionInfo): R1AlertReadError {
  const diagnostics = {
    httpStatus: status,
    ...describeSupabaseError(error, [import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY]),
  };
  console.error(`[TapFlow R1] ${phase} failed`, {
    projectHost: r1ProjectHost, schema: 'public', table: R1_ALERT_TABLE, ...session, ...diagnostics,
  });
  const { code } = diagnostics;
  const suffix = ` (${[status ? `HTTP ${status}` : null, code].filter(Boolean).join(', ') || 'request failed'}).`;
  const failure = (message: string, denied = false) => new R1AlertReadError(message + suffix, denied, diagnostics);
  if (phase === 'auth') {
    const denied = status === 400 || status === 401 || status === 403 || code === 'AUTH_REQUIRED';
    return denied
      ? failure('Your Supabase session could not be verified. Sign in again to read the alert log', true)
      : failure('Could not verify your Supabase session. Check your connection and try again');
  }
  if (status === 401 || code === 'PGRST301' || code === 'PGRST303') {
    return failure('Your Supabase session could not be verified. Sign in again to read the alert log', true);
  }
  if (status === 403 || code === '42501') {
    return failure('Your account cannot read the alert log. Ask a project administrator to check its access', true);
  }
  if (status === 404 || code === '42P01' || code === '42703' || code === 'PGRST205' || code === 'PGRST106') {
    return failure('The R1 alert table or its fields could not be found. Check the configured Supabase project and table');
  }
  if (status === 0) {
    return failure('Could not reach Supabase to load the alert log. Check your connection and try again');
  }
  return failure('Alert records could not be loaded');
}

/** Check the same stored session used by the shared dashboard client against Auth. Never return tokens. */
export async function verifyR1Session(signal?: AbortSignal): Promise<R1SessionInfo> {
  const deadline = new AbortController();
  const timeout = setTimeout(() => {
    deadline.abort(new DOMException('Supabase session verification timed out.', 'TimeoutError'));
  }, AUTH_TIMEOUT_MS);
  const verificationSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  try {
    verificationSignal.throwIfAborted();
    const { data: { session }, error: sessionError } = await awaitAuth(supabase.auth.getSession(), verificationSignal);
    verificationSignal.throwIfAborted();
    if (sessionError) throw sessionError;
    if (!session) throw { code: 'AUTH_REQUIRED', message: 'No signed-in Supabase session was found.' };
    const [{ data: { user }, error }, { data: tokenData, error: claimsError }] = await awaitAuth(Promise.all([
      supabase.auth.getUser(session.access_token),
      supabase.auth.getClaims(session.access_token),
    ]), verificationSignal);
    verificationSignal.throwIfAborted();
    if (error) throw error;
    if (claimsError) throw claimsError;
    const claims = tokenData?.claims;
    if (!user || user.id !== session.user.id || claims?.sub !== user.id || typeof claims.role !== 'string') {
      throw { code: 'AUTH_REQUIRED', message: 'The restored session does not match the verified Supabase user.' };
    }
    let tokenIssuerHost: string | null = null;
    try { tokenIssuerHost = new URL(claims.iss).hostname; } catch { /* An absent issuer is reported as unknown. */ }
    return {
      userId: user.id, role: claims.role, authUserRole: user.role, tokenIssuerHost,
      expiresAt: claims.exp, isAnonymous: user.is_anonymous === true,
    };
  } catch (error) {
    signal?.throwIfAborted();
    const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : 0;
    throw readFailure(status, error, 'auth');
  } finally {
    clearTimeout(timeout);
  }
}

/** Read both active and resolved alerts using the shared client's signed-in session. */
export async function readR1Alerts(signal: AbortSignal): Promise<AlertRecord[]> {
  const session = await verifyR1Session(signal);
  const records = new Map<string, AlertRecord>();
  let offset = 0;
  let expectedCount: number | null = null;
  let columns = R1_ALERT_SELECT;

  for (;;) {
    signal.throwIfAborted();
    const { data, error, status, count } = await Promise.resolve(supabase.schema('public').from(R1_ALERT_TABLE)
      .select(columns, offset === 0 ? { count: 'exact' } : {})
      .eq('code', R1_ALERT_CODE)
      .order('detected_at', { ascending: false }).order('id', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)
      .retry(false)
      .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(15_000)])))
      .catch((error: unknown) => {
        signal.throwIfAborted();
        throw readFailure(0, error, 'select', session);
      });
    signal.throwIfAborted();

    // Optional audit fields may be installed separately from detector lifecycle work.
    // Drop only an explicitly missing field; access errors never permit a fallback.
    const missingField = error?.message.match(/\b(last_detected_at|resolved_by|resolution_remark)\b/)?.[1];
    if (offset === 0 && error && missingField
      && ['42703', 'PGRST204'].includes(error.code)
      && columns.split(', ').includes(missingField)) {
      columns = columns.split(', ').filter((column) => column !== missingField).join(', ');
      continue;
    }

    if (error || status < 200 || status >= 300) throw readFailure(status, error, 'select', session);
    if (!Array.isArray(data)) {
      throw new R1AlertReadError('Supabase returned an unreadable alert response.');
    }
    if (count != null) {
      if (!Number.isSafeInteger(count) || count < data.length) {
        throw new R1AlertReadError('Supabase returned an inconsistent alert record count.');
      }
      expectedCount = count;
    }
    if (offset === 0 && !data.length && lastEmptyAccount !== session.userId) {
      lastEmptyAccount = session.userId;
      console.warn('[TapFlow R1] No rows visible to the verified session', {
        projectHost: r1ProjectHost, ...session, httpStatus: status, visibleCount: count,
        schema: 'public', table: R1_ALERT_TABLE, code: R1_ALERT_CODE,
        statusFilter: null,
        explanation: 'An empty SELECT cannot distinguish missing records from RLS filtering. Compare the project and Auth UID with the SQL review.',
      });
    } else if (data.length) lastEmptyAccount = undefined;
    if (!data.length) {
      if (expectedCount != null && records.size < expectedCount) {
        throw new R1AlertReadError('The entire alert log could not be loaded.');
      }
      return [...records.values()];
    }

    const previousSize = records.size;
    for (const row of data) {
      const alert = parseR1Alert(row);
      if (!alert) throw new R1AlertReadError('The alert log returned an unreadable record.');
      records.set(alert.id, alert);
    }
    if (records.size === previousSize) {
      throw new R1AlertReadError('The entire alert log could not be loaded.');
    }
    offset += data.length;
    if (expectedCount != null && records.size >= expectedCount) return [...records.values()];
    if (expectedCount == null && data.length < PAGE_SIZE) return [...records.values()];
  }
}
