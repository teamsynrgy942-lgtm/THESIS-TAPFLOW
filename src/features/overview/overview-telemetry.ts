import type { DeviceId, FlowReading, MainConsumptionReport, QueryResult, RoomId, RoomStatus, TelemetryError, TelemetryReport } from '../telemetry/telemetry-types';
import { getPhilippineDay } from './main-consumption.ts';

export const REFRESH_INTERVAL_MS = 20_000;
export const RECENT_REPORT_WINDOW_MS = 120_000;
export { telemetryRooms as overviewRooms } from '../telemetry/telemetry-types.ts';

export interface LatestRecord<T> {
  value: T | null;
  loaded: boolean;
  error: TelemetryError | null;
}

export interface OverviewTelemetry {
  readings: Record<DeviceId, LatestRecord<FlowReading>>;
  rooms: Record<RoomId, LatestRecord<RoomStatus>>;
  checkedAt: string | null;
  mainConsumption: MainConsumptionReport | null;
}

export function createOverviewTelemetry(): OverviewTelemetry {
  const empty = <T>(): LatestRecord<T> => ({ value: null, loaded: false, error: null });
  return {
    readings: { main: empty(), room1: empty(), room2: empty(), room3: empty() },
    rooms: { 1: empty(), 2: empty(), 3: empty() },
    checkedAt: null,
    mainConsumption: null,
  };
}

function applyResult<T>(previous: LatestRecord<T>, result: QueryResult<T>): LatestRecord<T> {
  if (result.status !== 'error') return { value: result.rows[0] ?? null, loaded: true, error: null };
  const clear = result.error.kind === 'authentication' || result.error.kind === 'permission';
  return { value: clear ? null : previous.value, loaded: true, error: result.error };
}

export function applyTelemetryReport(previous: OverviewTelemetry, report: TelemetryReport): OverviewTelemetry {
  const blocked: QueryResult<never> | null = report.status === 'blocked' ? { status: 'error', error: report.error } : null;
  const reading = (id: DeviceId) => applyResult(previous.readings[id], report.status === 'complete' ? report.readings[id] : blocked!);
  const room = (id: RoomId) => applyResult(previous.rooms[id], report.status === 'complete' ? report.rooms[id] : blocked!);
  let mainConsumption = report.status === 'complete' ? report.mainConsumption ?? null : {
    dayStart: getPhilippineDay(Date.parse(report.checkedAt)).start,
    liters: null,
    incomplete: true,
    error: report.error,
  };
  if (mainConsumption?.error && mainConsumption.error.kind !== 'authentication' && mainConsumption.error.kind !== 'permission'
    && previous.mainConsumption?.liters != null && previous.mainConsumption.dayStart === mainConsumption.dayStart) {
    // Keep the last known subtotal for this day when its refresh fails.
    mainConsumption = { ...mainConsumption, liters: previous.mainConsumption.liters, incomplete: true };
  }
  return {
    readings: { main: reading('main'), room1: reading('room1'), room2: reading('room2'), room3: reading('room3') },
    rooms: { 1: room(1), 2: room(2), 3: room(3) },
    checkedAt: report.checkedAt,
    mainConsumption,
  };
}

export function roomReportingTime(status: RoomStatus | null, reading: FlowReading | null): string | null {
  // A heartbeat is authoritative even when an older/newer flow sample exists.
  // Only missing heartbeats fall back to the actual flow receipt, never updated_at.
  return status?.timestamps.last_seen_at ?? reading?.received_at ?? null;
}

export function reportingFreshness(timestamp: string | null | undefined, now: number): 'recent' | 'stale' | 'unknown' {
  if (!timestamp) return 'unknown';
  const received = Date.parse(timestamp);
  if (!Number.isFinite(received) || received > now) return 'unknown';
  return now - received <= RECENT_REPORT_WINDOW_MS ? 'recent' : 'stale';
}

export function reportingLabel(timestamp: string | null | undefined, now: number): string {
  const freshness = reportingFreshness(timestamp, now);
  if (freshness === 'recent') return 'Recent report';
  if (timestamp && freshness === 'unknown') return 'Time unknown';
  return 'No recent data';
}

export function roomReportingLabel(status: RoomStatus | null, reading: FlowReading | null, now: number): string {
  const timestamp = roomReportingTime(status, reading);
  if (reportingFreshness(timestamp, now) === 'stale' && reportingFreshness(reading?.received_at, now) === 'recent') {
    return 'Room status stale';
  }
  return reportingLabel(timestamp, now);
}

export function commandedStateLabel(value: boolean | null | undefined, on: string, off: string): string {
  return value == null ? 'Unknown' : value ? on : off;
}

export function roomStatusIsRecent(status: RoomStatus | null, now: number): boolean {
  // Flow uploads and record-update timestamps do not establish command-state freshness.
  return reportingFreshness(status?.timestamps.last_seen_at, now) === 'recent';
}

