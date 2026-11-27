import { Link } from 'react-router';
import { useDashboardState } from '../../features/dashboard/DashboardProvider';
import { selectRoomAlertRecords } from '../../features/rooms/room-details-model';
import { useRoomTelemetry } from '../../features/rooms/RoomTelemetryProvider';
import { latestRoomReading } from '../../features/rooms/room-telemetry';
import { formatTelemetryTime, roomPresenceLabel, roomReportingTime, telemetryErrorLabel } from '../../features/overview/overview-telemetry';
import { telemetryRooms } from '../../features/telemetry/telemetry-types';
import { RoomSelector } from '../../components/room-details/RoomSelector';
import { RoomMetricCards } from '../../components/room-details/RoomMetricCards';
import { RoomDetailBadge } from '../../components/room-details/RoomDetailBadge';
import { WaterFlowPanel, RelatedAlertsPanel } from '../../components/room-details/RoomHistoryPanels';
import './RoomDetailsPage.css';

export function RoomDetailsPage() {
  const { alertRecords } = useDashboardState();
  const { room: selectedRoom, telemetry, now, chartRange, setChartRange } = useRoomTelemetry();
  const reading = latestRoomReading(telemetry);
  const error = reading.error ?? telemetry.status.error;
  const reportedAt = roomReportingTime(telemetry.status.value, reading.value);
  const label = roomPresenceLabel(telemetry.status, reading, now);

  return (
    <>
      <header className="rd-page-header">
        <div>
          <h1>Room Details</h1>
          {!selectedRoom && <p>The requested room could not be found.</p>}
        </div>
      </header>
      <div className="rd-room-toolbar">
        <RoomSelector rooms={telemetryRooms} selectedRoomId={selectedRoom?.id} />
        {selectedRoom && <div className="rd-room-status" aria-live="polite">
          <h2 id="selected-room-title">{selectedRoom.name}</h2>
          <RoomDetailBadge tone={label === 'Stale' || label === 'Refresh failed' || error ? 'warning' : label === 'ON' ? 'success' : 'idle'}>{label}</RoomDetailBadge>
          {reportedAt && <time dateTime={reportedAt}>Last device report {formatTelemetryTime(reportedAt)}</time>}
        </div>}
      </div>
      {selectedRoom ? (
        <article className="rd-room-body" aria-labelledby="selected-room-title">
          <RoomMetricCards room={selectedRoom} reading={reading} status={telemetry.status} now={now} />
          {telemetry.status.error && <p className="rd-sample-note rd-sample-note--error" role="alert">
            Room status: {telemetryErrorLabel(telemetry.status.error)}
          </p>}
          <div className="rd-panel-grid">
            <WaterFlowPanel telemetry={telemetry} now={now} chartRange={chartRange} onChartRangeChange={setChartRange} />
            <RelatedAlertsPanel alerts={selectRoomAlertRecords(alertRecords, selectedRoom.id)} />
          </div>
          <footer className="rd-footnote">
            <Link className="dashboard-return-link" to="/overview">← Back to Overview</Link>
          </footer>
        </article>
      ) : <section className="rd-panel rd-not-found"><h2>Room not found</h2><p>Choose Room 1, Room 2, or Room 3 from the room navigation.</p><Link className="dashboard-return-link" to="/overview">← Back to Overview</Link></section>}
    </>
  );
}
