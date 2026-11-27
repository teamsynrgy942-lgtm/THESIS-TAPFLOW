import { Navigate, Outlet, useLocation } from 'react-router';
import { WelcomePage } from '../../pages/welcome/WelcomePage';
import { useAuth } from './AuthProvider';

export function RequireAuth() {
  const { session, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <WelcomePage />;
  if (!session) {
    return <Navigate to="/" replace state={{ from: location.pathname + location.search + location.hash }} />;
  }

  return <Outlet key={session.user.id} />;
}
