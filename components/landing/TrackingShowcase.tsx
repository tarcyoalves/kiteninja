import { MessageCircle, Navigation, Radio, Smartphone, Zap } from 'lucide-react';
import { landingData } from './landingData';

function DownwindMap() {
  const { downwindDemo } = landingData;

  return (
    <div className="landing-route-stage" aria-label="Exemplo de acompanhamento de downwind">
      <div className="landing-route-grid" aria-hidden="true" />
      <div className="landing-route-topline">
        <span><i /> Downwind {downwindDemo.status}</span>
        <strong>{downwindDemo.route}</strong>
      </div>
      <svg className="landing-route-map" viewBox="0 0 760 490" aria-hidden="true">
        <path className="landing-map-land" d="M-40 468C101 333 183 376 278 281c91-91 174-62 258-176C599 21 692 39 810-44" />
        <path className="landing-map-track-halo" d="M54 430c92-47 150-91 229-137 91-53 143-113 219-155 68-37 124-76 199-125" />
        <path className="landing-map-track" d="M54 430c92-47 150-91 229-137 91-53 143-113 219-155 68-37 124-76 199-125" />
      </svg>

      {downwindDemo.riders.map((rider) => (
        <div
          className={`landing-map-rider landing-map-rider-${rider.tone}`}
          key={rider.name}
          style={{ left: rider.x, top: rider.y }}
        >
          <span><Navigation size={14} /></span>
          <div><strong>{rider.name}</strong><small>{rider.signal}</small></div>
        </div>
      ))}

      <div className="landing-route-data">
        <div><span>distância</span><strong>{downwindDemo.stats.distance} <small>km</small></strong></div>
        <div><span>ritmo máximo</span><strong>{downwindDemo.stats.maxSpeed} <small>nós</small></strong></div>
        <div><span>na água</span><strong>{downwindDemo.stats.ridersCount} <small>riders</small></strong></div>
      </div>
      <div className="landing-route-message">
        <MessageCircle size={16} />
        <span><strong>Apoio em terra</strong> {downwindDemo.supportMessage}</span>
      </div>
    </div>
  );
}

export function TrackingShowcase() {
  const { downwindSection } = landingData;
  const icons = { Radio, Smartphone, Zap };

  return (
    <section id="downwind" className="landing-downwind-section">
      <div className="landing-container">
        <div className="landing-downwind-heading">
          <span>{downwindSection.tag}</span>
          <h2>Todo mundo<br />no mesmo mapa.</h2>
          <p>{downwindSection.description}</p>
        </div>
        <DownwindMap />
        <div className="landing-downwind-notes">
          {downwindSection.features.map((feature) => {
            const Icon = icons[feature.icon as keyof typeof icons];
            return (
              <div key={feature.title}>
                <Icon size={20} />
                <p><strong>{feature.title}</strong> {feature.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
