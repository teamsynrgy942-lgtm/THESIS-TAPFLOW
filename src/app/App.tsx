import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { WelcomePage } from '../pages/welcome/WelcomePage';
import { OverviewPage } from '../pages/overview/OverviewPage';
import { NotFoundPage } from '../pages/not-found/NotFoundPage';
import { DashboardLayout } from '../components/dashboard/DashboardLayout';
import { DashboardProvider } from '../features/dashboard/DashboardProvider';
import { RoomDetailsPage } from '../pages/rooms/RoomDetailsPage';
import { AlertsPage } from '../pages/alerts/AlertsPage';

export function App() {
  const { pathname } = useLocation();

  useEffect(() => {
    const page = pathname === '/' ? 'Welcome'
      : pathname === '/overview' ? 'Overview'
      : /^\/rooms(?:\/[^/]+)?\/?$/.test(pathname) ? 'Room Details'
      : pathname === '/alerts' ? 'Alerts' : 'Page not found';
    document.title = `TapFlow | ${page}`;
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <DashboardProvider>
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route path="/welcome" element={<Navigate to="/" replace />} />
        <Route element={<DashboardLayout />}>
          <Route path="/overview" element={<OverviewPage />} />
        </Route>
        <Route element={<DashboardLayout variant="alerts" />}>
          <Route path="/alerts" element={<AlertsPage />} />
        </Route>
        <Route element={<DashboardLayout variant="room-details" />}>
          <Route path="/rooms" element={<RoomDetailsPage />} />
          <Route path="/rooms/:roomId" element={<RoomDetailsPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </DashboardProvider>
  );
}
