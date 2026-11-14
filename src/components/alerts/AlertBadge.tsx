import type { ReactNode } from 'react';
import type { AlertSeverity } from '../../features/alerts/alert-model';
import { severityLabels } from '../../features/alerts/alert-model';

export function AlertBadge({ children, tone }: {
  children: ReactNode; tone: AlertSeverity | 'resolved' | 'neutral';
}) {
  return <span className={`alert-badge alert-badge--${tone}`}><span aria-hidden="true" />{children}</span>;
}

export function AlertSeverityBadge({ severity }: { severity: AlertSeverity }) {
  return <AlertBadge tone={severity}>{severityLabels[severity]}</AlertBadge>;
}
