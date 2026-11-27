import { useEffect, useId, useRef, useState } from 'react';
import type { AlertRecord } from '../../features/alerts/alert-model';
import type { R1RealtimeState } from '../../features/alerts/r1-alert-realtime';
import type { Room } from '../../features/dashboard/dashboard-model';
import { formatAlertTimestamp, getAlertTargetLabel, orderAlertRecords } from '../../features/alerts/alert-model';
import { R1_ALERT_CODE } from '../../features/alerts/r1-alert-model';
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

export function AlertHistory({ records, rooms, loading, error, liveIssue, onRetry, canResolve = false, onResolve }: {
  records: readonly AlertRecord[];
  rooms: readonly Room[];
  loading: boolean;
  error: string | null;
  liveIssue?: LiveIssue;
  onRetry: () => void;
  canResolve?: boolean;
  onResolve?: (id: string, remark: string | null) => Promise<void>;
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
              {orderedRecords.map((record) => <AlertHistoryRow key={record.id} record={record} rooms={rooms}
                showSeverity={showSeverity} canResolve={canResolve} onResolve={onResolve} />)}
            </tbody>
          </table>
        </div>
      ) : !loading && !error && <AlertEmptyState />}
    </section>
  );
}

function AlertHistoryRow({ record, rooms, showSeverity, canResolve, onResolve }: {
  record: AlertRecord;
  rooms: readonly Room[];
  showSeverity: boolean;
  canResolve: boolean;
  onResolve?: (id: string, remark: string | null) => Promise<void>;
}) {
  const active = record.status === 'active';
  const [pending, setPending] = useState(false);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [resolutionSucceeded, setResolutionSucceeded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [remark, setRemark] = useState('');
  const pendingRef = useRef(false);
  const mounted = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const dialogId = useId();
  const mayResolve = active && canResolve && !!onResolve && record.detectionRule === R1_ALERT_CODE;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (confirming && mayResolve) {
      if (!dialog.current?.open) dialog.current?.showModal();
    } else {
      dialog.current?.close();
    }
  }, [confirming, mayResolve]);

  async function resolve() {
    if (pendingRef.current || !confirming || !mayResolve || !onResolve) return;
    pendingRef.current = true;
    setPending(true);
    setResolutionError(null);
    setResolutionSucceeded(false);
    try {
      await onResolve(record.id, remark.trim() || null);
      if (mounted.current) {
        setResolutionSucceeded(true);
        setConfirming(false);
      }
    } catch (error) {
      if (mounted.current) setResolutionError(error instanceof Error ? error.message : 'This incident could not be resolved. Try again.');
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(false);
    }
  }
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
      <td>
        <time dateTime={record.timestamp}>{formatAlertTimestamp(record.timestamp)}</time>
        {record.lastDetectedAt && <span className="alert-history__last-detected">
          Last detected <time dateTime={record.lastDetectedAt}>{formatAlertTimestamp(record.lastDetectedAt)} PHT</time>
        </span>}
      </td>
      <td>
        <div className="alert-history__status-actions">
          <AlertBadge tone={active ? 'warning' : 'resolved'}>{active ? 'Active' : 'Resolved'}</AlertBadge>
          {mayResolve && <button
            className="alert-history__resolve" type="button" disabled={pending} aria-busy={pending}
            onClick={() => { setResolutionError(null); setRemark(''); setConfirming(true); }}>
            {pending ? 'Resolving…' : 'Mark as Resolved'}
          </button>}
        </div>
        {!active && record.resolvedAt && <span className="alert-history__resolved">
          Resolved at <time dateTime={record.resolvedAt}>{formatAlertTimestamp(record.resolvedAt)} PHT</time>
        </span>}
        {!active && record.resolvedBy && <span className="alert-history__resolver">Resolved by {record.resolvedBy}</span>}
        {!active && record.resolutionRemark && <p className="alert-history__remark">Remark: {record.resolutionRemark}</p>}
        {resolutionError && !confirming && <p className="alert-history__resolution-error" role="alert">{resolutionError}</p>}
        {resolutionSucceeded && <p className="alert-history__resolution-success" role="status">Incident resolved.</p>}
        <dialog ref={dialog} className="alert-resolution-dialog" aria-labelledby={`${dialogId}-title`}
          aria-describedby={`${dialogId}-description`} onClose={() => setConfirming(false)}
          onCancel={(event) => { event.preventDefault(); if (!pendingRef.current) setConfirming(false); }}>
          <form onSubmit={(event) => { event.preventDefault(); void resolve(); }} aria-busy={pending}>
            <h2 id={`${dialogId}-title`}>Mark alert as resolved</h2>
            <p id={`${dialogId}-description`}>Resolve alert #{record.id} for {getAlertTargetLabel(record.target, rooms)}? The alert will remain in history.</p>
            <label htmlFor={`${dialogId}-remark`}>Remark (optional)</label>
            <textarea id={`${dialogId}-remark`} rows={3} maxLength={2000} autoFocus disabled={pending}
              value={remark} onChange={(event) => setRemark(event.target.value)} />
            {resolutionError && <p className="alert-history__resolution-error" role="alert">{resolutionError}</p>}
            <div className="alert-resolution-dialog__actions">
              <button type="button" disabled={pending} onClick={() => setConfirming(false)}>Cancel</button>
              <button type="submit" disabled={pending}>{pending ? 'Resolving…' : 'Mark as Resolved'}</button>
            </div>
          </form>
        </dialog>
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
