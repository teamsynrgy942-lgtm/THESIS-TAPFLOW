import { RoomCard } from '../../components/dashboard/RoomCard';
import { MainWaterInletCard } from '../../components/dashboard/MainWaterInletCard';
import { useOverviewTelemetry } from '../../features/overview/OverviewTelemetryProvider';
import { overviewRooms } from '../../features/overview/overview-telemetry';
import './OverviewPage.css';

export function OverviewPage() {
  const { telemetry, now } = useOverviewTelemetry();
  const hasError = [...Object.values(telemetry.readings), ...Object.values(telemetry.rooms)].some((record) => record.error);

  return (
    <>
      <header className="dashboard-page-header overview-header">
        <div>
          <h1 id="overview-title">Overview</h1>
          <p aria-live="polite">{!telemetry.checkedAt ? 'Loading telemetry…' : hasError ? 'Some readings could not be refreshed.' : 'Water and utility status by room.'}</p>
        </div>
      </header>
      <section className="overview-rooms" aria-labelledby="rooms-title">
        <div className="overview-rooms__heading">
          <h2 id="rooms-title">Rooms</h2>
          <ul className="overview-legend" aria-label="Status meanings">
            <li><span className="overview-legend__dot overview-legend__dot--on" aria-hidden="true" />ON <span>Active or in use</span></li>
            <li><span className="overview-legend__dot overview-legend__dot--off" aria-hidden="true" />OFF <span>Idle</span></li>
            <li><span className="overview-legend__dot overview-legend__dot--unknown" aria-hidden="true" />Unknown <span>No current state</span></li>
            <li><span className="overview-legend__dot overview-legend__dot--stale" aria-hidden="true" />Stale <span>Data not recent</span></li>
            <li><span className="overview-legend__dot overview-legend__dot--missing" aria-hidden="true" />Missing Data <span>No reports</span></li>
          </ul>
        </div>
        <div className="room-grid">
          {overviewRooms.map((room) => <RoomCard key={room.id} room={room} reading={telemetry.readings[room.deviceId]} status={telemetry.rooms[room.statusId]} now={now} />)}
        </div>
      </section>
      <MainWaterInletCard reading={telemetry.readings.main} consumption={telemetry.mainConsumption} now={now} />
    </>
  );
}
