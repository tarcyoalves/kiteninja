import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { landingData } from './landingData';

const APP_PATH = '/';

function SessionTrace() {
  const { sessionDemo } = landingData;

  return (
    <div className="landing-session-trace" aria-label="Exemplo de sessão registrada">
      <div className="landing-session-profile">
        <span>{sessionDemo.rider.initials}</span>
        <div>
          <strong>{sessionDemo.rider.name}</strong>
          <small>{sessionDemo.rider.spot} · {sessionDemo.rider.date}</small>
        </div>
        <i>{sessionDemo.rider.boardType}</i>
      </div>
      <div className="landing-session-canvas">
        <svg viewBox="0 0 620 270" aria-hidden="true">
          <path className="landing-session-halo" d="M23 230c84-23 116-88 184-72 83 19 115 60 168-32 49-85 116-79 220-104" />
          <path className="landing-session-path" d="M23 230c84-23 116-88 184-72 83 19 115 60 168-32 49-85 116-79 220-104" />
        </svg>
        <span className="landing-session-start">saída</span>
        <span className="landing-session-finish">chegada</span>
      </div>
      <div className="landing-session-numbers">
        <div><span>Distância</span><strong>{sessionDemo.stats.distance} km</strong></div>
        <div><span>Velocidade máxima</span><strong>{sessionDemo.stats.maxSpeed} nós</strong></div>
        <div><span>Tempo na água</span><strong>{sessionDemo.stats.duration}</strong></div>
      </div>
      <footer>
        <span>♥ {sessionDemo.social.likes} riders curtiram</span>
        <span>{sessionDemo.social.comments} comentários</span>
      </footer>
    </div>
  );
}

export function SessionCommunity() {
  const { communitySection } = landingData;

  return (
    <section id="comunidade" className="landing-community-section">
      <div className="landing-container landing-community-layout">
        <SessionTrace />
        <div className="landing-section-copy landing-community-copy">
          <span className="landing-hand-note">{communitySection.tag}</span>
          <h2>O traço fica.<br /><em>A história também.</em></h2>
          <p>{communitySection.description}</p>
          <ul>
            {communitySection.features.map((feature) => (
              <li key={feature}>
                <Check size={15} /> {feature}
              </li>
            ))}
          </ul>
          <Link href={`${APP_PATH}?tab=sessoes`} className="landing-text-link">
            Abrir meu diário <ArrowRight size={17} />
          </Link>
        </div>
      </div>
    </section>
  );
}
