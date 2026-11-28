import { telemetryRooms } from '../telemetry/telemetry-types.ts';
import { formatAlertMeasurement, formatAlertTimestamp } from './alert-model.ts';
import type { AlertEvidenceItem, AlertRecord } from './alert-model';

export const R1_ALERT_CODE = 'R1_MISSING_FLOW_SIGNAL';
export const R2_ALERT_CODE = 'R2_UNAUTHORIZED_WATER_FLOW';
export const TAPFLOW_ALERT_CODES = [R1_ALERT_CODE, R2_ALERT_CODE] as const;
export const R1_ALERT_TABLE = 'tapflow_r1_alerts';
const timestampPattern = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTapFlowAlertCode(value: unknown): value is typeof TAPFLOW_ALERT_CODES[number] {
  return TAPFLOW_ALERT_CODES.some((code) => value === code);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseR1AlertId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) ? value : null;
}

function parseTimestamp(value: unknown): string | undefined {
  if (typeof value === 'string' && timestampPattern.test(value) && Number.isFinite(Date.parse(value))) {
    return value;
  }
  return undefined;
}

function parseR1Evidence(raw: unknown): AlertEvidenceItem[] {
  if (!isObject(raw)) return [];
  const items: AlertEvidenceItem[] = [];
  const threshold = raw.main_flow_threshold_lpm;
  if (typeof threshold === 'number' && threshold >= 0) {
    const value = formatAlertMeasurement(threshold, 'L/min');
    if (value !== null) items.push({ label: 'Main flow threshold', value });
  }
  for (const [key, label] of [['main_sample_count', 'Main samples'], ['room_sample_count', 'Room samples']]) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
      items.push({ label, value: String(value) });
    }
  }
  for (const [key, label] of [['main_latest_at', 'Latest Main sample'], ['room_latest_at', 'Latest room sample']]) {
    const dateTime = parseTimestamp(raw[key]);
    if (dateTime) items.push({ label, value: `${formatAlertTimestamp(dateTime)} PHT`, dateTime });
  }
  if (typeof raw.note === 'string' && raw.note.trim()) items.push({ label: 'Note', value: raw.note.trim() });
  return items;
}

function parseR2Evidence(raw: unknown): AlertEvidenceItem[] {
  if (!isObject(raw)) return [];
  const items: AlertEvidenceItem[] = [];
  for (const [key, label, unit] of [
    ['previous_pulses', 'Previous pulses'],
    ['latest_pulses', 'Latest pulses'],
    ['sample_ms', 'Sample interval', ' ms'],
    ['minimum_pulses_per_sample', 'Minimum pulses per sample'],
    ['confirmation_samples', 'Confirmation samples'],
  ]) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
      items.push({ label, value: `${value}${unit ?? ''}` });
    }
  }
  for (const [key, label] of [['rfid_active', 'RFID active'], ['valve_commanded_on', 'Valve commanded on']]) {
    const value = raw[key];
    if (typeof value === 'boolean') items.push({ label, value: value ? 'Yes' : 'No' });
  }
  for (const [key, label] of [['status_reported_at', 'Status reported at'], ['last_observed_at', 'Last observed at']]) {
    const dateTime = parseTimestamp(raw[key]);
    if (dateTime) items.push({ label, value: `${formatAlertTimestamp(dateTime)} PHT`, dateTime });
  }
  return items;
}

export function parseR1Alert(row: unknown): AlertRecord | null {
  return isObject(row) && row.code === R1_ALERT_CODE ? parseTapFlowAlert(row) : null;
}

export function parseTapFlowAlert(row: unknown): AlertRecord | null {
  if (!isObject(row) || !isTapFlowAlertCode(row.code)) return null;
  const id = parseR1AlertId(row.id);
  const timestamp = parseTimestamp(row.detected_at);
  const room = telemetryRooms.find(({ statusId }) => row.room_id === statusId || row.room_id === String(statusId));
  const status = row.status === 'ACTIVE' ? 'active' : row.status === 'RESOLVED' ? 'resolved' : null;
  if (!id || !timestamp || !room || !status) return null;

  const isR2 = row.code === R2_ALERT_CODE;
  const title = isR2 ? 'Unauthorized Water Flow' : 'Possible Flow Sensor Failure';
  const description = isR2
    ? `${room.name} reported sustained water-flow pulses while recent room status indicated an inactive RFID session and a valve commanded OFF.`
    : `The Main sensor detected water flow while ${room.name} reported zero flow pulses during an authorized water-use session. Possible cause: sensor malfunction or disconnected signal wiring.`;
  return {
    id,
    target: { kind: 'room', roomId: room.id },
    detectionRule: row.code,
    title,
    message: title,
    description,
    timestamp,
    lastDetectedAt: parseTimestamp(row.last_detected_at),
    status,
    resolvedAt: status === 'resolved' ? parseTimestamp(row.resolved_at) : undefined,
    resolvedBy: status === 'resolved' && typeof row.resolved_by === 'string' && uuidPattern.test(row.resolved_by)
      ? row.resolved_by : undefined,
    resolutionRemark: status === 'resolved' && typeof row.resolution_remark === 'string'
      ? row.resolution_remark.trim() || undefined : undefined,
    evidence: isR2 ? parseR2Evidence(row.evidence) : parseR1Evidence(row.evidence),
  };
}
