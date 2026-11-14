import { Link } from 'react-router';
import { formatVolume } from '../../features/dashboard/dashboard-model';
import type { Room } from '../../features/dashboard/dashboard-model';
import { StatusBadge } from './StatusBadge';
import './RoomCard.css';

const statusLabels = { idle: 'Idle', active: 'Active', alert: 'Alert', offline: 'Offline' } as const;
const statusTones = { idle: 'idle', active: 'success', alert: 'warning', offline: 'offline' } as const;
const sessionLabels = { inactive: 'Inactive', active: 'Active' } as const;
const valveLabels = { closed: 'Closed', open: 'Open' } as const;
const lightLabels = { off: 'Off', on: 'On' } as const;

export function RoomCard({ room, showDetailsLink = true }: { room: Room; showDetailsLink?: boolean }) {
  const titleId = `${room.id}-title`;

  return (
    <article className="room-card" aria-labelledby={titleId}>
      <header className="room-card__header">
        <span className="dashboard-symbol" aria-hidden="true">▥</span>
        <h3 id={titleId}>{room.name}</h3>
        <StatusBadge tone={statusTones[room.status]}>{statusLabels[room.status]}</StatusBadge>
      </header>
      <div className="room-card__metrics" aria-live="polite" aria-atomic="true">
        <div className="room-card__flow">
          <span className="metric-label">Current flow</span>
          <p className="room-card__flow-value">
            <strong>{room.currentFlow.toFixed(2)}</strong><span>L/min</span>
          </p>
        </div>
        <div className="room-card__usage">
          <span className="metric-label">Used today</span>
          <strong>{formatVolume(room.usedToday)} L</strong>
        </div>
      </div>
      <dl className="room-card__devices">
        <div><dt>RFID session</dt><dd>{sessionLabels[room.rfidSession]}</dd></div>
        <div><dt>Valve command</dt><dd>{valveLabels[room.valveCommand]}</dd></div>
        <div><dt>Light command</dt><dd>{lightLabels[room.lightCommand]}</dd></div>
      </dl>
      {showDetailsLink && (
        <footer className="room-card__footer">
          <Link className="dashboard-detail-link" to={`/rooms/${room.id}`} aria-label={`View ${room.name} details`}>
            View details <span aria-hidden="true">→</span>
          </Link>
        </footer>
      )}
    </article>
  );
}
