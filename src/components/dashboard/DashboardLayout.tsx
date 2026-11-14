import { Link, NavLink, Outlet } from 'react-router';
import sidebarLogo from '../../assets/figma/overview/sidebar-logo.png';
import { useDashboardState } from '../../features/dashboard/DashboardProvider';
import { formatUpdateTime } from '../../features/dashboard/dashboard-model';
import './DashboardLayout.css';
import roomDetailsLogo from '../../assets/figma/room-details/sidebar-logo.png';
import { RoomIcon } from '../room-details/RoomIcon';
import type { RoomIconName } from '../room-details/RoomIcon';
import { RoomDetailsHeader, RoomDetailsSidebarFooter } from '../room-details/RoomDetailsChrome';
import '../room-details/RoomDetailsChrome.css';
import { AlertIcon } from '../alerts/AlertIcon';

const navigation = [
  { to: '/overview', label: 'Overview' },
  { to: '/rooms', label: 'Room Details' },
  { to: '/alerts', label: 'Alerts' },
];

const roomNavigationIcons: Record<string, RoomIconName> = {
  '/overview': 'overview', '/rooms': 'rooms', '/alerts': 'alerts',
};

export function DashboardLayout({ variant = 'default' }: { variant?: 'default' | 'room-details' | 'alerts' }) {
  const { updatedAt } = useDashboardState();
  // Alerts and Room Details share the same 232 px Figma shell.
  const isRoomDetails = variant !== 'default';
  const isAlerts = variant === 'alerts';

  return (
    <div className={`dashboard-shell${isRoomDetails ? ' dashboard-shell--room-details' : ''}${isAlerts ? ' dashboard-shell--alerts' : ''}`}>
      <a className="dashboard-skip-link" href="#dashboard-main">Skip to content</a>
      <aside className="dashboard-sidebar" aria-label="TapFlow sidebar">
        <Link className="dashboard-brand" to="/" aria-label="Back to Welcome">
          <img src={isRoomDetails ? roomDetailsLogo : sidebarLogo} alt="" width={isRoomDetails ? 42 : 38} height={isRoomDetails ? 42 : 38} /><span>TapFlow</span>
        </Link>
        <nav className="dashboard-navigation" aria-label="Dashboard navigation">
          {navigation.map(({ to, label }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `dashboard-navigation__link${isActive ? ' is-active' : ''}`}>
              <span className="dashboard-navigation__symbol" aria-hidden="true">{isAlerts ? <AlertIcon name={to === '/overview' ? 'overview' : to === '/rooms' ? 'rooms' : 'alerts'} /> : <RoomIcon name={roomNavigationIcons[to]} />}</span><span>{label}</span>
            </NavLink>
          ))}
        </nav>
        {isRoomDetails && <RoomDetailsSidebarFooter />}
      </aside>
      <div className="dashboard-workspace">
        <header className="dashboard-topbar">{isRoomDetails ? <RoomDetailsHeader /> : <time dateTime={updatedAt}>Last update {formatUpdateTime(updatedAt)}</time>}</header>
        <main id="dashboard-main" className="dashboard-content" tabIndex={-1}><Outlet /></main>
      </div>
    </div>
  );
}
