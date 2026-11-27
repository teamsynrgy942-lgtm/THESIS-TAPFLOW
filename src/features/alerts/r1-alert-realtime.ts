import { supabase } from '../../lib/supabase';
import { describeSupabaseError } from '../../lib/supabase-error';
import { parseR1AlertId, R1_ALERT_TABLE } from './r1-alert-model';

type UnavailableReason = 'publication' | 'access' | 'timeout' | 'channel' | 'closed';

export type R1RealtimeState =
  | { status: 'live' }
  | { status: 'unavailable'; reason: UnavailableReason };

export type R1DatabaseEvent = 'INSERT' | 'UPDATE' | 'DELETE';

const channelNamespace = Math.random().toString(36).slice(2);
let channelSequence = 0;

function unavailableReason(message: unknown): UnavailableReason {
  if (typeof message !== 'string') return 'channel';
  if (/\b(?:Unauthorized|PrivateOnly|MalformedJWT|InvalidJWTToken|InvalidJWTExpiration|JwtSignatureError|JwtSignerError)\b|permission denied|no longer have permission|token has expired/i.test(message)) {
    return 'access';
  }
  // Registration can fail for several configuration reasons. This guides the
  // operator to check the publication and does not establish what is deployed.
  if (/\bRealtimeDisabledForConfiguration\b|not (?:part of|in|included in|registered in) (?:the )?(?:\w+ )?publication/i.test(message)) {
    return 'publication';
  }
  if (/\b(?:PostgresChangesSubscribeTimeout|ReplicationConnectionTimeout|TimeoutOnRpcCall)\b|\btimed out\b/i.test(message)) {
    return 'timeout';
  }
  return 'channel';
}

export function subscribeToR1Alerts(
  onChange: (insertedId: string | null, event: R1DatabaseEvent) => void,
  onStatus: (state: R1RealtimeState) => void,
): () => void {
  let active = true;
  let lastStatus: 'live' | UnavailableReason | undefined;
  let postgresChangesFailed = false;
  let channel: ReturnType<typeof supabase.channel> | undefined;

  function report(state: R1RealtimeState, error?: unknown) {
    const status = state.status === 'live' ? 'live' : state.reason;
    // Postgres can resubscribe on an open socket without an intervening error.
    // Every successful subscription must trigger a catch-up read.
    if (!active || (status === lastStatus && status !== 'live')) return;
    lastStatus = status;
    if (import.meta.env.DEV && state.status === 'unavailable') {
      console.warn('[TapFlow R1] Realtime unavailable', {
        projectHost: new URL(import.meta.env.VITE_SUPABASE_URL).hostname,
        schema: 'public', table: R1_ALERT_TABLE, reason: state.reason,
        ...describeSupabaseError(error, [import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY]),
      });
    }
    onStatus(state);
  }

  function handleSystemMessage(payload: unknown) {
    if (!active || typeof payload !== 'object' || payload === null) return;
    const { extension, status, message } = payload as Record<string, unknown>;
    if (extension !== 'postgres_changes') return;
    if (import.meta.env.DEV) {
      console.debug('[TapFlow R1] Postgres subscription', {
        status: status === 'ok' || status === 'error' || status === 'timeout' ? status : 'unknown',
        ...describeSupabaseError({ message }, [import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY]),
      });
    }

    // Some server versions acknowledge the channel before setting up its
    // Postgres Changes subscription. An error here can leave the socket open.
    if (status === 'error' || status === 'timeout') {
      postgresChangesFailed = true;
      report({ status: 'unavailable', reason: status === 'timeout' ? 'timeout' : unavailableReason(message) }, { message });
    } else if (status === 'ok' && message === 'Subscribed to PostgreSQL') {
      postgresChangesFailed = false;
      report({ status: 'live' });
    }
  }

  function stop() {
    if (!active) return;
    active = false;
    if (import.meta.env.DEV) console.debug('[TapFlow R1] Subscription cleanup');
    const current = channel;
    if (!current) return;
    void supabase.removeChannel(current).then((status) => {
      if (status !== 'ok') current.teardown();
    }).catch(() => current.teardown());
  }

  function changed(event: R1DatabaseEvent, insertedId: string | null = null) {
    if (!active) return;
    // Payloads only invalidate the authenticated snapshot; never log row data.
    if (import.meta.env.DEV) console.debug('[TapFlow R1] Database event', { event, refreshTriggered: true });
    onChange(insertedId, event);
  }

  try {
    channel = supabase.channel(`tapflow-r1-alerts-${channelNamespace}-${++channelSequence}`, {
      config: { postgres_changes_options: { wait: true } },
    });
    channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: R1_ALERT_TABLE }, (payload) => {
        changed('INSERT', parseR1AlertId(payload.new.id));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: R1_ALERT_TABLE }, () => {
        changed('UPDATE');
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: R1_ALERT_TABLE }, () => {
        changed('DELETE');
      })
      .on('system', {}, handleSystemMessage)
      .subscribe((status, error) => {
        if (!active) return;
        if (import.meta.env.DEV) {
          console.debug(`[TapFlow R1] ${status}`, error
            ? describeSupabaseError(error, [import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY]) : {});
        }
        if (status === 'SUBSCRIBED') {
          if (!postgresChangesFailed) report({ status: 'live' });
          return;
        }
        // The SDK can rejoin after a transport failure. Its next join describes
        // a new attempt, so a Postgres error from the previous join is stale.
        postgresChangesFailed = false;
        const reason = status === 'CLOSED' ? 'closed'
          : status === 'TIMED_OUT' ? 'timeout' : unavailableReason(error?.message);
        report({ status: 'unavailable', reason }, error);
      });
  } catch (error) {
    report({ status: 'unavailable', reason: 'closed' }, error);
    stop();
  }
  return stop;
}
