import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, LifeBuoy, Play, Route, Smartphone, Wind } from 'lucide-react';
import { landingData } from './landingData';
import { JourneyRail } from './JourneyRail';

const APP_PATH = '/';

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

function HeroFacts() {
  const icons = { Wind, Route, LifeBuoy };

  return (
    <div className="landing-hero-facts" aria-label="Recursos principais">
      {landingData.heroFeatures.map((feature) => {
        const Icon = icons[feature.icon as keyof typeof icons];
        return (
          <span key={feature.label}>
            <Icon size={17} />
            <strong>{feature.label}</strong>
            {feature.suffix}
          </span>
        );
      })}
    </div>
  );
}

export function Hero() {
  return (
    <section className="landing-hero">
      <div className="landing-hero-sky" aria-hidden="true">
        <i /><i /><i /><i />
      </div>
      <div className="landing-container landing-hero-layout">
        <div className="landing-hero-copy">
          <p className="landing-manifesto">{landingData.manifesto}</p>
          <h1>
            O vento chama.<br /><em>Você entra sabendo.</em>
          </h1>
          <p className="landing-lead">{landingData.heroSubtitle}</p>
          <div className="landing-hero-actions">
            <Link href={APP_PATH} className="landing-button landing-button-primary">
              Abrir o KiteNinja <ArrowRight size={18} />
            </Link>
            <a href="#downwind" className="landing-button landing-button-quiet">
              <Play size={16} fill="currentColor" /> Ver como funciona
            </a>
          </div>
          <p className="landing-platform-note">
            <Smartphone size={15} /> {landingData.platformNote}
          </p>
          <HeroFacts />
        </div>
        <KiteScene />
      </div>
      <JourneyRail />
    </section>
  );
}
