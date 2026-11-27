import type { DashboardAlert, Room, RoomId } from '../dashboard/dashboard-model';

export type AlertSeverity = 'info' | 'warning' | 'critical' | 'emergency';
export type AlertStatus = 'active' | 'resolved';

export type AlertTarget =
  | { kind: 'room'; roomId: RoomId }
  | { kind: 'main-inlet' };

export interface AlertEvidenceItem {
  label: string;
  value: string;
  dateTime?: string;
}

/** Display contract for verified alert records. */
export interface AlertRecord {
  id: string;
  target: AlertTarget;
  deviceId?: string;
  detectionRule: string;
  severity?: AlertSeverity;
  timestamp: string;
  lastDetectedAt?: string;
  status: AlertStatus;
  title?: string;
  message?: string;
  description?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionRemark?: string;
  evidence?: readonly AlertEvidenceItem[];
  measuredValue?: number;
  threshold?: number;
  unit?: string;
}

export const severityLabels: Record<AlertSeverity, string> = {
  info: 'Info', warning: 'Warning', critical: 'Critical', emergency: 'Emergency',
};

/** Keep existing active-alert views synchronized without including resolved history. */
export function toActiveDashboardAlerts(records: readonly AlertRecord[]): DashboardAlert[] {
  return records.filter((record) => record.status === 'active').map((record) => ({
    id: record.id,
    roomId: record.target.kind === 'room' ? record.target.roomId : undefined,
    message: record.message || record.detectionRule,
    severity: record.severity,
  }));
}

export function getAlertTargetLabel(target: AlertTarget, rooms: readonly Room[]): string {
  return target.kind === 'main-inlet' ? 'Main water inlet'
    : rooms.find((room) => room.id === target.roomId)?.name || target.roomId;
}

export function formatAlertTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return 'Timestamp unavailable';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    hour12: true, timeZone: 'Asia/Manila',
  }).format(date);
}

export function orderAlertRecords(records: readonly AlertRecord[]): AlertRecord[] {
  return [...records].sort((a, b) => {
    const first = Date.parse(a.timestamp);
    const second = Date.parse(b.timestamp);
    return (Number.isFinite(second) ? second : 0) - (Number.isFinite(first) ? first : 0);
  });
}

export function formatAlertMeasurement(value: number | undefined, unit?: string): string | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value)}${unit ? ` ${unit}` : ''}`;
}
