import type { AlertRecord } from '../../features/alerts/alert-model';
import type { R1RealtimeState } from '../../features/alerts/r1-alert-realtime';
import type { Room } from '../../features/dashboard/dashboard-model';
import { formatAlertTimestamp, getAlertTargetLabel, orderAlertRecords } from '../../features/alerts/alert-model';
import { AlertBadge, AlertSeverityBadge } from './AlertBadge';
import { AlertIcon } from './AlertIcon';

type LiveIssue = Extract<R1RealtimeState, { status: 'unavailable' }>['reason'];

const liveIssueText: Record<LiveIssue, string> = {
  publication: 'This table is not enabled for Realtime.',
  access: 'Supabase denied the live alert subscription.',
  timeout: 'The live alert subscription timed out.',
  channel: 'Supabase could not subscribe to live alert changes.',
  closed: 'The live alert connection closed.',
};

export function AlertHistory({ records, rooms, loading, error, liveIssue, onRetry }: {
  records: readonly AlertRecord[];
  rooms: readonly Room[];
  loading: boolean;
  error: string | null;
  liveIssue?: LiveIssue;
  onRetry: () => void;
}) {
  const newestFirst = orderAlertRecords(records);
  const activeRecords = newestFirst.filter(({ status }) => status === 'active');
  const orderedRecords = [...activeRecords, ...newestFirst.filter(({ status }) => status === 'resolved')];
  const showSeverity = records.some((record) => record.severity != null);

  return (
    <section className="alert-history" aria-labelledby="alert-history-title">
      <header className="alert-history__header">
        <h2 id="alert-history-title">Alert log</h2>
        {activeRecords.length > 0 && <AlertBadge tone="warning">{activeRecords.length} active</AlertBadge>}
      </header>
      {error && <div className="alert-history__notice">
        <p role="alert">{error}{records.length > 0 && ' Showing last known records.'}</p>
        <button type="button" onClick={onRetry}>Retry</button>
      </div>}
      {liveIssue && <p className="alert-history__connection" role="status">
        {liveIssueText[liveIssue]} Checking for changes every 15 seconds.
      </p>}
      {loading && <p className="alert-history__connection" role="status">Loading alerts…</p>}
      {orderedRecords.length ? (
        <div className="alert-history__scroll" role="region" aria-label="Alert history table" tabIndex={0}>
          <table className={`alert-history__table${showSeverity ? ' alert-history__table--with-severity' : ''}`} aria-label="Alert history">
            <colgroup><col /><col />{showSeverity && <col />}<col /><col /></colgroup>
            <thead>
              <tr>
                <th scope="col">Anomaly or rule</th>
                <th scope="col">Affected room</th>
                {showSeverity && <th scope="col">Severity</th>}
                <th scope="col">Detected (PHT)</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {orderedRecords.map((record) => <AlertHistoryRow key={record.id} record={record} rooms={rooms} showSeverity={showSeverity} />)}
            </tbody>
          </table>
        </div>
      ) : !loading && !error && <AlertEmptyState />}
    </section>
  );
}

function AlertHistoryRow({ record, rooms, showSeverity }: { record: AlertRecord; rooms: readonly Room[]; showSeverity: boolean }) {
  const active = record.status === 'active';
  return (
    <tr data-alert-id={record.id} className={active ? 'alert-history__row--active' : undefined}>
      <th scope="row">
        <span>{record.title ?? record.detectionRule}</span>
        {record.title && <code className="alert-history__code">{record.detectionRule}</code>}
        {record.description && <p className="alert-history__description">{record.description}</p>}
        {!!record.evidence?.length && <details className="alert-history__evidence">
          <summary>Recorded evidence</summary>
          <dl>
            {record.evidence?.map(({ label, value, dateTime }) => <div key={label}>
              <dt>{label}</dt><dd>{dateTime ? <time dateTime={dateTime}>{value}</time> : value}</dd>
            </div>)}
          </dl>
        </details>}
      </th>
      <td>{getAlertTargetLabel(record.target, rooms)}</td>
      {showSeverity && <td>{record.severity ? <AlertSeverityBadge severity={record.severity} /> : 'Unspecified'}</td>}
      <td><time dateTime={record.timestamp}>{formatAlertTimestamp(record.timestamp)}</time></td>
      <td>
        <AlertBadge tone={active ? 'warning' : 'resolved'}>{active ? 'Active' : 'Resolved'}</AlertBadge>
        {!active && record.resolvedAt && <span className="alert-history__resolved">
          Resolved at <time dateTime={record.resolvedAt}>{formatAlertTimestamp(record.resolvedAt)} PHT</time>
        </span>}
      </td>
    </tr>
  );
}

function AlertEmptyState() {
  return (
    <div className="alert-empty">
      <span className="alert-empty__icon"><AlertIcon name="empty" /></span>
      <h3>No alert records yet</h3>
      <p>No R1 alert records are visible to this signed-in account.</p>
    </div>
  );
}
