import type { AlertEvidenceItem } from '../../features/alerts/alert-model';

export function AlertEvidence({ evidence, className }: {
  evidence?: readonly AlertEvidenceItem[];
  className: string;
}) {
  if (!evidence?.length) return null;

  return <details className={className}>
    <summary>Recorded evidence</summary>
    <dl>
      {evidence.map(({ label, value, dateTime }) => <div key={label}>
        <dt>{label}</dt><dd>{dateTime ? <time dateTime={dateTime}>{value}</time> : value}</dd>
      </div>)}
    </dl>
  </details>;
}
