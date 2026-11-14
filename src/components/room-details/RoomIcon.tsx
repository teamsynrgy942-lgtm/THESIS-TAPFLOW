import overview from '../../assets/figma/room-details/overview.svg';
import rooms from '../../assets/figma/room-details/rooms.svg';
import alerts from '../../assets/figma/room-details/alerts.svg';
import prototype from '../../assets/figma/room-details/prototype.svg';
import utility from '../../assets/figma/room-details/utility.svg';
import clock from '../../assets/figma/room-details/clock.svg';
import waterDrop from '../../assets/figma/room-details/water-drop.svg';
import usage from '../../assets/figma/room-details/usage.svg';
import rfid from '../../assets/figma/room-details/rfid.svg';
import valve from '../../assets/figma/room-details/valve.svg';
import light from '../../assets/figma/room-details/light.svg';
import chartEmpty from '../../assets/figma/room-details/chart-empty.svg';
import activity from '../../assets/figma/room-details/activity.svg';
import arrowRight from '../../assets/figma/room-details/arrow-right.svg';
import relatedAlerts from '../../assets/figma/room-details/related-alerts.svg';
import info from '../../assets/figma/room-details/info.svg';

const icons = {
  overview, rooms, alerts, prototype, utility, clock, waterDrop, usage,
  rfid, valve, light, chartEmpty, activity, arrowRight, relatedAlerts, info,
};

export type RoomIconName = keyof typeof icons;

export function RoomIcon({ name }: { name: RoomIconName }) {
  // Preserve each original SVG's intrinsic dimensions and stroke colors.
  return <img className="rd-icon" src={icons[name]} alt="" aria-hidden="true" />;
}
