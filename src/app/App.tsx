import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { WelcomePage } from '../pages/welcome/WelcomePage';
import { OverviewPage } from '../pages/overview/OverviewPage';
import { NotFoundPage } from '../pages/not-found/NotFoundPage';
import { DashboardLayout } from '../components/dashboard/DashboardLayout';
import { AuthProvider } from '../features/auth/AuthProvider';
import { RequireAuth } from '../features/auth/RequireAuth';
import { AlertsPage } from '../pages/alerts/AlertsPage';
import { OverviewTelemetryProvider } from '../features/overview/OverviewTelemetryProvider';
import { RoomTelemetryProvider } from '../features/rooms/RoomTelemetryProvider';
import { DashboardProvider } from '../features/dashboard/DashboardProvider';

const RoomDetailsPage = lazy(() => import('../pages/rooms/RoomDetailsPage').then(({ RoomDetailsPage }) => ({ default: RoomDetailsPage })));

// Vite removes this import and route from production builds.
const TelemetryDiagnosticsPage = import.meta.env.DEV
  ? lazy(() => import('../pages/telemetry/TelemetryDiagnosticsPage')) : null;

export function App() {
  const { pathname } = useLocation();
  const roomDetails = <Suspense fallback={<p role="status">Loading Room Details…</p>}><RoomDetailsPage /></Suspense>;

  useEffect(() => {
    const page = pathname === '/' ? 'Welcome'
      : pathname === '/overview' ? 'Overview'
      : /^\/rooms(?:\/[^/]+)?\/?$/.test(pathname) ? 'Room Details'
      : pathname === '/alerts' ? 'Alerts'
      : import.meta.env.DEV && pathname === '/dev/telemetry' ? 'Telemetry diagnostics' : 'Page not found';
    document.title = `TapFlow | ${page}`;
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route path="/welcome" element={<Navigate to="/" replace />} />
        <Route element={<RequireAuth />}>
          {TelemetryDiagnosticsPage && <Route path="/dev/telemetry" element={
            <Suspense fallback={<p role="status">Loading telemetry diagnostics…</p>}><TelemetryDiagnosticsPage /></Suspense>
          } />}
          <Route element={<DashboardProvider><Outlet /></DashboardProvider>}>
            <Route element={<OverviewTelemetryProvider><DashboardLayout /></OverviewTelemetryProvider>}>
              <Route path="/overview" element={<OverviewPage />} />
            </Route>
            <Route element={<DashboardLayout variant="alerts" />}>
              <Route path="/alerts" element={<AlertsPage />} />
            </Route>
            <Route element={<RoomTelemetryProvider><DashboardLayout variant="room-details" /></RoomTelemetryProvider>}>
              <Route path="/rooms" element={roomDetails} />
              <Route path="/rooms/:roomId" element={roomDetails} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AuthProvider>
  );
}
