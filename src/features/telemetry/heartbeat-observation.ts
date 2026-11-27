import { telemetryRooms } from './telemetry-types.ts';
import type { TelemetryReport } from './telemetry-types';

export type TimestampChange = 'baseline' | 'advanced' | 'unchanged' | 'regressed' | 'unavailable' | 'error';

export const timestampChangeLabels: Record<TimestampChange, string> = {
  baseline: 'Baseline recorded; advancement not yet observed',
  advanced: 'Timestamp advanced between reads',
  unchanged: 'Timestamp unchanged between reads',
  regressed: 'Timestamp moved backwards; check the source',
  unavailable: 'No valid reporting timestamp',
  error: 'Read failed; advancement unverified',
};

export function timestampChange(previous: string | null | undefined, current: string | null | undefined, now: number): TimestampChange {
  const nextTime = current ? Date.parse(current) : NaN;
  const previousTime = previous ? Date.parse(previous) : NaN;
  if (!Number.isFinite(nextTime) || nextTime > now) return 'unavailable';
  if (!Number.isFinite(previousTime) || previousTime > now) return 'baseline';
  return nextTime > previousTime ? 'advanced' : nextTime < previousTime ? 'regressed' : 'unchanged';
}

export function observeReportingTimestamps(previous: TelemetryReport | null, current: TelemetryReport, now: number) {
  const sources = [{ name: 'Main', deviceId: 'main' as const, statusId: null }, ...telemetryRooms];
  const timestamp = (report: TelemetryReport | null, source: typeof sources[number]): string | null => {
    if (report?.status !== 'complete') return null;
    if (source.statusId === null) {
      const reading = report.readings.main;
      return reading.status !== 'error' ? reading.rows[0]?.received_at ?? null : null;
    }
    const room = report.rooms[source.statusId];
    return room.status !== 'error' ? room.rows[0]?.timestamps.last_seen_at ?? null : null;
  };
  return sources.map((source) => {
    const prior = timestamp(previous, source);
    const latest = timestamp(current, source);
    const result = current.status === 'complete'
      ? source.statusId === null ? current.readings.main : current.rooms[source.statusId] : null;
    const flow = current.status === 'complete' ? current.readings[source.deviceId] : null;
    return {
      name: source.name, source: source.statusId === null ? 'flow_readings.received_at' : 'room_status.last_seen_at',
      previous: prior, current: latest,
      change: !result || result.status === 'error' ? 'error' as const : timestampChange(prior, latest, now),
      latestFlow: flow && flow.status !== 'error' ? flow.rows[0]?.received_at ?? null : null,
    };
  });
}
