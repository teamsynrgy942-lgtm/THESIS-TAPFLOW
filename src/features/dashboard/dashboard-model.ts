import type { AlertRecord, AlertSeverity } from '../alerts/alert-model';
import { toActiveDashboardAlerts } from '../alerts/alert-model.ts';
import { telemetryRooms } from '../telemetry/telemetry-types.ts';

export type RoomId = typeof telemetryRooms[number]['id'];

export interface Room {
  id: RoomId;
  name: string;
}

export interface DashboardAlert {
  id: string;
  roomId?: RoomId;
  message: string;
  severity?: AlertSeverity;
}

export interface DashboardState {
  rooms: readonly Room[];
  alerts: readonly DashboardAlert[];
  alertRecords: readonly AlertRecord[];
}

export function createDashboardState(records: readonly AlertRecord[] = []): DashboardState {
  return { rooms: telemetryRooms, alerts: toActiveDashboardAlerts(records), alertRecords: [...records] };
}

export function formatUpdateTime(updatedAt: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila',
  }).format(new Date(updatedAt)) + ' PHT';
}
