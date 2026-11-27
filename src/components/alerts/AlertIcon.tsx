import overview from '../../assets/figma/room-details/overview.svg';
import rooms from '../../assets/figma/alerts/rooms.svg';
import alerts from '../../assets/figma/alerts/alerts.svg';
import empty from '../../assets/figma/alerts/empty-shield.svg';

const icons = { overview, rooms, alerts, empty };

export function AlertIcon({ name }: { name: keyof typeof icons }) {
  return <img className="alerts-icon" src={icons[name]} alt="" aria-hidden="true" />;
}
