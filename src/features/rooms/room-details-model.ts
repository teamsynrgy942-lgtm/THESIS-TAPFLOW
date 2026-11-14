import type { DashboardAlert, RoomId } from '../dashboard/dashboard-model';

export interface FlowReading {
  timestamp: string;
  litersPerMinute: number;
}

export interface UsageRecord {
  date: string;
  liters: number;
}

export interface RoomActivity {
  id: string;
  timestamp: string;
  description: string;
}

export interface RoomHistory {
  flowReadings: readonly FlowReading[];
  usageRecords: readonly UsageRecord[];
  activities: readonly RoomActivity[];
}

export function createEmptyRoomHistory(): RoomHistory {
  return { flowReadings: [], usageRecords: [], activities: [] };
}

// Demo measurements do not imply historical samples or recorded events.
export const demoRoomHistories: Readonly<Record<RoomId, RoomHistory>> = {
  'room-1': createEmptyRoomHistory(),
  'room-2': createEmptyRoomHistory(),
  'room-3': createEmptyRoomHistory(),
};

export function selectRoomAlerts(alerts: readonly DashboardAlert[], roomId: RoomId): DashboardAlert[] {
  return alerts.filter((alert) => alert.roomId === roomId);
}

export function formatHistoryDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila',
  }).format(new Date(date));
}

export function formatActivityTime(timestamp: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila',
  }).format(new Date(timestamp)) + ' PHT';
}
