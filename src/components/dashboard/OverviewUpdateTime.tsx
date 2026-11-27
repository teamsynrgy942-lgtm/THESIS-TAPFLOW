import { useOverviewTelemetry } from '../../features/overview/OverviewTelemetryProvider';
import { formatUpdateTime } from '../../features/dashboard/dashboard-model';

export function OverviewUpdateTime() {
  const { telemetry, refreshing } = useOverviewTelemetry();
  return <time className="overview-check-time" dateTime={telemetry.checkedAt ?? undefined} aria-live="polite">
    {refreshing ? 'Refreshing readings…' : telemetry.checkedAt ? `Last checked ${formatUpdateTime(telemetry.checkedAt)}` : 'Awaiting readings'}
  </time>;
}
