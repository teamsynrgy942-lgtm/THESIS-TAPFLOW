import { Link, NavLink, Outlet } from 'react-router';
import sidebarLogo from '../../assets/figma/tapflow-logo.png';
import { OverviewUpdateTime } from './OverviewUpdateTime';
import './DashboardLayout.css';
import roomDetailsLogo from '../../assets/figma/room-details/sidebar-logo.png';
import { RoomIcon } from '../room-details/RoomIcon';
import type { RoomIconName } from '../room-details/RoomIcon';
import { AlertsHeader, RoomDetailsSidebarFooter, RoomTelemetryHeader } from '../room-details/RoomDetailsChrome';
import '../room-details/RoomDetailsChrome.css';
import { AlertIcon } from '../alerts/AlertIcon';
import { LogoutButton } from '../../features/auth/LogoutButton';
import { HeaderAlerts, OverviewHeaderAlerts, RoomHeaderAlerts } from '../alerts/HeaderAlerts';

const navigation = [
  { to: '/overview', label: 'Overview' },
  { to: '/rooms', label: 'Room Details' },
];

const roomNavigationIcons: Record<string, RoomIconName> = {
  '/overview': 'overview', '/rooms': 'rooms',
};

export function DashboardLayout({ variant = 'default' }: { variant?: 'default' | 'room-details' | 'alerts' }) {
  // Alerts and Room Details share the same 232 px Figma shell.
  const isRoomDetails = variant !== 'default';
  const isAlerts = variant === 'alerts';

  return (
    <div className={`dashboard-shell${isRoomDetails ? ' dashboard-shell--room-details' : ''}${isAlerts ? ' dashboard-shell--alerts' : ''}`}>
      <a className="dashboard-skip-link" href="#dashboard-main">Skip to content</a>
      <aside className="dashboard-sidebar" aria-label="TapFlow sidebar">
        <Link className={`dashboard-brand${variant === 'default' ? ' dashboard-brand--overview' : ''}`} to="/" aria-label="Back to Welcome">
          <img src={isRoomDetails ? roomDetailsLogo : sidebarLogo} alt="" width={42} height={42} /><span>TapFlow</span>
        </Link>
        <nav className="dashboard-navigation" aria-label="Dashboard navigation">
          {navigation.map(({ to, label }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `dashboard-navigation__link${isActive ? ' is-active' : ''}`}>
              <span className="dashboard-navigation__symbol" aria-hidden="true">{isAlerts ? <AlertIcon name={to === '/overview' ? 'overview' : to === '/rooms' ? 'rooms' : 'alerts'} /> : <RoomIcon name={roomNavigationIcons[to]} />}</span><span>{label}</span>
            </NavLink>
          ))}
          <LogoutButton />
        </nav>
        {isRoomDetails && <RoomDetailsSidebarFooter />}
      </aside>
      <div className="dashboard-workspace">
        <header className="dashboard-topbar dashboard-topbar--with-alerts">
          {isAlerts ? <><AlertsHeader /><HeaderAlerts /></> : isRoomDetails
            ? <RoomTelemetryHeader><RoomHeaderAlerts /></RoomTelemetryHeader>
            : <div className="dashboard-header-actions"><OverviewUpdateTime /><OverviewHeaderAlerts /></div>}
        </header>
        <main id="dashboard-main" className="dashboard-content" tabIndex={-1}><Outlet /></main>
      </div>
    </div>
  );
}
