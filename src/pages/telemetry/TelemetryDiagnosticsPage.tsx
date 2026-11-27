import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../features/auth/AuthProvider';
import { deviceIds, readTelemetry, roomIds } from '../../features/telemetry/telemetry-service';
import type { QueryResult, TelemetryError, TelemetryReport } from '../../features/telemetry/telemetry-service';
import { observeReportingTimestamps, timestampChangeLabels } from '../../features/telemetry/heartbeat-observation';
import { REFRESH_INTERVAL_MS } from '../../features/overview/overview-telemetry';
import './TelemetryDiagnosticsPage.css';

const errorLabels: Record<TelemetryError['kind'], string> = {
  authentication: 'Missing or expired authentication session',
  permission: 'Permission denied / access restriction',
  network: 'Network error',
  configuration: 'Configuration or schema error',
  database: 'Database error',
};

function ErrorDetails({ error }: { error: TelemetryError }) {
  return <div className="telemetry-error" role="alert">
    <strong>{errorLabels[error.kind]}</strong>
    <p>Code: <code>{error.code}</code> — {error.message}</p>
    {error.kind === 'permission' && <p>SELECT grants or RLS policies may restrict this account. No permissions were changed.</p>}
    {error.kind === 'authentication' && <p>Sign out, then sign in again with your authorized dashboard account.</p>}
  </div>;
}

function QueryOutput<T>({ result }: { result: QueryResult<T> }) {
  if (result.status === 'error') return <ErrorDetails error={result.error} />;
  return <>
    <p role="status">{result.status === 'records' ? `Success — ${result.rows.length} record(s) retrieved.` : 'Success — zero visible rows.'}</p>
    {result.status === 'empty'
      ? <p>No matching records are visible to this account. Records may be absent or filtered by RLS; an empty result cannot distinguish these cases.</p>
      : <pre tabIndex={0} aria-label="Retrieved records">{JSON.stringify(result.rows, null, 2)}</pre>}
  </>;
}

export default function TelemetryDiagnosticsPage() {
  const { session, signOut } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [report, setReport] = useState<TelemetryReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [observing, setObserving] = useState(false);
  const previousReport = useRef<TelemetryReport | null>(null);
  const [observations, setObservations] = useState<ReturnType<typeof observeReportingTimestamps>>([]);

  useEffect(() => {
    if (!observing || isLoading) return;
    const timer = window.setInterval(() => setAttempt((value) => value + 1), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [observing, isLoading]);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setReport(null);
    void readTelemetry(controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setReport(result);
        setObservations(observeReportingTimestamps(previousReport.current, result, Date.now()));
        if (result.status === 'complete') previousReport.current = result;
      }
    }).catch(() => {
      if (!controller.signal.aborted) setReport({
        status: 'blocked', checkedAt: new Date().toISOString(),
        error: { kind: 'network', code: 'REQUEST_FAILED', message: 'The diagnostic could not complete. Check your connection and retry.' },
      });
    }).finally(() => {
      if (!controller.signal.aborted) setIsLoading(false);
    });
    return () => controller.abort();
  }, [attempt, session?.user.id]);

  return <main className="telemetry-page">
    <header>
      <Link to="/overview">Back to Overview</Link>
      <h1>Telemetry diagnostics</h1>
      <p>Development only · Read-only · Latest five readings per device</p>
      <p>Flow values are shown exactly as stored. <code>null</code> means no flow rate was supplied; no pulses are converted to L/min or liters.</p>
      <div className="telemetry-actions">
        <button type="button" onClick={() => setAttempt((value) => value + 1)} disabled={isLoading}>{isLoading ? 'Checking…' : 'Refresh readings'}</button>
        <button type="button" onClick={() => void signOut()}>Sign out</button>
      </div>
      <label><input type="checkbox" checked={observing} onChange={(event) => setObserving(event.target.checked)} /> Observe reporting timestamps every 20 seconds</label>
    </header>
    {isLoading && <p role="status">Verifying the signed-in user and reading telemetry…</p>}
    {report && <>
      <p>Checked: <time dateTime={report.checkedAt}>{report.checkedAt}</time></p>
      {report.status === 'blocked' ? <>
        <ErrorDetails error={report.error} />
        <p>No telemetry queries were run. All four devices and rooms 1–3 remain unverified.</p>
      </> : <>
        <p role="status">Signed-in user verified with Supabase Auth.</p>
        <section aria-labelledby="reporting-timestamp-checks-title">
          <h2 id="reporting-timestamp-checks-title">Reporting timestamp checks</h2>
          <p>Compare successive reads while the ESP32 sends reports. A flow upload does not establish that a room heartbeat changed. An advancing timestamp does not confirm physical connectivity.</p>
          <div className="telemetry-observations" tabIndex={0}>
            <table aria-label="Reporting timestamp observations">
              <thead><tr><th>Device</th><th>Source</th><th>Previous timestamp</th><th>Current timestamp</th><th>Observation</th><th>Latest flow receipt</th></tr></thead>
              <tbody>{observations.map((observation) => <tr key={observation.name}>
                <th scope="row">{observation.name}</th><td>{observation.source}</td>
                <td>{observation.previous ?? 'Unavailable'}</td><td>{observation.current ?? 'Unavailable'}</td>
                <td>{timestampChangeLabels[observation.change]}</td><td>{observation.latestFlow ?? 'Unavailable'}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </section>
        {deviceIds.map((id) => <section key={id} aria-labelledby={`flow-${id}`}>
          <h2 id={`flow-${id}`}>Flow readings: {id}</h2>
          <QueryOutput result={report.readings[id]} />
        </section>)}
        {roomIds.map((id) => <section key={id} aria-labelledby={`status-${id}`}>
          <h2 id={`status-${id}`}>Room status: {id}</h2>
          <QueryOutput result={report.rooms[id]} />
        </section>)}
        <p>Room status includes available update timestamps returned for visible rows. Empty results do not reveal timestamp columns.</p>
      </>}
    </>}
  </main>;
}
