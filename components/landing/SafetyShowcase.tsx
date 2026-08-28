import { LifeBuoy, ShieldCheck } from 'lucide-react';
import { landingData } from './landingData';

function SosFlow() {
  const { safetySection } = landingData;

  return (
    <div className="landing-sos-flow" aria-label="Como funciona o fluxo de SOS">
      <div className="landing-sos-trigger">
        <span className="landing-sos-rings" aria-hidden="true" />
        <LifeBuoy size={42} />
        <strong>SEGURE<br />PARA SOS</strong>
        <small>800 ms evita toque acidental</small>
      </div>
      <div className="landing-sos-track" aria-hidden="true">
        <span /><span /><span />
      </div>
      <ol>
        {safetySection.sosSteps.map((step, index) => (
          <li key={step.title}>
            <span>{index + 1}</span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function SafetyShowcase() {
  const { safetySection } = landingData;

  return (
    <section id="seguranca" className="landing-safety-section">
      <div className="landing-safety-slash" aria-hidden="true" />
      <div className="landing-container landing-safety-layout">
        <div className="landing-section-copy landing-safety-copy">
          <span className="landing-hand-note">{safetySection.tag}</span>
          <h2>O pedido de ajuda<br /><em>não fica parado.</em></h2>
          <p>{safetySection.description}</p>
          <div className="landing-safety-warning">
            <ShieldCheck size={19} />
            <span>{safetySection.warning}</span>
          </div>
        </div>
        <SosFlow />
      </div>
    </section>
  );
}
