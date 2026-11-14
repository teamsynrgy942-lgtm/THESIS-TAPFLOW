import { RoomCard } from '../../components/dashboard/RoomCard';
import { MainWaterInletCard } from '../../components/dashboard/MainWaterInletCard';
import { StatusBadge } from '../../components/dashboard/StatusBadge';
import { useDashboardState } from '../../features/dashboard/DashboardProvider';
import { getRoomSummary } from '../../features/dashboard/dashboard-model';
import './OverviewPage.css';

export function OverviewPage() {
  const { rooms, inlet, alerts } = useDashboardState();

  return (
    <>
      <header className="dashboard-page-header overview-header">
        <div>
          <h1 id="overview-title">Overview</h1>
          <p aria-live="polite">{getRoomSummary(rooms)}</p>
        </div>
        <StatusBadge tone={alerts.length ? 'warning' : 'success'}>
          {alerts.length ? `${alerts.length} active ${alerts.length === 1 ? 'alert' : 'alerts'}` : 'No active alerts'}
        </StatusBadge>
      </header>
      <section className="overview-rooms" aria-labelledby="rooms-title">
        <h2 id="rooms-title">Rooms</h2>
        <div className="room-grid">
          {rooms.map((room) => <RoomCard key={room.id} room={room} />)}
        </div>
      </section>
      <MainWaterInletCard inlet={inlet} />
    </>
  );
}
