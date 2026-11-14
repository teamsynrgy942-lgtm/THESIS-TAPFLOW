import type { ReactNode } from 'react';
import { RoomIcon } from './RoomIcon';
import type { RoomIconName } from './RoomIcon';

export function RoomDetailPanel({ id, title, subtitle, action, className = '', children }: {
  id: string; title: string; subtitle?: string; action?: ReactNode; className?: string; children: ReactNode;
}) {
  return (
    <section className={`rd-panel ${className}`} aria-labelledby={id}>
      <header className="rd-panel__header">
        <div className="rd-panel__heading"><h2 id={id}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function RoomEmptyState({ title, description, icon, layout = 'inline' }: {
  title: string; description: string; icon?: RoomIconName; layout?: 'inline' | 'center';
}) {
  return (
    <div className={`rd-empty rd-empty--${layout}`}>
      {icon && <span className="rd-empty__icon"><RoomIcon name={icon} /></span>}
      <div className="rd-empty__copy"><strong>{title}</strong><p>{description}</p></div>
    </div>
  );
}
