import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import type { AlertRecord } from './alert-model';
import { selectNewNotificationIds } from './alert-model';
import { readR1Alerts, R1AlertReadError } from './r1-alert-service';
import { subscribeToR1Alerts } from './r1-alert-realtime';
import type { R1DatabaseEvent, R1RealtimeState } from './r1-alert-realtime';

const FALLBACK_INTERVAL_MS = 15_000;
const RESTART_DELAY_MS = 5_000;

type ConnectionState = { status: 'connecting' } | R1RealtimeState;
type RefreshReason = R1DatabaseEvent | 'initial' | 'subscribed' | 'outage' | 'poll'
  | 'focus' | 'visible' | 'online' | 'navigation' | 'manual';

interface AlertSnapshot {
  records: readonly AlertRecord[];
  loading: boolean;
  error: string | null;
}

/** One feed per signed-in dashboard. Events trigger authoritative, serialized reads. */
export function useR1AlertFeed() {
  const { pathname } = useLocation();
  const previousPathname = useRef(pathname);
  const [snapshot, setSnapshot] = useState<AlertSnapshot>({ records: [], loading: true, error: null });
  const [connection, setConnection] = useState<ConnectionState>({ status: 'connecting' });
  const [notifications, setNotifications] = useState<string[]>([]);
  const refreshRef = useRef<(reason: RefreshReason) => void>(() => {});
  const refreshAlerts = useCallback(() => refreshRef.current('manual'), []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const knownIds = new Set<string>();
    const insertedIds = new Set<string>();
    const notifiedIds = new Set<string>();
    let hasSnapshot = false;
    let pending = false;
    let queuedReason: RefreshReason | null = null;
    let invalidationVersion = 0;
    let connectionStatus: ConnectionState['status'] = 'connecting';
    let unsubscribe: (() => void) | undefined;
    let restartTimer: number | undefined;

    async function refresh(reason: RefreshReason) {
      if (signal.aborted) return;
      // A newer event/navigation invalidates an in-flight snapshot. Poll ticks
      // alone must not starve a slow read by continuously invalidating it.
      if (reason !== 'poll') invalidationVersion++;
      if (pending) {
        queuedReason = reason;
        if (import.meta.env.DEV) console.debug('[TapFlow R1] Refresh queued', { reason, refreshTriggered: true });
        return;
      }
      pending = true;
      const readVersion = invalidationVersion;
      if (import.meta.env.DEV) console.debug('[TapFlow R1] Refresh started', { reason, refreshTriggered: true });
      const reportedInserts = new Set(insertedIds);
      try {
        const records = await readR1Alerts(signal);
        if (signal.aborted) return;
        if (readVersion !== invalidationVersion) {
          if (import.meta.env.DEV) console.debug('[TapFlow R1] Stale refresh discarded', { reason });
          return;
        }
        const active = records.filter((record) => record.status === 'active');
        const activeIds = new Set(active.map((record) => record.id));
        const newIds = selectNewNotificationIds(records, knownIds, notifiedIds, insertedIds, hasSnapshot);
        for (const id of newIds) notifiedIds.add(id);
        for (const record of records) knownIds.add(record.id);
        for (const id of reportedInserts) insertedIds.delete(id);
        hasSnapshot = true;
        setSnapshot({ records, loading: false, error: null });
        setNotifications((current) => [...new Set([...current.filter((id) => activeIds.has(id)), ...newIds])]);
        if (import.meta.env.DEV) console.debug('[TapFlow R1] Refresh applied', {
          reason, records: records.length, active: active.length,
        });
      } catch (error) {
        if (signal.aborted || readVersion !== invalidationVersion) return;
        const denied = error instanceof R1AlertReadError && error.accessDenied;
        if (denied) {
          insertedIds.clear();
          knownIds.clear();
          hasSnapshot = false;
          setNotifications([]);
        }
        const message = error instanceof R1AlertReadError ? error.message : 'Alert records could not be loaded.';
        setSnapshot((previous) => ({ records: denied ? [] : previous.records, loading: false, error: message }));
        if (import.meta.env.DEV) console.debug('[TapFlow R1] Refresh failed', { reason, accessDenied: denied });
      } finally {
        pending = false;
        if (queuedReason && !signal.aborted) {
          const nextReason = queuedReason;
          queuedReason = null;
          void refresh(nextReason);
        }
      }
    }

    function connect() {
      if (signal.aborted) return;
      unsubscribe = subscribeToR1Alerts((insertedId, event) => {
        if (signal.aborted) return;
        if (insertedId && !notifiedIds.has(insertedId)) insertedIds.add(insertedId);
        void refresh(event);
      }, (status) => {
        if (signal.aborted) return;
        const wasUnavailable = connectionStatus === 'unavailable';
        connectionStatus = status.status;
        setConnection(status);
        if (status.status === 'live') {
          window.clearTimeout(restartTimer);
          restartTimer = undefined;
          void refresh('subscribed');
        } else if (!wasUnavailable) {
          // Catch up once at the start of an outage, then let the polling interval take over.
          void refresh('outage');
        }
        const recoverable = status.status === 'unavailable'
          && (status.reason === 'closed' || status.reason === 'timeout' || status.reason === 'channel');
        if (recoverable && restartTimer === undefined) {
          restartTimer = window.setTimeout(() => {
            restartTimer = undefined;
            unsubscribe?.();
            connect();
          }, RESTART_DELAY_MS);
        }
      });
    }

    refreshRef.current = (reason) => { void refresh(reason); };
    // React's development effect replay cleans up the first setup before it joins.
    queueMicrotask(() => {
      if (signal.aborted) return;
      connect();
      void refresh('initial');
    });
    // A joined socket does not prove this account is receiving table events.
    // Reconcile even after a successful empty read or a silently missed event.
    const poll = window.setInterval(() => { void refresh('poll'); }, FALLBACK_INTERVAL_MS);
    function onFocus() {
      if (document.visibilityState === 'visible') void refresh('focus');
    }
    function onVisible() {
      if (document.visibilityState === 'visible') void refresh('visible');
    }
    function onOnline() { void refresh('online'); }
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      controller.abort();
      refreshRef.current = () => {};
      window.clearInterval(poll);
      window.clearTimeout(restartTimer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    refreshRef.current('navigation');
  }, [pathname]);

  const notification = snapshot.records.find(({ id }) => id === notifications.at(-1));
  return {
    ...snapshot,
    connection,
    notification,
    notificationCount: notifications.length,
    dismissNotification: () => setNotifications((current) => current.slice(0, -1)),
    refreshAlerts,
  };
}
