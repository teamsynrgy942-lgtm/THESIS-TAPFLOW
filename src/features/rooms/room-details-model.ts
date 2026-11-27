import type { DashboardAlert, RoomId } from '../dashboard/dashboard-model';

export function selectRoomAlerts(alerts: readonly DashboardAlert[], roomId: RoomId): DashboardAlert[] {
  return alerts.filter((alert) => alert.roomId === roomId);
}

export function formatActivityTime(timestamp: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila',
  }).format(new Date(timestamp)) + ' PHT';
}
