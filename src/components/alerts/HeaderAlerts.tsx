import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useDashboardState } from '../../features/dashboard/DashboardProvider';
import { formatAlertTimestamp, getAlertTargetLabel, orderAlertRecords } from '../../features/alerts/alert-model';
import type { AlertTarget } from '../../features/alerts/alert-model';
import { useOverviewTelemetry } from '../../features/overview/OverviewTelemetryProvider';
import { reportingFreshness } from '../../features/overview/overview-telemetry';
import type { LatestRecord } from '../../features/overview/overview-telemetry';
import { useRoomTelemetry } from '../../features/rooms/RoomTelemetryProvider';
import { latestRoomReading } from '../../features/rooms/room-telemetry';
import { telemetryRooms } from '../../features/telemetry/telemetry-types';
import type { FlowReading, RoomStatus } from '../../features/telemetry/telemetry-types';
import './HeaderAlerts.css';

// A failed or unknown snapshot cannot establish that telemetry is missing.
function hasNoRecentTelemetry(reading: LatestRecord<FlowReading>, now: number, status?: LatestRecord<RoomStatus>): boolean {
  if (!reading.loaded || reading.error || (status && (!status.loaded || status.error))) return false;
  return [reading.value?.received_at, status?.value?.timestamps.last_seen_at]
    .every((timestamp) => !timestamp || reportingFreshness(timestamp, now) === 'stale');
}

export function OverviewHeaderAlerts() {
  const { telemetry, now } = useOverviewTelemetry();
  return <HeaderAlerts noRecentTelemetry={(target) => {
    if (target.kind === 'main-inlet') return hasNoRecentTelemetry(telemetry.readings.main, now);
    const room = telemetryRooms.find(({ id }) => id === target.roomId);
    return Boolean(room && hasNoRecentTelemetry(telemetry.readings[room.deviceId], now, telemetry.rooms[room.statusId]));
  }} />;
}

export function RoomHeaderAlerts() {
  const { room, telemetry, now } = useRoomTelemetry();
  return <HeaderAlerts noRecentTelemetry={(target) => target.kind === 'room' && target.roomId === room?.id
    && hasNoRecentTelemetry(latestRoomReading(telemetry), now, telemetry.status)} />;
}

export function HeaderAlerts({ noRecentTelemetry }: { noRecentTelemetry?: (target: AlertTarget) => boolean }) {
  const { alertRecords, alerts, rooms, alertFeed } = useDashboardState();
  const location = useLocation();
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === location.key;
  const root = useRef<HTMLDivElement>(null);
  const bell = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const panelId = useId();
  const activeRecords = orderAlertRecords(alertRecords).filter(({ status }) => status === 'active');
  const count = alerts.length;
  const { loading, error } = alertFeed;
  const countLabel = loading ? 'loading' : error ? (count ? `${count} open, last known` : 'unavailable') : `${count} open`;

  useEffect(() => { setOpenAt(null); }, [location.key]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpenAt(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpenAt(null);
        bell.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    function positionPanel() {
      if (!bell.current || !panel.current) return;
      const bounds = bell.current.getBoundingClientRect();
      const width = Math.min(400, window.innerWidth - 24);
      const left = Math.max(12, Math.min(bounds.right - width, window.innerWidth - width - 12));
      const top = Math.max(12, Math.min(bounds.bottom + 10, window.innerHeight - 160));
      Object.assign(panel.current.style, {
        left: `${left}px`, top: `${top}px`, width: `${width}px`,
        maxHeight: `${window.innerHeight - top - 12}px`,
      });
    }
    positionPanel();
    window.addEventListener('resize', positionPanel);
    window.addEventListener('scroll', positionPanel, true);
    return () => {
      window.removeEventListener('resize', positionPanel);
      window.removeEventListener('scroll', positionPanel, true);
    };
  }, [open]);

  return <div className="header-alerts" ref={root}>
    <button className="header-alerts__bell" type="button" ref={bell}
      aria-label={`Alerts, ${countLabel}`} aria-expanded={open} aria-controls={panelId}
      onClick={() => setOpenAt(open ? null : location.key)}>
      <span className="header-alerts__icon" aria-hidden="true" />
      {count > 0 && <span className="header-alerts__count" aria-hidden="true">{count}</span>}
    </button>
    {open && <section className="header-alerts__panel" id={panelId} ref={panel} aria-label="Alerts preview">
      <header className="header-alerts__heading">
        <h2>Alerts</h2>
        {!loading && !error && <span className="header-alerts__pill">{count} open</span>}
      </header>
      <div className="header-alerts__body" aria-busy={loading}>
        {loading && <p className="header-alerts__notice" role="status">Loading alerts…</p>}
        {error && <div className="header-alerts__notice">
          <p role="alert">{error}{activeRecords.length > 0 && ' Showing last known alerts.'}</p>
          <button type="button" onClick={alertFeed.refreshAlerts}>Retry</button>
        </div>}
        {activeRecords.length > 0 ? <ul className="header-alerts__list">
          {activeRecords.map((record) => <li key={record.id}>
            <div className="header-alerts__row-heading">
              <h3>{record.title ?? record.detectionRule}</h3>
              <span className="header-alerts__pill">Open</span>
            </div>
            <p>{record.target.kind === 'main-inlet' ? 'Main inlet' : getAlertTargetLabel(record.target, rooms)}</p>
            <time dateTime={record.timestamp}>{formatAlertTimestamp(record.timestamp)} PHT</time>
            {noRecentTelemetry?.(record.target) && <p className="header-alerts__telemetry">No recent telemetry</p>}
          </li>)}
        </ul> : !loading && !error && <p className="header-alerts__notice" role="status">No open alerts</p>}
      </div>
      <footer className="header-alerts__footer">
        <Link to="/alerts" onClick={() => setOpenAt(null)}>View all alerts <span aria-hidden="true">→</span></Link>
      </footer>
    </section>}
  </div>;
}
