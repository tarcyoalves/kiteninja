'use client';

import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  Check,
  Gauge,
  LifeBuoy,
  LocateFixed,
  MapPin,
  MessageCircle,
  Navigation,
  Play,
  Radio,
  Route,
  ShieldCheck,
  Smartphone,
  Waves,
  Wind,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';

const APP_PATH = '/';

function LogoLockup({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="#topo" className="landing-logo" aria-label="KiteNinja — voltar ao início">
      <span className="landing-logo-mark">
        <Image src="/brand/logo-192.png" alt="" fill sizes="48px" priority />
      </span>
      <span className={compact ? 'landing-logo-word landing-logo-word-compact' : 'landing-logo-word'}>
        <strong>KITE</strong>NINJA
      </span>
    </Link>
  );
}

function KiteScene() {
  return (
    <div className="landing-kite-scene">
      <Image
        className="landing-hero-photo"
        src="/brand/tarcyo-kitesurf.webp"
        alt="Kitesurfista KiteNinja velejando com a barra nas mãos"
        fill
        priority
        sizes="(max-width: 900px) 100vw, 52vw"
      />
    </div>
  );
}

function LiveConditions() {
  const forecast = [
    ['15h', '20', '24'],
    ['16h', '22', '28'],
    ['17h', '23', '29'],
    ['18h', '21', '27'],
  ];

  return (
    <div className="landing-condition-console" aria-label="Exemplo de leitura das condições do KiteNinja">
      <header>
        <div>
          <span className="landing-status-dot" />
          Condição agora
        </div>
        <span>atualizado 15:40</span>
      </header>

      <div className="landing-condition-place">
        <div>
          <h3>Ponta do Mel</h3>
          <p><MapPin size={14} /> Areia Branca · RN</p>
        </div>
        <div className="landing-condition-score"><strong>86</strong><span>favorável</span></div>
      </div>

      <div className="landing-condition-main">
        <div className="landing-wind-compass">
          <Navigation size={25} />
          <span>ENE</span>
        </div>
        <div className="landing-wind-reading">
          <strong>22</strong><span>nós</span>
          <p>rajadas de 28</p>
        </div>
        <div className="landing-tide-reading">
          <Waves size={21} />
          <div><span>maré vazando</span><strong>1,2 m</strong><small>baixa 18:42</small></div>
        </div>
      </div>

      <div className="landing-forecast-line">
        {forecast.map(([hour, wind, gust], index) => (
          <div key={hour} className={index === 1 ? 'is-current' : ''}>
            <span>{hour}</span><strong>{wind}</strong><small>{gust}</small>
          </div>
        ))}
      </div>

      <footer>
        <span>Seu peso: 78 kg</span>
        <p>Hoje, comece pela <strong>9 m²</strong>.</p>
      </footer>
    </div>
  );
}

