import { RoomIcon } from './RoomIcon';
import { RoomDetailBadge } from './RoomDetailBadge';

export function RoomDetailsHeader() {
  return (
    <>
      <div className="rd-utility"><RoomIcon name="utility" /><span>Utility monitoring</span></div>
      <div className="rd-header-status">
        <RoomDetailBadge tone="demo">Demo data</RoomDetailBadge>
        <span className="rd-data-status"><RoomIcon name="clock" />Last updated: No live data</span>
      </div>
    </>
  );
}

export function RoomDetailsSidebarFooter() {
  return <div className="rd-sidebar-footer" aria-hidden="true" />;
}
