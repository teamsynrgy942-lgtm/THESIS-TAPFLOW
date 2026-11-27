import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import arrowRight from '../../assets/figma/arrow-right.svg';
import { BrandLogo } from '../../components/BrandLogo/BrandLogo';
import { WaterBackdrop } from '../../components/WaterBackdrop/WaterBackdrop';
import { useAuth } from '../../features/auth/AuthProvider';
import { signInErrorMessage } from '../../features/auth/auth-errors';
import { supabase } from '../../lib/supabase';
import './WelcomePage.css';

export function WelcomePage() {
  const { session, isLoading, isSigningOut, error: sessionError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const from: unknown = location.state?.from;
  const destination = typeof from === 'string' && (/^\/(?:overview|alerts|rooms(?:\/[^/?#]+)?)(?:[/?#]|$)/.test(from)
    || (import.meta.env.DEV && /^\/dev\/telemetry(?:[?#]|$)/.test(from)))
    ? from : '/overview';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) throw signInError;
      navigate(destination, { replace: true });
    } catch (signInError) {
      setError(signInErrorMessage(signInError));
    } finally {
      setPassword('');
      setIsSubmitting(false);
    }
  }

  return (
    <main className="welcome-page" aria-labelledby="welcome-title">
      <WaterBackdrop />
      <section className="welcome-content">
        <div className="welcome-content__brand">
          <BrandLogo />
        </div>

        <h1 id="welcome-title" className="welcome-title">
          <span>RFID-Based Automatic Water</span>{' '}
          <span>and Electrical Line Control</span>{' '}
          <span className="welcome-subtitle">with Water Flow Anomaly Detection System</span>
        </h1>

        <div className="welcome-content__action">
          {isLoading || isSigningOut ? <p className="welcome-auth-status" role="status">{isLoading ? 'Restoring your session…' : 'Signing out…'}</p> : session ? <Link className="dashboard-link" to={destination}>
            <span>Open Dashboard</span>
            <img src={arrowRight} alt="" width="16" height="16" aria-hidden="true" />
          </Link> : <form className="welcome-login" onSubmit={handleSubmit} aria-label="Dashboard sign in" aria-busy={isSubmitting}>
            <div className="welcome-login__field">
              <label htmlFor="login-email">Email</label>
              <input id="login-email" name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={email} onChange={(event) => setEmail(event.target.value)} disabled={isSubmitting} />
            </div>
            <div className="welcome-login__field">
              <label htmlFor="login-password">Password</label>
              <input id="login-password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} disabled={isSubmitting} />
            </div>
            {(error || sessionError) && <p id="login-error" className="welcome-login__error" role="alert">{error || sessionError}</p>}
            <button className="dashboard-link welcome-login__submit" type="submit" disabled={isSubmitting} aria-describedby={error || sessionError ? 'login-error' : undefined}>
              <span>{isSubmitting ? 'Signing in…' : 'Sign In'}</span>
              <img src={arrowRight} alt="" width="16" height="16" aria-hidden="true" />
            </button>
            <p className="welcome-login__note">Contact your project administrator for access.</p>
          </form>}
        </div>
      </section>
    </main>
  );
}
