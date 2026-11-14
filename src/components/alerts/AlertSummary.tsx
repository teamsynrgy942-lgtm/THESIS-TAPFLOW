import { AlertIcon } from './AlertIcon';

export function AlertSummary({ active, resolved }: { active: number; resolved: number }) {
  return (
    <section className="alerts-summary" aria-label="Recorded alert counts">
      <AlertCountCard label="Active alerts" count={active} icon="active" />
      <AlertCountCard label="Resolved alerts" count={resolved} icon="resolved" />
    </section>
  );
}

function AlertCountCard({ label, count, icon }: { label: string; count: number; icon: 'active' | 'resolved' }) {
  return (
    <section className={`alert-count alert-count--${icon}`} aria-label={label}>
      <span className="alert-count__icon"><AlertIcon name={icon} /></span>
      <div className="alert-count__copy"><h2>{label}</h2><strong>{count}</strong></div>
    </section>
  );
}
