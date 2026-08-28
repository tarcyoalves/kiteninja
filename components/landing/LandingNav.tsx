'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { landingData } from './landingData';

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

export function LandingNav() {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const close = () => setMenuOpen(false);
    window.addEventListener('resize', close, { passive: true });
    return () => window.removeEventListener('resize', close);
  }, []);

  return (
    <header className="landing-header">
      <div className="landing-container landing-header-inner">
        <LogoLockup compact />
        <nav className="landing-desktop-nav" aria-label="Navegação da apresentação">
          {landingData.navigationItems.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="landing-header-actions">
          <Link href={APP_PATH} className="landing-login">
            Já tenho conta
          </Link>
          <Link href={APP_PATH} className="landing-button landing-button-small">
            Abrir o app <ArrowRight size={15} />
          </Link>
          <button
            type="button"
            className="landing-menu-button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="landing-mobile-menu"
            aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
          >
            {menuOpen ? <X size={22} /> : <span><i /><i /><i /></span>}
          </button>
        </div>
      </div>
      {menuOpen ? (
        <nav id="landing-mobile-menu" className="landing-mobile-nav" aria-label="Navegação móvel">
          {landingData.navigationItems.map((item) => (
            <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>
              {item.label}
            </a>
          ))}
          <Link href={APP_PATH}>Entrar no KiteNinja <ArrowRight size={16} /></Link>
        </nav>
      ) : null}
    </header>
  );
}
