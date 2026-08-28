import { LocateFixed, Navigation, Radio, Route, Smartphone } from 'lucide-react';
import { landingData } from './landingData';

function TrackingPanel() {
  return (
    <article className="tracking-panel" aria-label="Demonstração de tracking de sessão">
      <div className="tracking-panel-top">
        <span><i /> Tracking ativo</span>
        <strong>00:48:12</strong>
      </div>
      <div className="tracking-map">
        <div className="tracking-grid" aria-hidden="true" />
        <svg viewBox="0 0 680 380" aria-hidden="true">
          <path className="tracking-coast" d="M-20 330c115-28 174-106 266-101 91 5 143-31 206-94 62-62 129-73 248-101" />
          <path className="tracking-halo" d="M39 321c88-43 134-89 205-74 78 16 120-18 176-75 49-50 111-66 211-110" />
          <path className="tracking-route" d="M39 321c88-43 134-89 205-74 78 16 120-18 176-75 49-50 111-66 211-110" />
        </svg>
        <span className="tracking-start">saída</span>
        <span className="tracking-current"><LocateFixed size={18} /> você</span>
        <span className="tracking-distance">12,8 km</span>
      </div>
      <div className="tracking-stats">
        <div><span>velocidade</span><strong>21,6 <small>nós</small></strong></div>
        <div><span>distância</span><strong>12,8 <small>km</small></strong></div>
        <div><span>último sinal</span><strong>agora</strong></div>
      </div>
    </article>
  );
}

function DownwindMap() {
  const { downwindDemo } = landingData;
  return (
    <article className="downwind-panel" aria-label="Demonstração de acompanhamento de downwind">
      <div className="downwind-panel-head">
        <span><i /> Downwind {downwindDemo.status}</span>
        <strong>{downwindDemo.route}</strong>
      </div>
      <div className="downwind-map">
        <div className="tracking-grid" aria-hidden="true" />
        <svg viewBox="0 0 760 410" aria-hidden="true">
          <path className="tracking-coast" d="M-40 398C101 280 183 328 278 239c91-85 174-56 258-158C599 6 692 22 810-42" />
          <path className="tracking-halo" d="M54 365c92-42 150-81 229-122 91-47 143-101 219-139 68-33 124-68 199-111" />
          <path className="tracking-route" d="M54 365c92-42 150-81 229-122 91-47 143-101 219-139 68-33 124-68 199-111" />
        </svg>
        {downwindDemo.riders.map((rider) => (
          <span className={`downwind-rider downwind-rider-${rider.tone}`} key={rider.name} style={{ left: rider.x, top: rider.y }}>
            <Navigation size={14} /><i><strong>{rider.name}</strong><small>{rider.signal}</small></i>
          </span>
        ))}
      </div>
      <div className="downwind-stats">
        <div><span>distância</span><strong>{downwindDemo.stats.distance} km</strong></div>
        <div><span>máxima</span><strong>{downwindDemo.stats.maxSpeed} nós</strong></div>
        <div><span>na água</span><strong>{downwindDemo.stats.ridersCount} riders</strong></div>
      </div>
      <p className="downwind-support"><Radio size={16} /><span><strong>Apoio em terra</strong> recebeu o último sinal agora.</span></p>
    </article>
  );
}

export function TrackingShowcase() {
  return (
    <section id="downwind" className="landing-water-section section-shell">
      <div className="landing-container">
        <header className="section-heading section-heading-centered">
          <p className="landing-eyebrow">Na água</p>
          <h2>Você está aqui.<br /><em>O grupo também.</em></h2>
          <p>Sua trajetória fica visível enquanto o grupo segue em movimento. Horário do último sinal aparece sem esconder perda de conexão.</p>
          <small className="demo-disclaimer">Interface demonstrativa com dados de exemplo.</small>
        </header>
        <div className="water-bento">
          <TrackingPanel />
          <div className="water-copy-card">
            <Route size={24} />
            <h3>Todo mundo<br />no mesmo mapa.</h3>
            <p>Quem ficou em terra acompanha a rota por link público. Quem está na água vê o grupo e o progresso do downwind.</p>
            <ul>
              <li><LocateFixed size={17} /> posição e trajetória</li>
              <li><Smartphone size={17} /> apoio sem criar conta</li>
              <li><Radio size={17} /> sinal recente identificado</li>
            </ul>
          </div>
          <DownwindMap />
        </div>
      </div>
    </section>
  );
}
