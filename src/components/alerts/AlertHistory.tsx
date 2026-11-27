import { useId, useRef, useState } from 'react';
import type { AlertRecord } from '../../features/alerts/alert-model';
import type { ResolutionCapability } from '../../features/alerts/incident-resolution';
import { IncidentResolutionError } from '../../features/alerts/incident-resolution';
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

type AlertFilter = 'all' | 'active' | 'resolved';

export function AlertHistory({ records, rooms, loading, error, liveIssue, onRetry, resolution = 'unknown', onResolve }: {
  records: readonly AlertRecord[];
  rooms: readonly Room[];
  loading: boolean;
  error: string | null;
  liveIssue?: LiveIssue;
  onRetry: () => void;
  resolution?: ResolutionCapability;
  onResolve?: (alertId: string, remarks: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState<AlertFilter>('all');
  const newestFirst = orderAlertRecords(records);
  const activeRecords = newestFirst.filter(({ status }) => status === 'active');
  const orderedRecords = [...activeRecords, ...newestFirst.filter(({ status }) => status === 'resolved')];
  const visibleRecords = orderedRecords.filter((record) => filter === 'all' || record.status === filter);
  const showSeverity = records.some((record) => record.severity != null);
  const canResolve = resolution === 'ready' && onResolve != null;

  return (
    <section className="alert-history" aria-labelledby="alert-history-title">
      <header className="alert-history__header">
        <h2 id="alert-history-title">Alert log</h2>
        <div className="alert-history__tools">
          {activeRecords.length > 0 && <AlertBadge tone="warning">{activeRecords.length} active</AlertBadge>}
          <div className="alert-history__filters" role="radiogroup" aria-label="Alert status">
            {(['all', 'active', 'resolved'] as const).map((value) => <label key={value}>
              <input type="radio" name="alert-status-filter" value={value} checked={filter === value} onChange={() => setFilter(value)} />
              {value === 'all' ? 'All' : value === 'active' ? 'Active' : 'Resolved'}
            </label>)}
          </div>
        </div>
      </header>
      {resolution === 'unavailable' && <p className="alert-history__connection">
        Mark as Resolved is not available until the reviewed database function is deployed. Active incidents stay in this log.
      </p>}
      {error && <div className="alert-history__notice">
        <p role="alert">{error}{records.length > 0 && ' Showing last known records.'}</p>
        <button type="button" onClick={onRetry}>Retry</button>
      </div>}
      {liveIssue && <p className="alert-history__connection" role="status">
        {liveIssueText[liveIssue]} Checking for changes every 15 seconds.
      </p>}
      {loading && <p className="alert-history__connection" role="status">Loading alerts…</p>}
      {visibleRecords.length ? (
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
              {visibleRecords.map((record) => <AlertHistoryRow key={record.id} record={record} rooms={rooms} showSeverity={showSeverity} canResolve={canResolve} onResolve={onResolve} />)}
            </tbody>
          </table>
        </div>
      ) : !loading && !error && (orderedRecords.length
        ? <p className="alert-history__connection">No {filter} alerts in this log.</p>
        : <AlertEmptyState />)}
    </section>
  );
}

function AlertHistoryRow({ record, rooms, showSeverity, canResolve, onResolve }: {
  record: AlertRecord; rooms: readonly Room[]; showSeverity: boolean; canResolve: boolean;
  onResolve?: (alertId: string, remarks: string) => Promise<void>;
}) {
  const active = record.status === 'active';
  const dialogRef = useRef<HTMLDialogElement>(null);
  const remarksId = useId();
  const [remarks, setRemarks] = useState('');
  const [pending, setPending] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
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
        {active && canResolve && <button type="button" className="alert-history__resolve" onClick={() => {
          setResolveError(null);
          dialogRef.current?.showModal();
        }}>Mark as Resolved</button>}
        {active && canResolve && <dialog ref={dialogRef} className="resolve-dialog" aria-labelledby={`${remarksId}-title`}>
          <form onSubmit={async (event) => {
            event.preventDefault();
            if (pending || !onResolve) return;
            setPending(true);
            setResolveError(null);
            try {
              await onResolve(record.id, remarks);
              dialogRef.current?.close();
              setRemarks('');
            } catch (caught) {
              setResolveError(caught instanceof IncidentResolutionError
                ? caught.message : 'The incident could not be resolved.');
            } finally {
              setPending(false);
            }
          }}>
            <h3 id={`${remarksId}-title`}>Mark this incident as resolved?</h3>
            <p>This records a staff acknowledgement. It does not prove the sensor condition has returned to normal.</p>
            <label htmlFor={remarksId}>Resolution remarks (optional)</label>
            <textarea id={remarksId} maxLength={500} value={remarks} onChange={(event) => setRemarks(event.target.value)} />
            {resolveError && <p role="alert">{resolveError}</p>}
            <div className="resolve-dialog__actions">
              <button type="button" onClick={() => dialogRef.current?.close()} disabled={pending}>Cancel</button>
              <button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Confirm resolution'}</button>
            </div>
          </form>
        </dialog>}
      </td>
    </tr>
  );
}

function AlertEmptyState() {
  return (
    <div className="alert-empty">
      <span className="alert-empty__icon"><AlertIcon name="empty" /></span>
      <h3>No alert records yet</h3>
      <p>No alert records are visible to this signed-in account.</p>
    </div>
  );
}
