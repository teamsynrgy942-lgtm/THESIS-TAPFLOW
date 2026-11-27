import type { LatestRecord } from '../overview/overview-telemetry';
import type { FlowReading, PulseChartWindow, QueryResult, RoomStatus, RoomTelemetryReport } from '../telemetry/telemetry-types';

export interface RoomTelemetry {
  readings: LatestRecord<readonly FlowReading[]>;
  chartReadings: LatestRecord<readonly FlowReading[]>;
  chartWindow: PulseChartWindow | null;
  status: LatestRecord<RoomStatus>;
  checkedAt: string | null;
}

export function createRoomTelemetry(): RoomTelemetry {
  return {
    readings: { value: null, loaded: false, error: null },
    chartReadings: { value: null, loaded: false, error: null },
    chartWindow: null,
    status: { value: null, loaded: false, error: null },
    checkedAt: null,
  };
}

function applyResult<T, R>(previous: LatestRecord<R>, result: QueryResult<T>, select: (rows: T[]) => R | null): LatestRecord<R> {
  if (result.status !== 'error') return { value: select(result.rows), loaded: true, error: null };
  const clear = result.error.kind === 'authentication' || result.error.kind === 'permission';
  return { value: clear ? null : previous.value, loaded: true, error: result.error };
}

export function applyRoomTelemetryReport(previous: RoomTelemetry, report: RoomTelemetryReport, window?: PulseChartWindow): RoomTelemetry {
  const failed: QueryResult<never> = report.status === 'blocked'
    ? { status: 'error', error: report.error } : { status: 'empty', rows: [] };
  const sameRange = !window || (previous.chartWindow && previous.chartWindow.end - previous.chartWindow.start === window.end - window.start);
  return {
    readings: applyResult(previous.readings, report.status === 'complete' ? report.readings : failed, (rows) => rows),
    chartReadings: applyResult(sameRange ? previous.chartReadings : createRoomTelemetry().chartReadings, report.status === 'complete' ? report.chart : failed, (rows) => rows),
    chartWindow: window ?? previous.chartWindow,
    status: applyResult(previous.status, report.status === 'complete' ? report.room : failed, (rows) => rows[0] ?? null),
    checkedAt: report.checkedAt,
  };
}

export function latestRoomReading(telemetry: RoomTelemetry): LatestRecord<FlowReading> {
  return { ...telemetry.readings, value: telemetry.readings.value?.[0] ?? null };
}

export function pulseChartSamples(readings: readonly FlowReading[]) {
  return readings.flatMap((reading) => {
    const timestamp = reading.received_at ? Date.parse(reading.received_at) : NaN;
    return reading.pulses != null && Number.isFinite(reading.pulses) && reading.pulses >= 0 && Number.isFinite(timestamp)
      ? [{ reading, timestamp, pulses: reading.pulses }] : [];
  }).sort((a, b) => a.timestamp - b.timestamp);
}

export const pulseChartRanges = [
  { id: '5m', label: 'Last 5 minutes', milliseconds: 5 * 60_000 },
  { id: '30m', label: 'Last 30 minutes', milliseconds: 30 * 60_000 },
  { id: '1h', label: 'Last 1 hour', milliseconds: 60 * 60_000 },
  { id: '24h', label: 'Last 24 hours', milliseconds: 24 * 60 * 60_000 },
] as const;
export type PulseChartRange = typeof pulseChartRanges[number]['id'];
export const PULSE_SAMPLE_MS = 15_000;
export const PULSE_GAP_MS = 45_000;

export function pulseChartWindow(range: PulseChartRange, now: number): PulseChartWindow {
  const duration = pulseChartRanges.find((option) => option.id === range)!.milliseconds;
  return { start: now - duration, end: now };
}

export function buildPulseChart(readings: readonly FlowReading[], window: PulseChartWindow) {
  const inWindow = readings.filter((reading) => {
    const timestamp = reading.received_at ? Date.parse(reading.received_at) : NaN;
    return timestamp >= window.start && timestamp <= window.end;
  });
  const expectedInterval = inWindow.filter((reading) => reading.sample_ms === PULSE_SAMPLE_MS);
  const samples = pulseChartSamples(expectedInterval);
  const segments: (typeof samples)[] = [];
  for (const sample of samples) {
    const previous = segments.at(-1)?.at(-1);
    const gap = previous ? sample.timestamp - previous.timestamp : Infinity;
    // Equal receipt times remain separate points rather than implying a vertical flow change.
    if (!previous || gap > PULSE_GAP_MS || gap <= 0) segments.push([sample]);
    else segments[segments.length - 1].push(sample);
  }
  return {
    samples, segments,
    otherIntervals: inWindow.length - expectedInterval.length,
    invalidSamples: expectedInterval.length - samples.length,
  };
}

const pulseTimeFormatters = {
  tooltip: new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }),
  short: new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
  day: new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
};

export function formatPulseTimestamp(timestamp: number, axisRange?: PulseChartRange): string {
  const formatter = !axisRange ? pulseTimeFormatters.tooltip : axisRange === '24h' ? pulseTimeFormatters.day : pulseTimeFormatters.short;
  return formatter.format(new Date(timestamp)) + (!axisRange ? ' PHT' : '');
}
