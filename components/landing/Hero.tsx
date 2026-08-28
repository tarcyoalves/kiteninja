import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, LifeBuoy, Route, ShieldCheck, Smartphone, Wind } from 'lucide-react';
import { ProductFrame } from './ProductFrame';

const APP_PATH = '/';

export function Hero() {
  return (
    <section className="landing-hero" aria-labelledby="landing-title">
      <div className="landing-hero-photo-wrap" aria-hidden="true">
        <Image
          className="landing-hero-photo"
          src="/brand/tarcyo-kitesurf.webp"
          alt=""
          fill
          priority
          sizes="100vw"
        />
      </div>
      <div className="landing-hero-vignette" aria-hidden="true" />
      <div className="landing-container landing-hero-grid">
        <div className="landing-hero-copy">
          <p className="landing-eyebrow">Condição · tracking · segurança</p>
          <h1 id="landing-title">O vento chama.<br /><em>Você entra sabendo.</em></h1>
          <p className="landing-lead">Do primeiro olhar para o spot ao último rider fora da água. Uma leitura contínua da sessão inteira.</p>
          <div className="landing-hero-actions">
            <Link href={APP_PATH} className="landing-button landing-button-primary">
              Abrir o KiteNinja <ArrowRight size={18} />
            </Link>
            <a href="#jornada" className="landing-button landing-button-secondary">Ver a jornada</a>
          </div>
          <p className="landing-platform-note"><Smartphone size={16} /> PWA para iPhone e Android. Instale direto pela tela inicial.</p>
        </div>

        <div className="landing-hero-product">
          <ProductFrame />
          <div className="hero-signal-card hero-signal-wind"><Wind size={17} /><span><strong>22 nós</strong> ENE</span></div>
          <div className="hero-signal-card hero-signal-route"><Route size={17} /><span><strong>3 riders</strong> na rota</span></div>
          <div className="hero-signal-card hero-signal-safety"><ShieldCheck size={17} /><span><strong>SOS</strong> por proximidade</span></div>
        </div>
      </div>

      <div className="landing-hero-proof" aria-label="O que acompanha a sessão">
        <div><Wind size={18} /><span><strong>Antes</strong> condição completa</span></div>
        <div><Route size={18} /><span><strong>Na água</strong> grupo e trajetória</span></div>
        <div><LifeBuoy size={18} /><span><strong>Se precisar</strong> ajuda em movimento</span></div>
      </div>
    </section>
  );
}
