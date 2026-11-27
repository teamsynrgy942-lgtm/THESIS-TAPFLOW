import type { MainConsumptionTotal } from '../overview/main-consumption';

export const deviceIds = ['main', 'room1', 'room2', 'room3'] as const;
export const roomIds = [1, 2, 3] as const;
export type DeviceId = typeof deviceIds[number];
export type RoomId = typeof roomIds[number];

export const telemetryRooms = [
  { id: 'room-1', deviceId: 'room1', statusId: 1, name: 'Room 1' },
  { id: 'room-2', deviceId: 'room2', statusId: 2, name: 'Room 2' },
  { id: 'room-3', deviceId: 'room3', statusId: 3, name: 'Room 3' },
] as const;
export type TelemetryRoom = typeof telemetryRooms[number];

export interface FlowReading {
  id: string | number;
  device_id: DeviceId;
  pulses: number | null;
  sample_ms: number | null;
  flow_lpm: number | null;
  received_at: string | null;
}

export interface RoomStatus {
  room_id: RoomId;
  rfid_active: boolean | null;
  valve_commanded_on: boolean | null;
  bulb_commanded_on: boolean | null;
  timestamps: Record<string, string | null>;
}

export interface TelemetryError {
  kind: 'authentication' | 'permission' | 'network' | 'configuration' | 'database';
  code: string;
  message: string;
}

export type QueryResult<T> =
  | { status: 'records' | 'empty'; rows: T[] }
  | { status: 'error'; error: TelemetryError };

export interface MainConsumptionReport extends MainConsumptionTotal {
  dayStart: number;
  error: TelemetryError | null;
}

export type TelemetryReport =
  | { status: 'blocked'; checkedAt: string; error: TelemetryError }
  | {
    status: 'complete';
    checkedAt: string;
    readings: Record<DeviceId, QueryResult<FlowReading>>;
    rooms: Record<RoomId, QueryResult<RoomStatus>>;
    mainConsumption?: MainConsumptionReport;
  };

export type RoomTelemetryReport =
  | { status: 'blocked'; checkedAt: string; error: TelemetryError }
  | {
    status: 'complete';
    checkedAt: string;
    readings: QueryResult<FlowReading>;
    chart: QueryResult<FlowReading>;
    room: QueryResult<RoomStatus>;
  };

export interface PulseChartWindow {
  start: number;
  end: number;
}


