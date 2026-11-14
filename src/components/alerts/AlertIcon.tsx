import overview from '../../assets/figma/room-details/overview.svg';
import rooms from '../../assets/figma/alerts/rooms.svg';
import alerts from '../../assets/figma/alerts/alerts.svg';
import prototype from '../../assets/figma/alerts/prototype.svg';
import active from '../../assets/figma/alerts/active.svg';
import resolved from '../../assets/figma/alerts/resolved.svg';
import empty from '../../assets/figma/alerts/empty-shield.svg';
import info from '../../assets/figma/room-details/info.svg';

const icons = { overview, rooms, alerts, prototype, active, resolved, empty, info };
export type AlertIconName = keyof typeof icons;

export function AlertIcon({ name }: { name: AlertIconName }) {
  return <img className="alerts-icon" src={icons[name]} alt="" aria-hidden="true" />;
}
