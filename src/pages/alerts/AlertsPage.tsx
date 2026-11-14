import { useDashboardState } from '../../features/dashboard/DashboardProvider';
import { AlertSummary } from '../../components/alerts/AlertSummary';
import { AlertHistory } from '../../components/alerts/AlertHistory';
import { AlertIcon } from '../../components/alerts/AlertIcon';
import { RoomDetailBadge } from '../../components/room-details/RoomDetailBadge';
import { getMonitoringLabel, summarizeAlertRecords } from '../../features/alerts/alert-model';
import './AlertsPage.css';

export function AlertsPage() {
  const { alertRecords, rooms, monitoringStatus } = useDashboardState();
  const counts = summarizeAlertRecords(alertRecords);

  return (
    <>
      <header className="dashboard-page-header alerts-page-header">
        <div><h1>Alerts</h1><p>Review water-flow anomalies and their resolution status.</p></div>
        <RoomDetailBadge tone="unknown">{getMonitoringLabel(monitoringStatus)}</RoomDetailBadge>
      </header>
      <AlertSummary active={counts.active} resolved={counts.resolved} />
      <AlertHistory records={alertRecords} rooms={rooms} monitoringStatus={monitoringStatus} />
      <p className="alerts-footnote"><AlertIcon name="info" /><span>The alert log will show detected events and recorded resolutions when data is available.</span></p>
    </>
  );
}
