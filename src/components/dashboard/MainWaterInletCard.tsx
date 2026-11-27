import type { FlowReading, MainConsumptionReport } from '../../features/telemetry/telemetry-types';
import type { LatestRecord } from '../../features/overview/overview-telemetry';
import { currentFlowDisplay, reportingFreshness, reportingLabel } from '../../features/overview/overview-telemetry';
import { getPhilippineDay } from '../../features/overview/main-consumption';
import { StatusBadge } from './StatusBadge';
import './MainWaterInletCard.css';

export function MainWaterInletCard({ reading, consumption, now }: {
  reading: LatestRecord<FlowReading>; consumption: MainConsumptionReport | null; now: number;
}) {
  const flow = currentFlowDisplay(reading, now);
  const label = !reading.loaded ? 'Loading…' : reading.error && !reading.value?.received_at ? 'Refresh failed' : reportingLabel(reading.value?.received_at, now);
  const tone = reading.error ? 'warning' : reportingFreshness(reading.value?.received_at, now) === 'recent' ? 'success' : 'idle';
  const today = consumption?.dayStart === getPhilippineDay(now).start ? consumption : null;
  const liters = today?.liters;
  return (
    <section className="inlet-card" aria-labelledby="inlet-title">
      <div className="inlet-card__description">
        <span className="dashboard-symbol" aria-hidden="true">♢</span>
        <div><h2 id="inlet-title">Main water inlet</h2><StatusBadge tone={tone}>{label}</StatusBadge></div>
      </div>
      <div className="inlet-card__metric" aria-live="polite" aria-atomic="true">
        <span className="metric-label">Current flow</span>
        <p><strong className={!flow.unit ? 'inlet-card__unavailable' : undefined}>{flow.value}</strong>{flow.unit && <span>{flow.unit}</span>}</p>
      </div>
      <div className="inlet-card__metric" aria-live="polite" aria-atomic="true">
        <span className="metric-label">Water Used Today</span>
        <p>
          <strong className={liters == null ? 'inlet-card__unavailable' : undefined}>
            {liters == null ? today ? 'Unavailable' : 'Loading…' : liters.toFixed(2)}
          </strong>
          {liters != null && <span>L</span>}
        </p>
        {liters != null && today?.incomplete && <small className="inlet-card__note">Incomplete total</small>}
        {liters == null && today?.error && <small className="inlet-card__note">Readings could not be loaded</small>}
      </div>
    </section>
  );
}
