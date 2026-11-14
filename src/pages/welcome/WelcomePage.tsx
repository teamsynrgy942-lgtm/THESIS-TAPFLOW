import { Link } from 'react-router';
import arrowRight from '../../assets/figma/arrow-right.svg';
import { BrandLogo } from '../../components/BrandLogo/BrandLogo';
import { WaterBackdrop } from '../../components/WaterBackdrop/WaterBackdrop';
import './WelcomePage.css';

export function WelcomePage() {
  return (
    <main className="welcome-page" aria-labelledby="welcome-title">
      <WaterBackdrop />
      <section className="welcome-content">
        <div className="welcome-content__brand">
          <BrandLogo />
        </div>

        <div className="welcome-content__copy">
          <h1 id="welcome-title" className="welcome-title">
            <span>RFID-Based Automatic Water</span>{' '}
            <span>and Electrical Line Control</span>
          </h1>
          <p className="welcome-subtitle">with Water Flow Anomaly Detection Sysem</p>
        </div>

        <div className="welcome-content__action">
          <Link className="dashboard-link" to="/overview">
            <span>Open Dashboard</span>
            <img src={arrowRight} alt="" width="16" height="16" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </main>
  );
}
