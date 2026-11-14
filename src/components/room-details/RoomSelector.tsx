import { Link } from 'react-router';
import type { Room, RoomId } from '../../features/dashboard/dashboard-model';

export function RoomSelector({ rooms, selectedRoomId }: { rooms: readonly Room[]; selectedRoomId?: RoomId }) {
  return (
    <nav className="room-selector" aria-label="Select room">
      {rooms.map((room) => <Link key={room.id} className="room-selector__link" to={`/rooms/${room.id}`} aria-current={room.id === selectedRoomId ? 'page' : undefined}>{room.name}</Link>)}
    </nav>
  );
}
