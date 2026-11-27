import { Link } from 'react-router';
import { getAlertTargetLabel } from '../../features/alerts/alert-model';
import type { AlertRecord } from '../../features/alerts/alert-model';
import type { Room } from '../../features/dashboard/dashboard-model';
import './R1AlertNotification.css';

export function R1AlertNotification({ record, rooms, count, onDismiss }: {
  record: AlertRecord; rooms: readonly Room[]; count: number; onDismiss: () => void;
}) {
  return <aside className="r1-notification" aria-label="Alert notifications" role="region">
    <div role="status">
      <strong>New active alert</strong>
      <p>{record.title ?? record.detectionRule} · {getAlertTargetLabel(record.target, rooms)}</p>
      {count > 1 && <p>{count - 1} more active {count === 2 ? 'alert' : 'alerts'}</p>}
    </div>
    <div className="r1-notification__actions">
      <Link to="/alerts">View alerts</Link>
      <button type="button" onClick={onDismiss} aria-label="Dismiss notification">Dismiss</button>
    </div>
  </aside>;
}
