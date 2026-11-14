import type { Room } from '../../features/dashboard/dashboard-model';
import { formatVolume } from '../../features/dashboard/dashboard-model';
import { RoomIcon } from './RoomIcon';
import type { RoomIconName } from './RoomIcon';

function RoomMetricCard({ label, value, unit, icon }: {
  label: string; value: string; unit?: string; icon: RoomIconName;
}) {
  return (
    <div className="rd-metric" role="group" aria-label={label}>
      <span className="rd-metric__icon"><RoomIcon name={icon} /></span>
      <div className="rd-metric__copy">
        <span className="rd-metric__label">{label}</span>
        <p className="rd-metric__value"><strong>{value}</strong>{unit && <span>{unit}</span>}</p>
      </div>
    </div>
  );
}

export function RoomMetricCards({ room }: { room: Room }) {
  return (
    <section className="rd-metrics" aria-label={`${room.name} demo metrics`} aria-live="polite">
      <RoomMetricCard label="Current flow" value={room.currentFlow.toFixed(2)} unit="L/min" icon="waterDrop" />
      <RoomMetricCard label="Used today" value={formatVolume(room.usedToday)} unit="L" icon="usage" />
      <RoomMetricCard label="RFID Session" value={room.rfidSession === 'active' ? 'Active' : 'Inactive'} icon="rfid" />
      <RoomMetricCard label="Valve Command" value={room.valveCommand === 'open' ? 'Open' : 'Closed'} icon="valve" />
      <RoomMetricCard label="Light Command" value={room.lightCommand === 'on' ? 'On' : 'Off'} icon="light" />
    </section>
  );
}
