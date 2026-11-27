import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { readTelemetry } from '../telemetry/telemetry-service';
import { subscribeToTelemetry } from '../telemetry/telemetry-realtime';
import { getPhilippineDay } from './main-consumption';
import { applyTelemetryReport, createOverviewTelemetry, REFRESH_INTERVAL_MS } from './overview-telemetry';
import type { OverviewTelemetry } from './overview-telemetry';

interface OverviewContextValue {
  telemetry: OverviewTelemetry;
  refreshing: boolean;
  now: number;
}

const OverviewContext = createContext<OverviewContextValue | null>(null);

export function OverviewTelemetryProvider({ children }: { children: ReactNode }) {
  const [telemetry, setTelemetry] = useState(createOverviewTelemetry);
  const [refreshing, setRefreshing] = useState(true);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    let refreshQueued = false;
    async function refresh(queueIfPending = false) {
      if (controller.signal.aborted) return;
      setNow(Date.now());
      if (pending) {
        refreshQueued ||= queueIfPending;
        return;
      }
      pending = true;
      setRefreshing(true);
      try {
        const report = await readTelemetry(controller.signal, { includeMainConsumption: true });
        if (!controller.signal.aborted) setTelemetry((previous) => applyTelemetryReport(previous, report));
      } catch {
        if (!controller.signal.aborted) setTelemetry((previous) => applyTelemetryReport(previous, {
          status: 'blocked', checkedAt: new Date().toISOString(),
          error: { kind: 'network', code: 'REQUEST_FAILED', message: 'Could not refresh telemetry.' },
        }));
      } finally {
        pending = false;
        if (!controller.signal.aborted) {
          setNow(Date.now());
          if (refreshQueued) {
            refreshQueued = false;
            void refresh();
          } else setRefreshing(false);
        }
      }
    }
    const unsubscribe = subscribeToTelemetry(() => void refresh(true));
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    let rolloverTimer: number;
    function scheduleDayRollover() {
      const now = Date.now();
      rolloverTimer = window.setTimeout(() => {
        void refresh(true);
        scheduleDayRollover();
      }, getPhilippineDay(now).end - now);
    }
    scheduleDayRollover();
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.clearTimeout(rolloverTimer);
      unsubscribe();
    };
  }, []);

  return <OverviewContext value={{ telemetry, refreshing, now }}>{children}</OverviewContext>;
}

export function useOverviewTelemetry(): OverviewContextValue {
  const value = useContext(OverviewContext);
  if (!value) throw new Error('useOverviewTelemetry requires OverviewTelemetryProvider');
  return value;
}
