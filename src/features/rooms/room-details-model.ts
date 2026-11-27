import type { AlertRecord } from '../alerts/alert-model';
import type { DashboardAlert, RoomId } from '../dashboard/dashboard-model';

export function selectRoomAlerts(alerts: readonly DashboardAlert[], roomId: RoomId): DashboardAlert[] {
  return alerts.filter((alert) => alert.roomId === roomId);
}

export function selectRoomAlertRecords(records: readonly AlertRecord[], roomId: RoomId): AlertRecord[] {
  return records.filter((record) => record.status === 'active' && record.target.kind === 'room' && record.target.roomId === roomId);
}

export function formatActivityTime(timestamp: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila',
  }).format(new Date(timestamp)) + ' PHT';
}
