import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useMatch } from 'react-router';
import { REFRESH_INTERVAL_MS } from '../overview/overview-telemetry';
import { readRoomTelemetry } from '../telemetry/telemetry-service';
import { subscribeToTelemetry } from '../telemetry/telemetry-realtime';
import { telemetryRooms } from '../telemetry/telemetry-types';
import type { TelemetryRoom } from '../telemetry/telemetry-types';
import { applyRoomTelemetryReport, createRoomTelemetry, pulseChartWindow } from './room-telemetry';
import type { PulseChartRange, RoomTelemetry } from './room-telemetry';

interface RoomTelemetryContextValue {
  room: TelemetryRoom | undefined;
  telemetry: RoomTelemetry;
  refreshing: boolean;
  now: number;
  chartRange: PulseChartRange;
  setChartRange: (range: PulseChartRange) => void;
}

const RoomTelemetryContext = createContext<RoomTelemetryContextValue | null>(null);

function SelectedRoomTelemetryProvider({ room, children }: {
  room: TelemetryRoom | undefined; children: ReactNode;
}) {
  const [telemetry, setTelemetry] = useState(createRoomTelemetry);
  const [refreshing, setRefreshing] = useState(Boolean(room));
  const [now, setNow] = useState(Date.now);
  const [chartRange, setChartRange] = useState<PulseChartRange>('30m');

  useEffect(() => {
    if (!room) return;
    const selectedRoom = room;
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
      const window = pulseChartWindow(chartRange, Date.now());
      try {
        const report = await readRoomTelemetry(selectedRoom, controller.signal, window);
        if (!controller.signal.aborted) setTelemetry((previous) => applyRoomTelemetryReport(previous, report, window));
      } catch {
        if (!controller.signal.aborted) setTelemetry((previous) => applyRoomTelemetryReport(previous, {
          status: 'blocked', checkedAt: new Date().toISOString(),
          error: { kind: 'network', code: 'REQUEST_FAILED', message: 'Could not refresh room telemetry.' },
        }, window));
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
    const unsubscribe = subscribeToTelemetry(() => void refresh(true), selectedRoom);
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => { controller.abort(); window.clearInterval(timer); unsubscribe(); };
  }, [room, chartRange]);

  return <RoomTelemetryContext value={{ room, telemetry, refreshing, now, chartRange, setChartRange }}>{children}</RoomTelemetryContext>;
}

export function RoomTelemetryProvider({ children }: { children: ReactNode }) {
  const match = useMatch('/rooms/:roomId');
  const room = match ? telemetryRooms.find((item) => item.id === match.params.roomId) : telemetryRooms[0];
  return <SelectedRoomTelemetryProvider key={room?.id ?? 'missing'} room={room}>{children}</SelectedRoomTelemetryProvider>;
}

export function useRoomTelemetry(): RoomTelemetryContextValue {
  const value = useContext(RoomTelemetryContext);
  if (!value) throw new Error('useRoomTelemetry requires RoomTelemetryProvider');
  return value;
}
