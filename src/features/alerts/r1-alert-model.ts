import { telemetryRooms } from '../telemetry/telemetry-types.ts';
import { formatAlertMeasurement, formatAlertTimestamp } from './alert-model.ts';
import type { AlertEvidenceItem, AlertRecord } from './alert-model';

export const R1_ALERT_CODE = 'R1_MISSING_FLOW_SIGNAL';
export const R1_ALERT_TABLE = 'tapflow_r1_alerts';
const timestampPattern = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i;

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

function parseEvidence(raw: unknown): AlertEvidenceItem[] {
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
  const occurrences = raw.occurrence_count;
  if (typeof occurrences === 'number' && Number.isSafeInteger(occurrences) && occurrences >= 0) {
    items.push({ label: 'Occurrences', value: String(occurrences) });
  }
  const observed = parseTimestamp(raw.last_observed_at);
  if (observed) items.push({ label: 'Last observed', value: `${formatAlertTimestamp(observed)} PHT`, dateTime: observed });
  if (typeof raw.resolution_note === 'string' && raw.resolution_note.trim()) {
    items.push({ label: 'Resolution remarks', value: raw.resolution_note.trim() });
  }
  return items;
}

const hiddenEvidence = /secret|password|token|api[_-]?key|authorization|credential/i;

function genericEvidence(raw: unknown): AlertEvidenceItem[] {
  if (!isObject(raw)) return [];
  const items: AlertEvidenceItem[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (hiddenEvidence.test(key)) continue;
    const label = key.replaceAll('_', ' ');
    if (typeof value === 'string' && value.trim()) items.push({ label, value: value.trim() });
    else if (typeof value === 'number' && Number.isFinite(value)) items.push({ label, value: String(value) });
    else if (typeof value === 'boolean') items.push({ label, value: value ? 'Yes' : 'No' });
  }
  return items;
}

export function parseR1Alert(row: unknown): AlertRecord | null {
  if (!isObject(row) || row.code !== R1_ALERT_CODE) return null;
  const id = parseR1AlertId(row.id);
  const timestamp = parseTimestamp(row.detected_at);
  const room = telemetryRooms.find(({ statusId }) => row.room_id === statusId || row.room_id === String(statusId));
  const status = row.status === 'ACTIVE' ? 'active' : row.status === 'RESOLVED' ? 'resolved' : null;
  if (!id || !timestamp || !room || !status) return null;

  const title = 'Possible Flow Sensor Failure';
  return {
    id,
    target: { kind: 'room', roomId: room.id },
    detectionRule: R1_ALERT_CODE,
    title,
    message: title,
    description: `The Main sensor detected water flow while ${room.name} reported zero flow pulses during an authorized water-use session. Possible cause: sensor malfunction or disconnected signal wiring.`,
    timestamp,
    status,
    resolvedAt: status === 'resolved' ? parseTimestamp(row.resolved_at) : undefined,
    evidence: parseEvidence(row.evidence),
  };
}

/** R1 rows keep their description. Other stored codes stay visible and are not dropped. */
export function parseStoredAlert(row: unknown): AlertRecord | null {
  if (!isObject(row) || typeof row.code !== 'string' || !row.code.trim()) return null;
  if (row.code === R1_ALERT_CODE) return parseR1Alert(row);
  const id = parseR1AlertId(row.id);
  const timestamp = parseTimestamp(row.detected_at);
  const room = telemetryRooms.find(({ statusId }) => row.room_id === statusId || row.room_id === String(statusId));
  const status = row.status === 'ACTIVE' ? 'active' : row.status === 'RESOLVED' ? 'resolved' : null;
  if (!id || !timestamp || !room || !status) return null;
  const code = row.code.trim();
  return {
    id,
    target: { kind: 'room', roomId: room.id },
    detectionRule: code,
    title: code,
    message: code,
    description: 'Recorded anomaly. The dashboard displays the stored code and evidence without adding a detection rule.',
    timestamp,
    status,
    resolvedAt: status === 'resolved' ? parseTimestamp(row.resolved_at) : undefined,
    evidence: genericEvidence(row.evidence),
  };
}
