import type { ReactNode } from 'react';

export function RoomDetailBadge({ children, tone = 'idle' }: {
  children: ReactNode;
  tone?: 'idle' | 'unknown' | 'demo' | 'success' | 'warning';
}) {
  return <span className={`rd-badge rd-badge--${tone}`}><span aria-hidden="true" />{children}</span>;
}
