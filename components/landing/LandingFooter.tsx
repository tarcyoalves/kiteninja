import Image from 'next/image';
import Link from 'next/link';
import { LocateFixed } from 'lucide-react';
import { landingData } from './landingData';

const APP_PATH = '/';

function LogoLockup() {
  return (
    <Link href="#topo" className="landing-logo" aria-label="KiteNinja — voltar ao início">
      <span className="landing-logo-mark">
        <Image src="/brand/logo-192.png" alt="" fill sizes="48px" />
      </span>
      <span className="landing-logo-word">
        <strong>KITE</strong>NINJA
      </span>
    </Link>
  );
}

export function LandingFooter() {
  const { footer } = landingData;

  return (
    <footer className="landing-footer">
      <div className="landing-container landing-footer-main">
        <div>
          <LogoLockup />
          <p>{footer.brand.description}</p>
        </div>
        <nav aria-label="Links do produto">
          <strong>{footer.explore.title}</strong>
          {footer.explore.links.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <nav aria-label="Links de acesso">
          <strong>{footer.access.title}</strong>
          {footer.access.links.map((link) =>
            link.href.startsWith('#') ? (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ) : (
              <Link key={link.href} href={link.href}>
                {link.label}
              </Link>
            )
          )}
        </nav>
        <div className="landing-footer-signal">
          <LocateFixed size={19} />
          <p>{footer.signal.text}</p>
        </div>
      </div>
      <div className="landing-container landing-footer-bottom">
        <span>{footer.copyright}</span>
        <span>{footer.disclaimer}</span>
      </div>
    </footer>
  );
}
