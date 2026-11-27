import { useDashboardState } from '../../features/dashboard/DashboardProvider';
import { AlertHistory } from '../../components/alerts/AlertHistory';
import { resolveTapflowIncident, useResolveCapability } from '../../features/alerts/incident-resolution';
import './AlertsPage.css';

export function AlertsPage() {
  const { alertRecords, rooms, alertFeed } = useDashboardState();
  const resolution = useResolveCapability();

  return (
    <>
      <header className="dashboard-page-header alerts-page-header">
        <div><h1>Alerts</h1><p>Water flow anomalies and their status.</p></div>
      </header>
      <AlertHistory records={alertRecords} rooms={rooms} loading={alertFeed.loading} error={alertFeed.error}
        liveIssue={alertFeed.connection.status === 'unavailable' ? alertFeed.connection.reason : undefined}
        onRetry={alertFeed.refreshAlerts} resolution={resolution}
        onResolve={async (alertId, remarks) => {
          await resolveTapflowIncident(alertId, remarks);
          alertFeed.refreshAlerts();
        }} />
    </>
  );
}
