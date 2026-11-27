import { Link } from 'react-router';
import type { TelemetryRoom } from '../../features/telemetry/telemetry-types';

export function RoomSelector({ rooms, selectedRoomId }: {
  rooms: readonly TelemetryRoom[]; selectedRoomId?: TelemetryRoom['id'];
}) {
  return (
    <nav className="room-selector" aria-label="Select room">
      {rooms.map((room) => <Link key={room.id} className="room-selector__link"
        to={`/rooms/${room.id}`}
        aria-current={room.id === selectedRoomId ? 'page' : undefined}>{room.name}</Link>)}
    </nav>
  );
}
