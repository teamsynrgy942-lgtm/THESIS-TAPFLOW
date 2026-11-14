import logo from '../../assets/figma/tapflow-logo.png';
import './BrandLogo.css';

export function BrandLogo() {
  return (
    <div className="brand-logo">
      <img src={logo} alt="TapFlow" width="224" height="224" fetchPriority="high" />
    </div>
  );
}
