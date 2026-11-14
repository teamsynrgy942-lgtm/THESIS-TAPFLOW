import { formatVolume } from '../../features/dashboard/dashboard-model';
import type { WaterInlet } from '../../features/dashboard/dashboard-model';
import './MainWaterInletCard.css';

export function MainWaterInletCard({ inlet }: { inlet: WaterInlet }) {
  return (
    <section className="inlet-card" aria-labelledby="inlet-title">
      <div className="inlet-card__description">
        <span className="dashboard-symbol" aria-hidden="true">♢</span>
        <div><h3 id="inlet-title">Main water inlet</h3><p>{inlet.currentFlow > 0 ? 'Flow detected' : 'No flow detected'}</p></div>
      </div>
      <div className="inlet-card__metric" aria-live="polite" aria-atomic="true">
        <span className="metric-label">Current flow</span>
        <p><strong>{inlet.currentFlow.toFixed(2)}</strong><span>L/min</span></p>
      </div>
      <div className="inlet-card__metric" aria-live="polite" aria-atomic="true">
        <span className="metric-label">Total volume today</span>
        <p><strong>{formatVolume(inlet.totalVolumeToday)}</strong><span>L</span></p>
      </div>
    </section>
  );
}
