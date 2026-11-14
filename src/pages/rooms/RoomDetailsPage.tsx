import { Link, useParams } from 'react-router';
import { useDashboardState } from '../../features/dashboard/DashboardProvider';
import { demoRoomHistories, selectRoomAlerts } from '../../features/rooms/room-details-model';
import { RoomSelector } from '../../components/room-details/RoomSelector';
import { RoomMetricCards } from '../../components/room-details/RoomMetricCards';
import { RoomDetailBadge } from '../../components/room-details/RoomDetailBadge';
import { WaterFlowPanel, WaterUsageHistoryPanel, RecentActivityPanel, RelatedAlertsPanel } from '../../components/room-details/RoomHistoryPanels';
import { RoomIcon } from '../../components/room-details/RoomIcon';
import './RoomDetailsPage.css';

export function RoomDetailsPage() {
  const { roomId } = useParams();
  const { rooms, alerts } = useDashboardState();
  const selectedRoom = roomId ? rooms.find((room) => room.id === roomId) : rooms[0];
  const history = selectedRoom ? demoRoomHistories[selectedRoom.id] : undefined;

  return (
    <>
      <header className="rd-page-header">
        <div>
          <h1>Room Details</h1>
          <p>{selectedRoom ? 'Review RFID access, utility commands, and water usage for the selected room.' : 'The requested room could not be found.'}</p>
        </div>
      </header>
      <div className="rd-room-toolbar">
        <RoomSelector rooms={rooms} selectedRoomId={selectedRoom?.id} />
        {selectedRoom && <div className="rd-room-status">
          <h2 id="selected-room-title">{selectedRoom.name}</h2>
          <RoomDetailBadge tone={selectedRoom.status === 'active' ? 'success' : selectedRoom.status === 'alert' ? 'warning' : 'idle'}>
            {{ idle: 'Idle', active: 'Active', alert: 'Alert', offline: 'Offline' }[selectedRoom.status]}
          </RoomDetailBadge>
          <RoomDetailBadge tone="unknown">Connectivity unknown</RoomDetailBadge>
        </div>}
      </div>
      {selectedRoom && history ? (
        <article className="rd-room-body" aria-labelledby="selected-room-title">
          <RoomMetricCards room={selectedRoom} />
          <div className="rd-panel-grid">
            <WaterFlowPanel readings={history.flowReadings} />
            <WaterUsageHistoryPanel records={history.usageRecords} />
            <RecentActivityPanel activities={history.activities} />
            <RelatedAlertsPanel alerts={selectRoomAlerts(alerts, selectedRoom.id)} />
          </div>
          <footer className="rd-footnote">
            <p><RoomIcon name="info" /><span>Valve and light fields show controller commands. Flow is shown separately as a sensor reading.</span></p>
            <Link className="dashboard-return-link" to="/overview">← Back to Overview</Link>
          </footer>
        </article>
      ) : <section className="rd-panel rd-not-found"><h2>Room not found</h2><p>Choose Room 1, Room 2, or Room 3 from the room navigation.</p><Link className="dashboard-return-link" to="/overview">← Back to Overview</Link></section>}
    </>
  );
}
