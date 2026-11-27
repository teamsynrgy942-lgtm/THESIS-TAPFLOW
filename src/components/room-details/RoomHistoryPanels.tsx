import { Link } from 'react-router';
import { formatAlertTimestamp, severityLabels } from '../../features/alerts/alert-model';
import type { AlertRecord } from '../../features/alerts/alert-model';
import { pulseChartWindow } from '../../features/rooms/room-telemetry';
import type { PulseChartRange, RoomTelemetry } from '../../features/rooms/room-telemetry';
import { formatTelemetryTime, telemetryErrorLabel } from '../../features/overview/overview-telemetry';
import { RoomPulseChart } from './RoomPulseChart';
import { RoomDetailPanel, RoomEmptyState } from './RoomDetailPanel';
import { RoomIcon } from './RoomIcon';
import { RoomDetailBadge } from './RoomDetailBadge';

export function WaterFlowPanel({ telemetry, now, chartRange, onChartRangeChange }: {
  telemetry: RoomTelemetry; now: number; chartRange: PulseChartRange; onChartRangeChange: (range: PulseChartRange) => void;
}) {
  const readings = telemetry.readings.value ?? [];
  const selectedWindow = pulseChartWindow(chartRange, now);
  const sameRange = telemetry.chartWindow && telemetry.chartWindow.end - telemetry.chartWindow.start === selectedWindow.end - selectedWindow.start;
  const chartReadings = sameRange ? telemetry.chartReadings : { value: null, loaded: false, error: null };

  return (
    <RoomDetailPanel id="room-flow-title" title="Water flow" className="rd-flow">
      <p className="rd-flow__note">Raw pulses per sample. Room sensors are not converted to liters.</p>
      <RoomPulseChart readings={chartReadings} now={now} range={chartRange} onRangeChange={onChartRangeChange} />
      {telemetry.readings.error && <p className="rd-sample-note rd-sample-note--error" role="alert">
        Recorded samples: {telemetryErrorLabel(telemetry.readings.error)}
        {readings.length > 0 && ' Last known records shown.'}
      </p>}
      {readings.length > 0 && <details className="rd-pulse-history">
        <summary>Recorded samples ({readings.length})</summary>
        <div className="rd-pulse-history__scroll" role="region" aria-label="Pulse sample history" tabIndex={0}>
          <table className="rd-pulse-history__table" aria-label="Recorded pulse measurements">
            <thead><tr><th scope="col">Received (PHT)</th><th scope="col">Pulses per sample</th><th scope="col">Interval (ms)</th></tr></thead>
            <tbody>{readings.map((reading, index) => <tr key={`${reading.id}-${index}`}>
              <td>{formatTelemetryTime(reading.received_at)}</td><td>{reading.pulses ?? 'Unavailable'}</td><td>{reading.sample_ms ?? 'Unavailable'}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </details>}
    </RoomDetailPanel>
  );
}

export function RelatedAlertsPanel({ alerts }: { alerts: readonly AlertRecord[] }) {
  return (
    <RoomDetailPanel id="room-alerts-title" title="Related alerts" className="rd-alerts" action={<Link className="rd-alerts-link" to="/alerts">View Alerts<RoomIcon name="arrowRight" /></Link>}>
      {alerts.length ? (
        <ul className="rd-records">
          {alerts.map((alert) => <li key={alert.id}>
            <RoomDetailBadge tone="warning">{alert.severity ? severityLabels[alert.severity] : 'Active'}</RoomDetailBadge>
            <div>
              <strong>{alert.title ?? alert.detectionRule}</strong>
              <code>{alert.detectionRule}</code>
              <time dateTime={alert.timestamp}>{formatAlertTimestamp(alert.timestamp)} PHT</time>
            </div>
          </li>)}
        </ul>
      ) : <RoomEmptyState icon="relatedAlerts" title="No recorded alerts" />}
    </RoomDetailPanel>
  );
}
