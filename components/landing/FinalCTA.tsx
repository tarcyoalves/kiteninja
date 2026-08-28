import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Smartphone } from 'lucide-react';
import { landingData } from './landingData';

const APP_PATH = '/';

export function FinalCTA() {
  const { finalSection } = landingData;

  return (
    <section id="instalar" className="landing-final-section">
      <div className="landing-final-kite" aria-hidden="true">
        <svg viewBox="0 0 340 180"><path d="M18 104C100 20 236 3 323 63c-110-18-207 15-284 102 5-24-2-44-21-61Z" /></svg>
      </div>
      <div className="landing-container landing-final-layout">
        <div className="landing-final-logo">
          <Image src="/brand/logo-512.png" alt="KiteNinja" fill sizes="170px" />
        </div>
        <div>
          <p>{finalSection.subtitle}</p>
          <h2>Leia o vento.<br />Trace a rota.<br /><em>Volte bem.</em></h2>
          <div className="landing-hero-actions">
            <Link href={APP_PATH} className="landing-button landing-button-primary">
              Abrir o KiteNinja <ArrowRight size={18} />
            </Link>
          </div>
          <p className="landing-install-note">
            <Smartphone size={17} /> {finalSection.installNote}
          </p>
        </div>
      </div>
    </section>
  );
}
