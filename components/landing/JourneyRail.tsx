export function JourneyRail() {
  const steps = [
    { index: '01', label: 'Antes da água', detail: 'Condição e decisão', href: '#condicao' },
    { index: '02', label: 'Na água', detail: 'Tracking e downwind', href: '#downwind' },
    { index: '03', label: 'Se sair da rota', detail: 'SOS e proximidade', href: '#seguranca' },
    { index: '04', label: 'Depois', detail: 'Histórico e comunidade', href: '#comunidade' },
  ];

  return (
    <section id="jornada" className="landing-journey" aria-labelledby="journey-title">
      <div className="landing-container">
        <div className="journey-heading">
          <p className="landing-eyebrow">A sessão inteira</p>
          <h2 id="journey-title">Leia o vento.<br />Trace a rota.<br /><em>Volte bem.</em></h2>
        </div>
        <nav className="journey-steps" aria-label="Etapas da experiência KiteNinja">
          {steps.map((step) => (
            <a key={step.index} href={step.href}>
              <span>{step.index}</span>
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </a>
          ))}
        </nav>
      </div>
    </section>
  );
}
