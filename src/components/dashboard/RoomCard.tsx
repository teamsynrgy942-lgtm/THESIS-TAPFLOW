import { Link } from 'react-router';
import type { FlowReading, RoomStatus } from '../../features/telemetry/telemetry-service';
import type { LatestRecord, overviewRooms } from '../../features/overview/overview-telemetry';
import { currentCommandLabel, flowActivityLabel, reportingFreshness, roomReportingLabel, roomReportingTime } from '../../features/overview/overview-telemetry';
import { StatusBadge } from './StatusBadge';
import './RoomCard.css';

export function RoomCard({ room, reading, status, now }: {
  room: typeof overviewRooms[number]; reading: LatestRecord<FlowReading>; status: LatestRecord<RoomStatus>; now: number;
}) {
  const titleId = `${room.id}-title`;
  const error = reading.error ?? status.error;
  const reportedAt = roomReportingTime(status.value, reading.value);
  const label = !reading.loaded || !status.loaded ? 'Loading…' : error && !reportedAt ? 'Refresh failed' : roomReportingLabel(status.value, reading.value, now);
  const flow = flowActivityLabel(reading, now);
  const tone = error ? 'warning' : reportingFreshness(reportedAt, now) === 'recent' ? 'success' : 'idle';

  return (
    <article className="room-card" aria-labelledby={titleId}>
      <header className="room-card__header">
        <span className="dashboard-symbol" aria-hidden="true">▥</span>
        <h3 id={titleId}>{room.name}</h3>
        <StatusBadge tone={tone}>{label}</StatusBadge>
      </header>
      <dl className="room-card__devices">
        <div><dt>Water flow</dt><dd>{reading.loaded ? flow : 'Loading…'}</dd></div>
        <div><dt>RFID session</dt><dd>{currentCommandLabel(status, 'rfid_active', now, 'Active', 'Inactive')}</dd></div>
        <div><dt>Valve command</dt><dd>{currentCommandLabel(status, 'valve_commanded_on', now, 'Open', 'Closed')}</dd></div>
        <div><dt>Light command</dt><dd>{currentCommandLabel(status, 'bulb_commanded_on', now, 'On', 'Off')}</dd></div>
      </dl>
      <footer className="room-card__footer">
        <Link className="dashboard-detail-link" to={`/rooms/${room.id}`} aria-label={`View ${room.name} details`}>
          View details <span aria-hidden="true">→</span>
        </Link>
      </footer>
    </article>
  );
}
