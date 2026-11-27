import { useAuth } from './AuthProvider';

export function LogoutButton() {
  const { isSigningOut, signOut, error } = useAuth();

  return (
    <div className="dashboard-logout">
      <button type="button" onClick={() => void signOut()} disabled={isSigningOut} aria-busy={isSigningOut}>
        {isSigningOut ? 'Logging out…' : 'Logout'}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
