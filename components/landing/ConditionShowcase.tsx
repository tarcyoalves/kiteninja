import { Gauge, MapPin, Navigation, Waves } from 'lucide-react';
import { landingData } from './landingData';

function LiveConditionsConsole() {
  const { conditionDemo } = landingData;

  return (
    <div className="landing-condition-console" aria-label="Exemplo de leitura das condições do KiteNinja">
      <header>
        <div>
          <span className="landing-status-dot" />
          Condição agora
        </div>
        <span>atualizado {conditionDemo.lastUpdate}</span>
      </header>

      <div className="landing-condition-place">
        <div>
          <h3>{conditionDemo.spot.name}</h3>
          <p><MapPin size={14} /> {conditionDemo.spot.location}</p>
        </div>
        <div className="landing-condition-score">
          <strong>{conditionDemo.score}</strong>
          <span>{conditionDemo.scoreLabel}</span>
        </div>
      </div>

      <div className="landing-condition-main">
        <div className="landing-wind-compass">
          <Navigation size={25} />
          <span>{conditionDemo.wind.direction}</span>
        </div>
        <div className="landing-wind-reading">
          <strong>{conditionDemo.wind.speed}</strong>
          <span>nós</span>
          <p>rajadas de {conditionDemo.wind.gust}</p>
        </div>
        <div className="landing-tide-reading">
          <Waves size={21} />
          <div>
            <span>maré {conditionDemo.tide.status}</span>
            <strong>{conditionDemo.tide.height} m</strong>
            <small>baixa {conditionDemo.tide.nextLow}</small>
          </div>
        </div>
      </div>

      <div className="landing-forecast-line">
        {conditionDemo.forecast.map((entry, index) => (
          <div key={entry.hour} className={index === 1 ? 'is-current' : ''}>
            <span>{entry.hour}</span>
            <strong>{entry.wind}</strong>
            <small>{entry.gust}</small>
          </div>
        ))}
      </div>

      <footer>
        <span>Seu peso: {conditionDemo.userWeight} kg</span>
        <p>Hoje, comece pela <strong>{conditionDemo.recommendedKite}</strong>.</p>
      </footer>
    </div>
  );
}

export function ConditionShowcase() {
  const { conditionSection } = landingData;
  const icons = { Navigation, Waves, Gauge };

  return (
    <section id="condicao" className="landing-condition-section">
      <div className="landing-condition-swoop" aria-hidden="true" />
      <div className="landing-container landing-condition-layout">
        <div className="landing-section-copy landing-condition-copy">
          <span className="landing-hand-note">{conditionSection.tag}</span>
          <h2>Não olhe só<br />para os <em>nós.</em></h2>
          <p>{conditionSection.description}</p>
          <dl className="landing-condition-list">
            {conditionSection.features.map((feature) => {
              const Icon = icons[feature.icon as keyof typeof icons];
              return (
                <div key={feature.title}>
                  <dt>
                    <Icon size={18} /> {feature.title}
                  </dt>
                  <dd>{feature.description}</dd>
                </div>
              );
            })}
          </dl>
        </div>
        <LiveConditionsConsole />
      </div>
    </section>
  );
}
