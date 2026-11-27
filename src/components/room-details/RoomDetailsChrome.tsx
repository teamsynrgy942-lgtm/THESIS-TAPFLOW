import type { ReactNode } from 'react';
import { RoomIcon } from './RoomIcon';
import { useRoomTelemetry } from '../../features/rooms/RoomTelemetryProvider';
import { formatActivityTime } from '../../features/rooms/room-details-model';

export function RoomTelemetryHeader({ children }: { children?: ReactNode }) {
  const { room, telemetry, refreshing } = useRoomTelemetry();
  return <>
    <div className="rd-utility"><RoomIcon name="utility" /><span>Utility monitoring</span></div>
    <div className="rd-header-status" aria-live="polite">
      <span className="rd-data-status"><RoomIcon name="clock" />
        {!room ? 'No room selected' : refreshing ? 'Refreshing readings…' : telemetry.checkedAt
          ? <>Last checked: <time className="rd-check-time" dateTime={telemetry.checkedAt}>{formatActivityTime(telemetry.checkedAt)}</time></>
          : 'Awaiting readings'}
      </span>
      {children}
    </div>
  </>;
}

export function AlertsHeader() {
  return <div className="rd-utility"><RoomIcon name="utility" /><span>Utility monitoring</span></div>;
}

export function RoomDetailsSidebarFooter() {
  return <div className="rd-sidebar-footer" aria-hidden="true" />;
}
