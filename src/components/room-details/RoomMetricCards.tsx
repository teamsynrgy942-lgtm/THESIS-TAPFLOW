import type { LatestRecord } from '../../features/overview/overview-telemetry';
import { currentCommandLabel, flowActivityLabel } from '../../features/overview/overview-telemetry';
import type { FlowReading, RoomStatus, TelemetryRoom } from '../../features/telemetry/telemetry-types';
import { RoomIcon } from './RoomIcon';
import type { RoomIconName } from './RoomIcon';

function RoomMetricCard({ label, value, icon }: {
  label: string; value: string; icon: RoomIconName;
}) {
  return (
    <div className="rd-metric" role="group" aria-label={label}>
      <span className="rd-metric__icon"><RoomIcon name={icon} /></span>
      <div className="rd-metric__copy">
        <span className="rd-metric__label">{label}</span>
        <p className="rd-metric__value"><strong>{value}</strong></p>
      </div>
    </div>
  );
}

export function RoomMetricCards({ room, reading, status, now }: {
  room: TelemetryRoom; reading: LatestRecord<FlowReading>; status: LatestRecord<RoomStatus>; now: number;
}) {
  return (
    <section className="rd-metrics" aria-label={`${room.name} reported metrics`} aria-live="polite">
      <RoomMetricCard label="Water flow activity" value={reading.loaded ? flowActivityLabel(reading, now) : 'Loading…'} icon="waterDrop" />
      <RoomMetricCard label="RFID Session" value={currentCommandLabel(status, 'rfid_active', now, 'Active', 'Inactive')} icon="rfid" />
      <RoomMetricCard label="Valve Command" value={currentCommandLabel(status, 'valve_commanded_on', now, 'Open', 'Closed')} icon="valve" />
      <RoomMetricCard label="Light Command" value={currentCommandLabel(status, 'bulb_commanded_on', now, 'On', 'Off')} icon="light" />
    </section>
  );
}
