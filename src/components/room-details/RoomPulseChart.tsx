import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import type { DotItemDotProps } from 'recharts';
import type { LatestRecord } from '../../features/overview/overview-telemetry';
import { telemetryErrorLabel } from '../../features/overview/overview-telemetry';
import type { FlowReading } from '../../features/telemetry/telemetry-types';
import { buildPulseChart, formatPulseTimestamp, pulseChartRanges, pulseChartWindow } from '../../features/rooms/room-telemetry';
import type { PulseChartRange } from '../../features/rooms/room-telemetry';
import { RoomEmptyState } from './RoomDetailPanel';

type PulseSample = ReturnType<typeof buildPulseChart>['samples'][number];

type ChartPoint = { timestamp: number; pulses: null; sample: null }
  | { timestamp: number; pulses: number; sample: PulseSample; sampleIndex: number };

function sampleKey(sample: PulseSample) {
  return `${sample.reading.id}|${sample.timestamp}`;
}

export function RoomPulseChart({ readings, now, range, onRangeChange }: {
  readings: LatestRecord<readonly FlowReading[]>; now: number; range: PulseChartRange;
  onRangeChange: (range: PulseChartRange) => void;
}) {
  const plot = useRef<HTMLDivElement>(null);
  const rangeId = useId();
  const tooltipId = useId();
  const [activePoint, setActivePoint] = useState<{ key: string; x: number; y: number } | null>(null);
  const window = pulseChartWindow(range, now);
  const chart = useMemo(() => buildPulseChart(readings.value ?? [], pulseChartWindow(range, now)), [readings.value, range, now]);
  const points = useMemo(() => {
    const data: ChartPoint[] = [];
    let sampleIndex = 0;
    for (const segment of chart.segments) {
      if (data.length) {
        // An explicit null breaks the Recharts path, including between equal timestamps.
        data.push({ timestamp: segment[0].timestamp, pulses: null, sample: null });
      }
      for (const sample of segment) {
        data.push({ timestamp: sample.timestamp, pulses: sample.pulses, sample, sampleIndex: sampleIndex++ });
      }
    }
    return data;
  }, [chart]);
  const maximum = Math.max(2, Math.ceil(chart.samples.reduce((max, sample) => Math.max(max, sample.pulses), 0) / 2) * 2);
  const activeIndex = activePoint ? chart.samples.findIndex((sample) => sampleKey(sample) === activePoint.key) : -1;
  const active = chart.samples[activeIndex];

  useEffect(() => {
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!plot.current?.contains(event.target as Node)) setActivePoint(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);

  function navigate(event: KeyboardEvent<SVGCircleElement>, index: number, select: () => void) {
    if (event.key === 'Escape') { setActivePoint(null); return; }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); return; }
    const next = event.key === 'ArrowLeft' ? Math.max(0, index - 1)
      : event.key === 'ArrowRight' ? Math.min(chart.samples.length - 1, index + 1)
      : event.key === 'Home' ? 0 : event.key === 'End' ? chart.samples.length - 1 : null;
    if (next == null) return;
    event.preventDefault();
    event.currentTarget.ownerSVGElement?.querySelector<SVGCircleElement>(`[data-point-index="${next}"]`)?.focus();
  }

  function renderDot({ cx, cy, payload }: DotItemDotProps) {
    const point = payload as ChartPoint | undefined;
    if (!point?.sample || cx == null || cy == null) return null;
    // Recharts can render a previous data frame while a range change is settling.
    const { sample, sampleIndex: index } = point;
    const key = sampleKey(sample);
    const selected = key === activePoint?.key;
    const select = () => setActivePoint({ key, x: cx, y: cy });
    return <circle cx={cx} cy={cy} r={selected ? 5 : 3} fill="#09628d" stroke="transparent" strokeWidth={10} data-point-index={index}
      role="button" tabIndex={index === Math.max(0, activeIndex) ? 0 : -1}
      aria-label={`${formatPulseTimestamp(sample.timestamp)}, ${sample.pulses} pulses, ${sample.reading.sample_ms} ms measurement interval`}
      aria-describedby={selected ? tooltipId : undefined}
      onPointerEnter={select} onFocus={select} onBlur={() => setActivePoint(null)}
      onClick={select} onKeyDown={(event) => navigate(event, index, select)} />;
  }

  return <div className="rd-pulse-chart">
    <div className="rd-pulse-chart__controls">
      <p className="rd-pulse-chart__unit">Pulses per sample</p>
      <div className="rd-pulse-chart__range">
        <label htmlFor={rangeId}>Time range</label>
        <select id={rangeId} value={range} onChange={(event) => {
          const selected = pulseChartRanges.find((option) => option.id === event.target.value);
          if (selected) {
            setActivePoint(null);
            onRangeChange(selected.id);
          }
        }}>
          {pulseChartRanges.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </div>
    </div>
    {readings.error && <p className="rd-sample-note rd-sample-note--error" role="alert">
      Chart: {telemetryErrorLabel(readings.error)}{Boolean(readings.value?.length) && ' Last known records shown.'}
    </p>}
    <div ref={plot} className="rd-flow__plot" role="group" aria-label="Pulse history chart" aria-busy={!readings.loaded}>
      <div className="rd-flow__axis" aria-hidden="true"><span>{maximum}</span><span>{maximum / 2}</span><span>0</span></div>
      {chart.samples.length ? <div className="rd-flow__series"
        role="group" aria-label={`${chart.samples.length} pulse measurements; pulses per sample, by received timestamp`}>
        <ResponsiveContainer width="100%" height="100%" onResize={() => setActivePoint(null)}>
          <LineChart data={points} margin={{ top: 4, right: 4, bottom: 4, left: 4 }} accessibilityLayer={false}>
            <XAxis dataKey="timestamp" type="number" scale="linear" domain={[window.start, window.end]} allowDataOverflow hide />
            <YAxis type="number" domain={[0, maximum]} allowDataOverflow hide />
            <Line type="linear" dataKey="pulses" stroke="#09628d" strokeWidth={2} connectNulls={false}
              isAnimationActive={false} activeDot={false} dot={renderDot} />
          </LineChart>
        </ResponsiveContainer>
      </div> : <RoomEmptyState layout="center" icon="chartEmpty"
        title={!readings.loaded ? 'Loading pulse measurements…' : readings.error ? 'Pulse measurements unavailable' : 'No measurements during this period'} />}
      {active && activePoint && <div id={tooltipId} role="tooltip" className="rd-pulse-tooltip" style={{
        left: `max(4px, min(${activePoint.x + 8}px, 100% - 230px))`,
        top: `max(4px, min(${activePoint.y - 90}px, 100% - 96px))`,
      }}>
        <time dateTime={active.reading.received_at!}>{formatPulseTimestamp(active.timestamp)}</time>
        <span>Raw pulses: <strong>{active.pulses}</strong></span>
        <span>Measurement interval: <strong>{active.reading.sample_ms} ms</strong></span>
      </div>}
    </div>
    <div className="rd-pulse-chart__ticks" aria-label="Time axis in Philippine Time">
      {[window.start, (window.start + window.end) / 2, window.end].map((timestamp) =>
        <time key={timestamp} dateTime={new Date(timestamp).toISOString()}>{formatPulseTimestamp(timestamp, range)}</time>)}
    </div>
    <p className="rd-pulse-chart__caption">Philippine Time (PHT) · Gaps over 45 seconds are left blank.</p>
    {chart.otherIntervals > 0 && <p className="rd-sample-note">The chart uses 15-second samples. See recorded samples for other intervals.</p>}
    {chart.invalidSamples > 0 && <p className="rd-sample-note">Samples without valid pulse counts are excluded.</p>}
  </div>;
}
