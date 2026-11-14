import { Link } from 'react-router';
import type { DashboardAlert } from '../../features/dashboard/dashboard-model';
import { formatVolume } from '../../features/dashboard/dashboard-model';
import type { FlowReading, RoomActivity, UsageRecord } from '../../features/rooms/room-details-model';
import { formatActivityTime, formatHistoryDate } from '../../features/rooms/room-details-model';
import { RoomDetailPanel, RoomEmptyState } from './RoomDetailPanel';
import { RoomIcon } from './RoomIcon';
import { RoomDetailBadge } from './RoomDetailBadge';
import { severityLabels } from '../../features/alerts/alert-model';

export function WaterFlowPanel({ readings }: { readings: readonly FlowReading[] }) {
  const samples = readings.filter((sample) =>
    Number.isFinite(sample.litersPerMinute) && sample.litersPerMinute >= 0 && Number.isFinite(Date.parse(sample.timestamp)),
  ).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const maximum = Math.max(2, ...samples.map((sample) => sample.litersPerMinute));
  const start = samples.length ? Date.parse(samples[0].timestamp) : 0;
  const end = samples.length ? Date.parse(samples[samples.length - 1].timestamp) : 0;
  const points = samples.map((sample) => {
    const x = end === start ? 50 : (Date.parse(sample.timestamp) - start) / (end - start) * 100;
    return `${x},${100 - sample.litersPerMinute / maximum * 100}`;
  }).join(' ');

  return (
    <RoomDetailPanel id="room-flow-title" title="Water flow" subtitle="Measured flow · L/min" className="rd-flow">
      <div className="rd-flow__plot" role="img" aria-label={samples.length ? `${samples.length} demo water flow readings` : 'Empty water flow chart. No flow readings yet.'}>
        <div className="rd-flow__axis" aria-hidden="true"><span>{formatVolume(maximum)}</span><span>{formatVolume(maximum / 2)}</span><span>0</span></div>
        {samples.length ? (
          <svg className="rd-flow__series" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polyline points={points} fill="none" stroke="#09628d" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            {samples.length === 1 && <circle cx="50" cy={100 - samples[0].litersPerMinute / maximum * 100} r="1.5" fill="#09628d" />}
          </svg>
        ) : <RoomEmptyState layout="center" icon="chartEmpty" title="No flow readings yet" description="The chart will show measured flow as samples arrive." />}
      </div>
      <div className="rd-flow__time">{samples.length > 0 && <span>{formatActivityTime(samples[0].timestamp)} – {formatActivityTime(samples[samples.length - 1].timestamp)}</span>}<span>Time · PHT</span></div>
    </RoomDetailPanel>
  );
}

export function WaterUsageHistoryPanel({ records }: { records: readonly UsageRecord[] }) {
  return (
    <RoomDetailPanel id="room-history-title" title="Water usage history" subtitle="Daily totals from measured volume." className="rd-usage">
      <table className="rd-usage-table" aria-label="Demo water usage history">
        <thead><tr><th scope="col">Date</th><th scope="col">Volume (L)</th></tr></thead>
        <tbody>
          {records.length ? records.map((record) => <tr key={record.date}><td>{formatHistoryDate(record.date)}</td><td>{formatVolume(record.liters)}</td></tr>) : (
            <tr><td colSpan={2}><RoomEmptyState layout="center" title="No usage history yet" description="Daily totals appear once readings are recorded." /></td></tr>
          )}
        </tbody>
      </table>
    </RoomDetailPanel>
  );
}

export function RecentActivityPanel({ activities }: { activities: readonly RoomActivity[] }) {
  return (
    <RoomDetailPanel id="room-activity-title" title="Recent activity" className="rd-activity">
      {activities.length ? (
        <ol className="rd-records">
          {activities.map((activity) => <li key={activity.id}><span className="rd-records__icon"><RoomIcon name="activity" /></span><div><strong>{activity.description}</strong><time dateTime={activity.timestamp}>{formatActivityTime(activity.timestamp)}</time></div></li>)}
        </ol>
      ) : <RoomEmptyState icon="activity" title="No recent activity" description="RFID events and utility commands will appear here." />}
    </RoomDetailPanel>
  );
}

export function RelatedAlertsPanel({ alerts }: { alerts: readonly DashboardAlert[] }) {
  return (
    <RoomDetailPanel id="room-alerts-title" title="Related alerts" className="rd-alerts" action={<Link className="rd-alerts-link" to="/alerts">View Alerts<RoomIcon name="arrowRight" /></Link>}>
      {alerts.length ? (
        <ul className="rd-records">
          {alerts.map((alert) => <li key={alert.id}><RoomDetailBadge tone="warning">{severityLabels[alert.severity]}</RoomDetailBadge><strong>{alert.message}</strong></li>)}
        </ul>
      ) : <RoomEmptyState icon="relatedAlerts" title="No active alerts" description="No anomalies in this room’s demo state." />}
    </RoomDetailPanel>
  );
}
