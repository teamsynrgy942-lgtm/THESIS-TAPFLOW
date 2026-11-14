import type { AlertRecord, MonitoringStatus } from '../../features/alerts/alert-model';
import type { Room } from '../../features/dashboard/dashboard-model';
import { formatAlertMeasurement, formatAlertTimestamp, getAlertTargetLabel, orderAlertRecords } from '../../features/alerts/alert-model';
import { AlertBadge, AlertSeverityBadge } from './AlertBadge';
import { AlertIcon } from './AlertIcon';

export function AlertHistory({ records, rooms, monitoringStatus }: {
  records: readonly AlertRecord[]; rooms: readonly Room[]; monitoringStatus: MonitoringStatus;
}) {
  const orderedRecords = orderAlertRecords(records);

  return (
    <section className="alert-history" aria-labelledby="alert-history-title">
      <header className="alert-history__header"><div>
        <h2 id="alert-history-title">Alert log</h2>
        <p>Alert records across all three rooms and the main inlet.</p>
      </div></header>
      <div className="alert-history__scroll" role="region" aria-label="Alert history table" tabIndex={0}>
        <table className="alert-history__table" aria-label="Alert history" aria-describedby={orderedRecords.length ? undefined : 'alert-empty-description'}>
          <colgroup><col /><col /><col /><col /><col /></colgroup>
          <thead><tr><th scope="col">Severity</th><th scope="col">Affected room</th><th scope="col">Rule or anomaly</th><th scope="col">Detected (PHT)</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {orderedRecords.map((record) => <AlertHistoryRow key={record.id} record={record} rooms={rooms} />)}
          </tbody>
        </table>
      </div>
      {orderedRecords.length === 0 && <AlertEmptyState monitoringStatus={monitoringStatus} />}
      <footer className="alert-history__footer">
        <span>{records.length} alert {records.length === 1 ? 'record' : 'records'}</span>
        <div className="alert-severity-key" aria-label="Severity key">
          <span>Severity key</span>
          {(['info', 'warning', 'critical', 'emergency'] as const).map((severity) => <AlertSeverityBadge key={severity} severity={severity} />)}
        </div>
      </footer>
    </section>
  );
}

function AlertHistoryRow({ record, rooms }: { record: AlertRecord; rooms: readonly Room[] }) {
  const measured = formatAlertMeasurement(record.measuredValue, record.unit);
  const threshold = formatAlertMeasurement(record.threshold, record.unit);
  return (
    <tr>
      <td><AlertSeverityBadge severity={record.severity} /></td>
      <td><span>{getAlertTargetLabel(record.target, rooms)}</span>{record.deviceId && <small>Device: {record.deviceId}</small>}</td>
      <td><strong className="alert-history__rule">{record.detectionRule}</strong>{record.message && <small>{record.message}</small>}
        {(measured !== null || threshold !== null) && <small>{[measured !== null ? `Measured: ${measured}` : '', threshold !== null ? `Threshold: ${threshold}` : ''].filter(Boolean).join(' · ')}</small>}
      </td>
      <td><time dateTime={record.timestamp}>{formatAlertTimestamp(record.timestamp)}</time></td>
      <td><AlertBadge tone={record.status === 'resolved' ? 'resolved' : 'warning'}>{record.status === 'resolved' ? 'Resolved' : 'Active'}</AlertBadge></td>
    </tr>
  );
}

function AlertEmptyState({ monitoringStatus }: { monitoringStatus: MonitoringStatus }) {
  return (
    <div className="alert-empty">
      <span className="alert-empty__icon"><AlertIcon name="empty" /></span>
      <h3>No alert records yet</h3>
      <p id="alert-empty-description">{monitoringStatus === 'inactive' ? 'Monitoring not yet active. No detection results are available.' : 'Alert records will appear when reported by the monitoring subsystem.'}</p>
    </div>
  );
}
