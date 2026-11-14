import type { AlertRecord, AlertSeverity, MonitoringStatus } from '../alerts/alert-model';
import { toActiveDashboardAlerts } from '../alerts/alert-model.ts';

export type RoomId = 'room-1' | 'room-2' | 'room-3';
export type RoomStatus = 'idle' | 'active' | 'alert' | 'offline';

export interface RoomTelemetry {
  status: RoomStatus;
  rfidSession: 'inactive' | 'active';
  valveCommand: 'closed' | 'open';
  lightCommand: 'off' | 'on';
  currentFlow: number;
  usedToday: number;
}

export interface Room extends RoomTelemetry {
  id: RoomId;
  name: string;
}

export interface WaterInlet {
  currentFlow: number;
  totalVolumeToday: number;
}

export interface DashboardAlert {
  id: string;
  roomId?: RoomId;
  message: string;
  severity: AlertSeverity;
}

export interface DashboardState {
  rooms: Room[];
  inlet: WaterInlet;
  alerts: DashboardAlert[];
  alertRecords: readonly AlertRecord[];
  monitoringStatus: MonitoringStatus;
  updatedAt: string;
}

export type DashboardAction =
  | { type: 'room/updated'; roomId: RoomId; changes: Partial<RoomTelemetry>; updatedAt: string }
  | { type: 'inlet/updated'; changes: Partial<WaterInlet>; updatedAt: string }
  | { type: 'alerts/replaced'; alerts: DashboardAlert[]; updatedAt: string }
  | { type: 'alerts/records-replaced'; records: readonly AlertRecord[]; updatedAt: string }
  | { type: 'monitoring/status-updated'; status: MonitoringStatus };

export function createDemoDashboard(): DashboardState {
  return {
    rooms: [1, 2, 3].map((number) => ({
      id: `room-${number}` as RoomId,
      name: `Room ${number}`,
      status: 'idle',
      rfidSession: 'inactive',
      valveCommand: 'closed',
      lightCommand: 'off',
      currentFlow: 0,
      usedToday: 0,
    })),
    inlet: { currentFlow: 0, totalVolumeToday: 0 },
    alerts: [],
    alertRecords: [],
    monitoringStatus: 'inactive',
    // Fixed demo timestamp matches the Overview reference; updates replace it.
    updatedAt: '2026-11-13T02:30:00.000Z',
  };
}

export function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
  switch (action.type) {
    case 'room/updated':
      return {
        ...state,
        rooms: state.rooms.map((room) =>
          room.id === action.roomId ? { ...room, ...action.changes } : room,
        ),
        updatedAt: action.updatedAt,
      };
    case 'inlet/updated':
      return { ...state, inlet: { ...state.inlet, ...action.changes }, updatedAt: action.updatedAt };
    case 'alerts/replaced':
      return { ...state, alerts: action.alerts, updatedAt: action.updatedAt };
    case 'alerts/records-replaced':
      return { ...state, alertRecords: [...action.records], alerts: toActiveDashboardAlerts(action.records), updatedAt: action.updatedAt };
    case 'monitoring/status-updated':
      return { ...state, monitoringStatus: action.status };
  }
}

export function getRoomSummary(rooms: Room[]): string {
  if (rooms.every((room) => room.status === 'idle')) return 'All three rooms are idle.';
  const active = rooms.filter((room) => room.status === 'active').length;
  const alerts = rooms.filter((room) => room.status === 'alert').length;
  const offline = rooms.filter((room) => room.status === 'offline').length;
  return [
    active ? `${active} ${active === 1 ? 'room' : 'rooms'} active` : '',
    alerts ? `${alerts} ${alerts === 1 ? 'room needs' : 'rooms need'} attention` : '',
    offline ? `${offline} ${offline === 1 ? 'room' : 'rooms'} offline` : '',
  ].filter(Boolean).join(' · ') + '.';
}

export function formatVolume(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

export function formatUpdateTime(updatedAt: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila',
  }).format(new Date(updatedAt)) + ' PHT';
}

