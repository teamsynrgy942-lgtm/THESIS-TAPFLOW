import waterBackground from '../../assets/figma/water-background.png';
import './WaterBackdrop.css';

export function WaterBackdrop() {
  return (
    <div className="water-backdrop" aria-hidden="true">
      <img
        className="water-backdrop__image"
        src={waterBackground}
        alt=""
        width="1672"
        height="941"
        fetchPriority="high"
      />
      <div className="water-backdrop__shade" />
      <div className="water-backdrop__grid" />
    </div>
  );
}
