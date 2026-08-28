import { MapPin, Navigation, Waves } from 'lucide-react';
import { landingData } from './landingData';

export function ProductFrame({ compact = false }: { compact?: boolean }) {
  const { conditionDemo } = landingData;

  return (
    <article className={`product-frame${compact ? ' product-frame-compact' : ''}`} aria-label="Demonstração da interface de condição do KiteNinja">
      <div className="product-frame-chrome">
        <span className="product-frame-mark">KN</span>
        <div>
          <strong>Condição do spot</strong>
          <small>Demonstração de interface</small>
        </div>
        <span className="product-live"><i /> ao vivo</span>
      </div>

      <div className="product-frame-place">
        <div>
          <span><MapPin size={14} /> {conditionDemo.spot.location}</span>
          <h3>{conditionDemo.spot.name}</h3>
        </div>
        <div className="product-score">
          <strong>{conditionDemo.score}</strong>
          <span>{conditionDemo.scoreLabel}</span>
        </div>
      </div>

      <div className="product-frame-wind">
        <div className="product-compass">
          <Navigation size={25} />
          <span>{conditionDemo.wind.direction}</span>
        </div>
        <div className="product-wind-value">
          <strong>{conditionDemo.wind.speed}</strong>
          <div><span>nós</span><small>rajadas de {conditionDemo.wind.gust}</small></div>
        </div>
        <div className="product-tide">
          <Waves size={20} />
          <div><span>maré {conditionDemo.tide.status}</span><strong>{conditionDemo.tide.height} m</strong></div>
        </div>
      </div>

      <div className="product-forecast" aria-label="Previsão demonstrativa por hora">
        {conditionDemo.forecast.map((entry, index) => (
          <div key={entry.hour} className={index === 1 ? 'is-current' : ''}>
            <span>{entry.hour}</span><strong>{entry.wind}</strong><small>{entry.gust}</small>
          </div>
        ))}
      </div>

      <footer className="product-recommendation">
        <span>{conditionDemo.userWeight} kg</span>
        <p>Comece pela <strong>{conditionDemo.recommendedKite}</strong></p>
      </footer>
    </article>
  );
}
