import type { AlertRecord } from '../alerts/alert-model';
import type { RoomId } from '../dashboard/dashboard-model';

export function selectRoomAlerts(records: readonly AlertRecord[], roomId: RoomId): AlertRecord[] {
  return records.filter(({ status, target }) => status === 'active' && target.kind === 'room' && target.roomId === roomId);
}

export function formatActivityTime(timestamp: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila',
  }).format(new Date(timestamp)) + ' PHT';
}
