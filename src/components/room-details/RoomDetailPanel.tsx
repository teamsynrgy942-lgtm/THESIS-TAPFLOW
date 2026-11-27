import type { ReactNode } from 'react';
import { RoomIcon } from './RoomIcon';
import type { RoomIconName } from './RoomIcon';

export function RoomDetailPanel({ id, title, action, className = '', children }: {
  id: string; title: string; action?: ReactNode; className?: string; children: ReactNode;
}) {
  return (
    <section className={`rd-panel ${className}`} aria-labelledby={id}>
      <header className="rd-panel__header">
        <h2 id={id}>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function RoomEmptyState({ title, icon, layout = 'inline' }: {
  title: string; icon?: RoomIconName; layout?: 'inline' | 'center';
}) {
  return (
    <div className={`rd-empty rd-empty--${layout}`}>
      {icon && <span className="rd-empty__icon"><RoomIcon name={icon} /></span>}
      <strong>{title}</strong>
    </div>
  );
}
