import { LandingNav } from './LandingNav';
import { Hero } from './Hero';
import { ConditionShowcase } from './ConditionShowcase';
import { TrackingShowcase } from './TrackingShowcase';
import { SafetyShowcase } from './SafetyShowcase';
import { SessionCommunity } from './SessionCommunity';
import { FinalCTA } from './FinalCTA';
import { LandingFooter } from './LandingFooter';

/**
 * LandingPage - Página de apresentação pública do KiteNinja (/conheca)
 *
 * Server Component estático por padrão. Apenas o menu mobile (LandingNav)
 * roda no client para permitir a interação de abrir/fechar.
 *
 * Visual: "instrumento de bordo costeiro" — o produto real é o protagonista,
 * os dados de exemplo (condição, downwind, sessão) são claramente marcados
 * como demonstração via aria-label.
 */
export function LandingPage() {
  return (
    <div id="topo" className="landing-page">
      <LandingNav />
      <main>
        <Hero />
        <ConditionShowcase />
        <TrackingShowcase />
        <SafetyShowcase />
        <SessionCommunity />
        <FinalCTA />
      </main>
      <LandingFooter />
    </div>
  );
}
