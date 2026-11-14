import { Link } from 'react-router';
import './NotFoundPage.css';

export function NotFoundPage() {
  return (
    <main className="placeholder-page" aria-labelledby="not-found-title">
      <div className="placeholder-content">
        <p className="placeholder-eyebrow">TapFlow</p>
        <h1 id="not-found-title">Page not found</h1>
        <Link className="text-link" to="/">Back to Welcome</Link>
      </div>
    </main>
  );
}
