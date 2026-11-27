import { supabase } from '../../lib/supabase';
import { calculateMainConsumption, getPhilippineDay } from '../overview/main-consumption';
import type { MainConsumptionReading } from '../overview/main-consumption';

import { deviceIds, roomIds } from './telemetry-types';
import type { DeviceId, FlowReading, MainConsumptionReport, PulseChartWindow, QueryResult, RoomId, RoomStatus, RoomTelemetryReport, TelemetryError, TelemetryReport, TelemetryRoom } from './telemetry-types';
export { deviceIds, roomIds } from './telemetry-types';
export type { DeviceId, FlowReading, QueryResult, RoomId, RoomStatus, TelemetryError, TelemetryReport } from './telemetry-types';

export function safeMessage(message: string): string {
  for (const value of [import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY]) {
    if (typeof value === 'string' && value) message = message.replaceAll(value, '[redacted]');
  }
  return message
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/\bsb_(?:publishable|secret)_[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/((?:access_token|refresh_token|apikey|password|authorization)["']?\s*[:=]\s*)[^\s,}]+/gi, '$1[redacted]');
}

function classifyError(error: unknown, status = 0): TelemetryError {
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const code = typeof value.code === 'string' && /^[\w-]+$/.test(value.code) ? value.code : 'REQUEST_FAILED';
  const message = safeMessage(typeof value.message === 'string' ? value.message : 'The request could not be completed.');
  const httpStatus = typeof value.status === 'number' ? value.status : status;
  let kind: TelemetryError['kind'];
  if (['42P01', '42703', 'PGRST204', 'PGRST205', 'PGRST106', 'invalid_api_key'].includes(code)
    || /invalid api key|no api key/i.test(message) || httpStatus === 404) {
    kind = 'configuration';
  } else if (code === '42501' || httpStatus === 403) {
    kind = 'permission';
  } else if (httpStatus === 401 || value.name === 'AuthSessionMissingError'
    || ['PGRST301', 'PGRST302', 'PGRST303', 'session_not_found', 'user_not_found', 'refresh_token_not_found', 'refresh_token_already_used', 'bad_jwt', 'AUTH_REQUIRED'].includes(code)) {
    kind = 'authentication';
  } else if (!httpStatus || [502, 503, 504].includes(httpStatus) || /fetch failed|failed to fetch|network|timed? ?out|aborted/i.test(message)) {
    kind = 'network';
  } else {
    kind = 'database';
  }
  return { kind, code, message };
}

function rowsResult<T>(rows: T[]): QueryResult<T> {
  return { status: rows.length ? 'records' : 'empty', rows };
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(15_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function readDevice(deviceId: DeviceId, signal?: AbortSignal, limit = 5): Promise<QueryResult<FlowReading>> {
  try {
    const { data, error, status } = await supabase.schema('public').from('flow_readings')
      .select('id, device_id, pulses, sample_ms, flow_lpm, received_at')
      .eq('device_id', deviceId)
      .order('received_at', { ascending: false, nullsFirst: false })
      .limit(limit)
      .retry(false)
      .abortSignal(requestSignal(signal))
      .returns<FlowReading[]>();
    return error ? { status: 'error', error: classifyError(error, status) } : rowsResult(data ?? []);
  } catch (error) {
    return { status: 'error', error: classifyError(error) };
  }
}

function projectRoom(row: Record<string, unknown>): RoomStatus {
  const fields = ['rfid_active', 'valve_commanded_on', 'bulb_commanded_on'] as const;
  if (!roomIds.includes(row.room_id as RoomId) || fields.some((key) => row[key] !== null && typeof row[key] !== 'boolean')) {
    throw { code: '42703', message: 'room_status is missing a requested field or has an unexpected field type.' };
  }
  // Discover timestamp names from visible rows, without assuming a schema migration.
  // Other columns (including identifiers or credentials) are never exposed by this service.
  const timestamps = Object.fromEntries(Object.entries(row).filter((entry): entry is [string, string | null] => {
    const [key, value] = entry;
    return /(?:_at|_timestamp|_time)$|^last_(?:seen|updated|update)$/.test(key)
      && (value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[T ]/.test(value)));
  }));
  return {
    room_id: row.room_id as RoomId,
    rfid_active: row.rfid_active as boolean | null,
    valve_commanded_on: row.valve_commanded_on as boolean | null,
    bulb_commanded_on: row.bulb_commanded_on as boolean | null,
    timestamps,
  };
}

async function readRooms(signal?: AbortSignal, selectedIds: readonly RoomId[] = roomIds): Promise<QueryResult<RoomStatus>> {
  try {
    // A bounded SELECT * discovers available timestamps. Only the projected fields leave this function.
    const query = supabase.schema('public').from('room_status').select('*').in('room_id', [...selectedIds]);
    const ordered = selectedIds.length === 1
      ? query.order('last_seen_at', { ascending: false, nullsFirst: false }) : query.order('room_id');
    const { data, error, status } = await ordered.limit(selectedIds.length)
      .retry(false)
      .abortSignal(requestSignal(signal))
      .returns<Record<string, unknown>[]>();
    return error ? { status: 'error', error: classifyError(error, status) } : rowsResult((data ?? []).map(projectRoom));
  } catch (error) {
    return { status: 'error', error: classifyError(error) };
  }
}

async function verifyTelemetryUser(): Promise<TelemetryError | null> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return classifyError(error);
    if (!data.user) return classifyError({ code: 'AUTH_REQUIRED', message: 'No signed-in user was found. Sign in again.' });
    return null;
  } catch (error) {
    return classifyError(error);
  }
}

async function readMainConsumption(checkedAt: string, signal?: AbortSignal): Promise<MainConsumptionReport> {
  const now = Date.parse(checkedAt);
  const { start, end } = getPhilippineDay(now);
  const dayStart = new Date(start).toISOString();
  const dayEnd = new Date(end).toISOString();
  const rows: MainConsumptionReading[] = [];
  const pageSize = 1000;
  let expectedCount: number | null = null;
  let failure: TelemetryError | null = null;

  try {
    while (true) {
      signal?.throwIfAborted();
      const { data, error, status, count } = await supabase.schema('public').from('flow_readings')
        .select('id, device_id, flow_lpm, sample_ms, received_at', rows.length === 0 ? { count: 'exact' } : {})
        .eq('device_id', 'main')
        .gte('received_at', dayStart).lt('received_at', dayEnd)
        // Freeze the upper bound so new receipts do not move the pagination window.
        .lte('received_at', checkedAt)
        .order('received_at', { ascending: true }).order('id', { ascending: true })
        .range(rows.length, rows.length + pageSize - 1)
        .retry(false).abortSignal(requestSignal(signal)).returns<MainConsumptionReading[]>();
      if (error) {
        failure = classifyError(error, status);
        break;
      }
      if (count != null) expectedCount = count;
      const page = data ?? [];
      if (!page.length) {
        if (expectedCount != null && rows.length < expectedCount) {
          failure = { kind: 'database', code: 'INCOMPLETE_READ', message: 'Some Main readings could not be loaded.' };
        }
        break;
      }
      rows.push(...page);
      if (expectedCount != null ? rows.length >= expectedCount : page.length < pageSize) break;
    }
  } catch (error) {
    failure = classifyError(error);
  }

  const accessDenied = failure?.kind === 'authentication' || failure?.kind === 'permission';
  const total = calculateMainConsumption(accessDenied ? [] : rows, now);
  return { ...total, dayStart: start, incomplete: total.incomplete || failure != null, error: failure };
}

/** Reads only, using the shared client's current browser session. No anonymous fallback. */
export async function readTelemetry(signal?: AbortSignal, options?: { includeMainConsumption: boolean }): Promise<TelemetryReport> {
  const checkedAt = new Date().toISOString();
  const error = await verifyTelemetryUser();
  if (error) return { status: 'blocked', checkedAt, error };
  signal?.throwIfAborted();

  const [flows, roomResult, mainConsumption] = await Promise.all([
    Promise.all(deviceIds.map((id) => readDevice(id, signal))),
    readRooms(signal),
    options?.includeMainConsumption ? readMainConsumption(checkedAt, signal) : undefined,
  ]);
  // Keep each device's outcome independent, including permission errors and empty results.
  const readings = { main: flows[0], room1: flows[1], room2: flows[2], room3: flows[3] };
  const forRoom = (id: RoomId): QueryResult<RoomStatus> => roomResult.status === 'error'
    ? roomResult : rowsResult(roomResult.rows.filter((row) => row.room_id === id));
  return { status: 'complete', checkedAt, readings, rooms: { 1: forRoom(1), 2: forRoom(2), 3: forRoom(3) }, mainConsumption };
}

export const ROOM_HISTORY_LIMIT = 60;

async function readRoomChart(deviceId: DeviceId, window: PulseChartWindow, signal?: AbortSignal): Promise<QueryResult<FlowReading>> {
  const rows: FlowReading[] = [];
  const pageSize = 1000;
  let total: number | null = null;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { data, error, status, count } = await supabase.schema('public').from('flow_readings')
        .select('id, device_id, pulses, sample_ms, flow_lpm, received_at', rows.length === 0 ? { count: 'exact' } : {})
        .eq('device_id', deviceId)
        .gte('received_at', new Date(window.start).toISOString())
        .lte('received_at', new Date(window.end).toISOString())
        .order('received_at', { ascending: true }).order('id', { ascending: true })
        .range(rows.length, rows.length + pageSize - 1)
        .retry(false).abortSignal(requestSignal(signal)).returns<FlowReading[]>();
      if (error) return { status: 'error', error: classifyError(error, status) };
      if (count != null) total = count;
      const page = data ?? [];
      rows.push(...page);
      // Exact counts also support projects whose API row cap is smaller than pageSize.
      if (!page.length || (total != null ? rows.length >= total : page.length < pageSize)) return rowsResult(rows);
    }
  } catch (error) {
    // A partial page sequence is an error, never a supposedly complete chart.
    return { status: 'error', error: classifyError(error) };
  }
}

/** Independent latest records, selected time-window samples, and the room status snapshot. */
export async function readRoomTelemetry(room: TelemetryRoom, signal: AbortSignal | undefined, window: PulseChartWindow): Promise<RoomTelemetryReport> {
  const checkedAt = new Date().toISOString();
  const error = await verifyTelemetryUser();
  if (error) return { status: 'blocked', checkedAt, error };
  signal?.throwIfAborted();
  const [readings, statuses, chart] = await Promise.all([
    readDevice(room.deviceId, signal, ROOM_HISTORY_LIMIT),
    readRooms(signal, [room.statusId]),
    readRoomChart(room.deviceId, window, signal),
  ]);
  return {
    status: 'complete', checkedAt, readings, chart,
    room: statuses.status === 'error' ? statuses : rowsResult(statuses.rows.filter((row) => row.room_id === room.statusId)),
  };
}