export function currentCommandLabel(
  status: LatestRecord<RoomStatus>, field: 'rfid_active' | 'valve_commanded_on' | 'bulb_commanded_on',
  now: number, on: string, off: string,
): string {
  if (!status.loaded) return 'Loading…';
  if (!roomStatusIsRecent(status.value, now)) return 'Unknown';
  return commandedStateLabel(status.value?.[field], on, off);
}

export function currentFlowDisplay(reading: LatestRecord<FlowReading>, now: number): { value: string; unit?: string } {
  if (!reading.loaded) return { value: 'Loading…' };
  const flow = reading.value?.flow_lpm;
  if (flow == null || !Number.isFinite(flow) || flow < 0) return { value: 'Unavailable' };
  if (reportingFreshness(reading.value?.received_at, now) !== 'recent') return { value: 'Unknown' };
  return { value: flow.toFixed(2), unit: 'L/min' };
}

export function flowActivityLabel(reading: LatestRecord<FlowReading>, now: number): 'Flow Detected' | 'No Flow' | 'Unknown' {
  const pulses = reading.value?.pulses;
  if (!reading.loaded || pulses == null || !Number.isInteger(pulses) || pulses < 0
    || reportingFreshness(reading.value?.received_at, now) !== 'recent') return 'Unknown';
  return pulses > 0 ? 'Flow Detected' : 'No Flow';
}

export type PresenceLabel = 'ON' | 'OFF' | 'Unknown' | 'Stale' | 'Missing Data' | 'Loading…' | 'Refresh failed';

export function presenceTone(label: PresenceLabel): 'success' | 'idle' | 'warning' | 'offline' | 'danger' | 'info' {
  if (label === 'ON') return 'success';
  if (label === 'Stale' || label === 'Refresh failed') return 'warning';
  if (label === 'Missing Data') return 'danger';
  if (label === 'Unknown') return 'info';
  return 'idle';
}

/** Card badge. A stale or missing report is never labeled ON or OFF. */
export function roomPresenceLabel(status: LatestRecord<RoomStatus>, reading: LatestRecord<FlowReading>, now: number): PresenceLabel {
  if (!reading.loaded || !status.loaded) return 'Loading…';
  const reportedAt = roomReportingTime(status.value, reading.value);
  if ((reading.error || status.error) && !reportedAt) return 'Refresh failed';
  if (!reportedAt) return 'Missing Data';
  const freshness = reportingFreshness(reportedAt, now);
  if (freshness === 'unknown') return 'Unknown';
  const heartbeatStale = reportingFreshness(status.value?.timestamps.last_seen_at, now) === 'stale'
    && reportingFreshness(reading.value?.received_at, now) === 'recent';
  if (freshness === 'stale' || heartbeatStale) return 'Stale';
  const flow = flowActivityLabel(reading, now);
  const heartbeatRecent = roomStatusIsRecent(status.value, now);
  const inUse = flow === 'Flow Detected' || (heartbeatRecent && (
    status.value?.rfid_active === true || status.value?.valve_commanded_on === true || status.value?.bulb_commanded_on === true
  ));
  if (inUse) return 'ON';
  const idle = flow === 'No Flow' && heartbeatRecent
    && status.value?.rfid_active === false && status.value?.valve_commanded_on === false && status.value?.bulb_commanded_on === false;
  return idle ? 'OFF' : 'Unknown';
}

export function inletPresenceLabel(reading: LatestRecord<FlowReading>, now: number): PresenceLabel {
  if (!reading.loaded) return 'Loading…';
  const reportedAt = reading.value?.received_at ?? null;
  if (reading.error && !reportedAt) return 'Refresh failed';
  if (!reportedAt) return 'Missing Data';
  const freshness = reportingFreshness(reportedAt, now);
  if (freshness === 'unknown') return 'Unknown';
  if (freshness === 'stale') return 'Stale';
  return currentFlowDisplay(reading, now).unit ? 'ON' : 'Unknown';
}

/** Latest raw room pulses. Zero is a measurement; a missing or stale sample is not shown as zero. */
export function rawPulseLabel(reading: LatestRecord<FlowReading>, now: number): string {
  if (!reading.loaded) return 'Loading…';
  const reportedAt = reading.value?.received_at;
  const pulses = reading.value?.pulses;
  if (reportingFreshness(reportedAt, now) !== 'recent') return reportedAt ? 'Unknown' : 'Missing data';
  if (typeof pulses !== 'number' || !Number.isInteger(pulses) || pulses < 0) return 'Missing data';
  return `${pulses} pulses`;
}

export function formatTelemetryTime(timestamp: string | null | undefined): string {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return 'Unavailable';
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: 'Asia/Manila',
  }).format(new Date(timestamp)) + ' PHT';
}

export function telemetryErrorLabel(error: TelemetryError): string {
  if (error.kind === 'authentication') return 'Session expired. Please sign out and sign in again.';
  if (error.kind === 'permission') return 'Access denied for these readings.';
  if (error.kind === 'configuration') return 'Telemetry configuration needs attention.';
  return 'Could not refresh these readings. Retrying automatically.';
}
