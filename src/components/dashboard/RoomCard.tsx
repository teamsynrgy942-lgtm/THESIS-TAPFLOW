import { Link } from 'react-router';
import type { FlowReading, RoomStatus } from '../../features/telemetry/telemetry-service';
import type { LatestRecord, overviewRooms } from '../../features/overview/overview-telemetry';
import { currentCommandLabel, flowActivityLabel, formatTelemetryTime, presenceTone, roomPresenceLabel, roomReportingTime } from '../../features/overview/overview-telemetry';
import { StatusBadge } from './StatusBadge';
import './RoomCard.css';

export function RoomCard({ room, reading, status, now }: {
  room: typeof overviewRooms[number]; reading: LatestRecord<FlowReading>; status: LatestRecord<RoomStatus>; now: number;
}) {
  const titleId = `${room.id}-title`;
  const error = reading.error ?? status.error;
  const reportedAt = roomReportingTime(status.value, reading.value);
  const label = roomPresenceLabel(status, reading, now);
  const flow = flowActivityLabel(reading, now);
  const tone = label === 'Refresh failed' || error ? 'warning' : presenceTone(label);

  return (
    <article className={`room-card room-card--${label === 'Missing Data' ? 'missing' : label === 'Loading…' || label === 'Refresh failed' ? 'unknown' : label.toLowerCase()}`} aria-labelledby={titleId}>
      <header className="room-card__header">
        <span className="dashboard-symbol" aria-hidden="true">▥</span>
        <h3 id={titleId}>{room.name}</h3>
        <StatusBadge tone={tone}>{label}</StatusBadge>
      </header>
      <dl className="room-card__devices">
        <div><dt>Water flow</dt><dd>{reading.loaded ? flow : 'Loading…'}</dd></div>
        <div><dt>RFID session</dt><dd>{currentCommandLabel(status, 'rfid_active', now, 'Active', 'Inactive')}</dd></div>
        <div><dt>Valve command</dt><dd>{currentCommandLabel(status, 'valve_commanded_on', now, 'ON', 'OFF')}</dd></div>
        <div><dt>Light command</dt><dd>{currentCommandLabel(status, 'bulb_commanded_on', now, 'ON', 'OFF')}</dd></div>
      </dl>
      <footer className="room-card__footer">
        <p className="room-card__report">{reportedAt
          ? <><span>Last report</span> <time dateTime={reportedAt}>{formatTelemetryTime(reportedAt)}</time></>
          : <span>No report yet</span>}</p>
        <Link className="dashboard-detail-link" to={`/rooms/${room.id}`} aria-label={`View ${room.name} details`}>
          View details <span aria-hidden="true">→</span>
        </Link>
      </footer>
    </article>
  );
}
