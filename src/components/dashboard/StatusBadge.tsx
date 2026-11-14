import type { ReactNode } from 'react';

type BadgeTone = 'idle' | 'success' | 'warning' | 'offline';

export function StatusBadge({ children, tone = 'idle' }: { children: ReactNode; tone?: BadgeTone }) {
  return <span className={`status-badge status-badge--${tone}`}>{children}</span>;
}
