import { useDashboardState } from '../../features/dashboard/DashboardProvider';
import { AlertHistory } from '../../components/alerts/AlertHistory';
import './AlertsPage.css';

export function AlertsPage() {
  const { alertRecords, rooms, alertFeed } = useDashboardState();

  return (
    <>
      <header className="dashboard-page-header alerts-page-header">
        <div><h1>Alerts</h1><p>Water flow anomalies and their status.</p></div>
      </header>
      <AlertHistory records={alertRecords} rooms={rooms} loading={alertFeed.loading} error={alertFeed.error}
        liveIssue={alertFeed.connection.status === 'unavailable' ? alertFeed.connection.reason : undefined}
        onRetry={alertFeed.refreshAlerts} canResolve={alertFeed.canResolve} onResolve={alertFeed.resolveAlert} />
    </>
  );
}