function DownwindMap() {
  const riders = [
    { name: 'Você', x: '73%', y: '27%', tone: 'lead', signal: 'agora' },
    { name: 'Rafa', x: '53%', y: '48%', tone: 'crew', signal: '18s' },
    { name: 'Nina', x: '33%', y: '69%', tone: 'crew', signal: '32s' },
  ];

  return (
    <div className="landing-route-stage" aria-label="Exemplo de acompanhamento de downwind">
      <div className="landing-route-grid" aria-hidden="true" />
      <div className="landing-route-topline">
        <span><i /> Downwind em andamento</span>
        <strong>Galinhos → Ponta do Mel</strong>
      </div>
      <svg className="landing-route-map" viewBox="0 0 760 490" aria-hidden="true">
        <path className="landing-map-land" d="M-40 468C101 333 183 376 278 281c91-91 174-62 258-176C599 21 692 39 810-44" />
        <path className="landing-map-track-halo" d="M54 430c92-47 150-91 229-137 91-53 143-113 219-155 68-37 124-76 199-125" />
        <path className="landing-map-track" d="M54 430c92-47 150-91 229-137 91-53 143-113 219-155 68-37 124-76 199-125" />
      </svg>

      {riders.map((rider) => (
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
        <div><span>distância</span><strong>18,4 <small>km</small></strong></div>
        <div><span>ritmo máximo</span><strong>24,7 <small>nós</small></strong></div>
        <div><span>na água</span><strong>3 <small>riders</small></strong></div>
      </div>
      <div className="landing-route-message"><MessageCircle size={16} /><span><strong>Apoio em terra</strong> recebeu o último sinal agora</span></div>
    </div>
  );
}

function SosFlow() {
  return (
    <div className="landing-sos-flow" aria-label="Como funciona o fluxo de SOS">
      <div className="landing-sos-trigger">
        <span className="landing-sos-rings" aria-hidden="true" />
        <LifeBuoy size={42} />
        <strong>SEGURE<br />PARA SOS</strong>
        <small>800 ms evita toque acidental</small>
      </div>
      <div className="landing-sos-track" aria-hidden="true"><span /><span /><span /></div>
      <ol>
        <li><span>1</span><div><strong>Posição registrada</strong><p>O alerta nasce com sua última coordenada disponível.</p></div></li>
        <li><span>2</span><div><strong>O grupo recebe primeiro</strong><p>Quem está no mesmo downwind ganha prioridade.</p></div></li>
        <li><span>3</span><div><strong>O raio aumenta</strong><p>Sem resposta, a busca amplia de 5 para 15 e 50 km.</p></div></li>
      </ol>
    </div>
  );
}

function SessionTrace() {
  return (
    <div className="landing-session-trace" aria-label="Exemplo de sessão registrada">
      <div className="landing-session-profile">
        <span>TA</span>
        <div><strong>Tarcyo Alves</strong><small>Ponta do Mel · hoje, 17:48</small></div>
        <i>TWINTIP</i>
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
        <div><span>Distância</span><strong>34,2 km</strong></div>
        <div><span>Velocidade máxima</span><strong>28,4 nós</strong></div>
        <div><span>Tempo na água</span><strong>2h05</strong></div>
      </div>
      <footer><span>♥ 18 riders curtiram</span><span>3 comentários</span></footer>
    </div>
  );
}

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const close = () => setMenuOpen(false);
    window.addEventListener('resize', close, { passive: true });
    return () => window.removeEventListener('resize', close);
  }, []);

  return (
    <div id="topo" className="landing-page">
      <header className="landing-header">
        <div className="landing-container landing-header-inner">
          <LogoLockup compact />
          <nav className="landing-desktop-nav" aria-label="Navegação da apresentação">
            <a href="#condicao">Condição</a>
            <a href="#downwind">Downwind</a>
            <a href="#seguranca">Segurança</a>
            <a href="#comunidade">Comunidade</a>
          </nav>
          <div className="landing-header-actions">
            <Link href={APP_PATH} className="landing-login">Já tenho conta</Link>
            <Link href={APP_PATH} className="landing-button landing-button-small">Abrir o app <ArrowRight size={15} /></Link>
            <button
              type="button"
              className="landing-menu-button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-label="Abrir menu"
            >
              {menuOpen ? <X size={22} /> : <span><i /><i /><i /></span>}
            </button>
          </div>
        </div>
        {menuOpen ? (
          <nav className="landing-mobile-nav" aria-label="Navegação móvel">
            <a href="#condicao" onClick={() => setMenuOpen(false)}>Condição</a>
            <a href="#downwind" onClick={() => setMenuOpen(false)}>Downwind</a>
            <a href="#seguranca" onClick={() => setMenuOpen(false)}>Segurança</a>
            <a href="#comunidade" onClick={() => setMenuOpen(false)}>Comunidade</a>
            <Link href={APP_PATH}>Entrar no KiteNinja <ArrowRight size={16} /></Link>
          </nav>
        ) : null}
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-hero-sky" aria-hidden="true"><i /><i /><i /><i /></div>
          <div className="landing-container landing-hero-layout">
            <div className="landing-hero-copy">
              <p className="landing-manifesto">Vento, rota e segurança para kitesurf</p>
              <h1>O vento chama.<br /><em>Você entra sabendo.</em></h1>
              <p className="landing-lead">
                Consulte o spot, acompanhe o grupo e compartilhe sua sessão — da primeira rajada ao último rider fora da água.
              </p>
              <div className="landing-hero-actions">
                <Link href={APP_PATH} className="landing-button landing-button-primary">Abrir o KiteNinja <ArrowRight size={18} /></Link>
                <a href="#downwind" className="landing-button landing-button-quiet"><Play size={16} fill="currentColor" /> Ver como funciona</a>
              </div>
              <p className="landing-platform-note"><Smartphone size={15} /> PWA para iPhone e Android · use no navegador ou instale na tela inicial</p>
              <div className="landing-hero-facts" aria-label="Recursos principais">
                <span><Wind size={17} /><strong>Vento + maré</strong>por spot</span>
                <span><Route size={17} /><strong>Downwind</strong>posição ao vivo</span>
                <span><LifeBuoy size={17} /><strong>SOS</strong>por proximidade</span>
              </div>
            </div>
            <KiteScene />
          </div>
          <div className="landing-wind-tape" aria-label="Exemplo de telemetria de vento">
            <div>
              <span>PONTA DO MEL</span><strong>22 NÓS</strong><i>ENE</i>
              <span>RAJADA</span><strong>28 NÓS</strong><i>MARÉ ↓ 1,2 M</i>
              <span>PONTA DO MEL</span><strong>22 NÓS</strong><i>ENE</i>
              <span>RAJADA</span><strong>28 NÓS</strong><i>MARÉ ↓ 1,2 M</i>
            </div>
          </div>
        </section>

        <section id="condicao" className="landing-condition-section">
          <div className="landing-condition-swoop" aria-hidden="true" />
          <div className="landing-container landing-condition-layout">
            <div className="landing-section-copy landing-condition-copy">
              <span className="landing-hand-note">Antes da água</span>
              <h2>Não olhe só<br />para os <em>nós.</em></h2>
              <p>Rajada, direção, maré e janela do dia mudam a decisão. O KiteNinja põe a leitura completa na sua mão, sem fingir que previsão é sensor.</p>
              <dl className="landing-condition-list">
                <div><dt><Navigation size={18} /> Direção</dt><dd>Saiba como o vento cruza a costa.</dd></div>
                <div><dt><Waves size={18} /> Maré</dt><dd>Veja a curva e o próximo extremo.</dd></div>
                <div><dt><Gauge size={18} /> Equipamento</dt><dd>Comece pela pipa mais coerente com seu peso.</dd></div>
              </dl>
            </div>
            <LiveConditions />
          </div>
        </section>

        <section id="downwind" className="landing-downwind-section">
          <div className="landing-container">
            <div className="landing-downwind-heading">
              <span>Na água</span>
              <h2>Todo mundo<br />no mesmo mapa.</h2>
              <p>O grupo segue em movimento. Quem ficou em terra enxerga a rota, o último sinal e quem ainda está na água.</p>
            </div>
            <DownwindMap />
            <div className="landing-downwind-notes">
              <div><Radio size={20} /><p><strong>Sinais recentes</strong> com horário visível, sem esconder perda de conexão.</p></div>
              <div><Smartphone size={20} /><p><strong>Link público</strong> para o apoio acompanhar sem criar uma conta.</p></div>
              <div><Zap size={20} /><p><strong>Modo navegação</strong> mantém o acompanhamento visível durante o velejo.</p></div>
            </div>
          </div>
        </section>

        <section id="seguranca" className="landing-safety-section">
          <div className="landing-safety-slash" aria-hidden="true" />
          <div className="landing-container landing-safety-layout">
            <div className="landing-section-copy landing-safety-copy">
              <span className="landing-hand-note">Se algo sair da rota</span>
              <h2>O pedido de ajuda<br /><em>não fica parado.</em></h2>
              <p>O SOS encontra primeiro quem tem mais contexto para responder e amplia o alcance quando ninguém assume o chamado.</p>
              <div className="landing-safety-warning"><ShieldCheck size={19} /><span>O KiteNinja complementa a resposta. Em emergência, acione também Bombeiros (193) e Marinha (185).</span></div>
            </div>
            <SosFlow />
          </div>
        </section>

        <section id="comunidade" className="landing-community-section">
          <div className="landing-container landing-community-layout">
            <SessionTrace />
            <div className="landing-section-copy landing-community-copy">
              <span className="landing-hand-note">Depois da sessão</span>
              <h2>O traço fica.<br /><em>A história também.</em></h2>
              <p>Guarde o que o celular realmente mediu, publique a sessão e encontre riders pelos velejos — não por uma bio genérica.</p>
              <ul>
                <li><Check size={15} /> distância, tempo e máxima da sessão</li>
                <li><Check size={15} /> feed, comentários e perfis de riders</li>
                <li><Check size={15} /> diário pessoal para acompanhar evolução</li>
              </ul>
              <Link href={`${APP_PATH}?tab=sessoes`} className="landing-text-link">Abrir meu diário <ArrowRight size={17} /></Link>
            </div>
          </div>
        </section>

        <section id="instalar" className="landing-final-section">
          <div className="landing-final-kite" aria-hidden="true">
            <svg viewBox="0 0 340 180"><path d="M18 104C100 20 236 3 323 63c-110-18-207 15-284 102 5-24-2-44-21-61Z" /></svg>
          </div>
          <div className="landing-container landing-final-layout">
            <div className="landing-final-logo"><Image src="/brand/logo-512.png" alt="KiteNinja" fill sizes="170px" /></div>
            <div>
              <p>Próxima sessão</p>
              <h2>Leia o vento.<br />Trace a rota.<br /><em>Volte bem.</em></h2>
              <div className="landing-hero-actions">
                <Link href={APP_PATH} className="landing-button landing-button-primary">Abrir o KiteNinja <ArrowRight size={18} /></Link>
              </div>
              <p className="landing-install-note"><Smartphone size={17} /> Funciona como PWA no iPhone e no Android, sem download de APK.</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container landing-footer-main">
          <div><LogoLockup /><p>Condição, tracking e comunidade para quem vive o vento.</p></div>
          <nav aria-label="Links do produto"><strong>Explore</strong><a href="#condicao">Condição</a><a href="#downwind">Downwind</a><a href="#seguranca">SOS</a></nav>
          <nav aria-label="Links de acesso"><strong>Acesse</strong><Link href={APP_PATH}>Entrar no app</Link><a href="#instalar">Instalar no celular</a><Link href="/recuperar-senha">Recuperar senha</Link></nav>
          <div className="landing-footer-signal"><LocateFixed size={19} /><p>Feito no Nordeste para dias de vento, água salgada e sinal instável.</p></div>
        </div>
        <div className="landing-container landing-footer-bottom"><span>© 2026 KiteNinja</span><span>Previsão orienta. Decisão continua sendo sua.</span></div>
      </footer>
    </div>
  );
}
