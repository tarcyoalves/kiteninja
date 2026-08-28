/**
 * Dados demonstrativos para a landing page
 * Todos os dados aqui são exemplificativos e devem ser substituídos por dados reais em produção.
 */

export const landingData = {
  /** Texto manifesto exibido no hero */
  manifesto: 'Vento, rota e segurança para kitesurf',

  /** Subtítulo/chamada principal */
  heroSubtitle:
    'Consulte o spot, acompanhe o grupo e compartilhe sua sessão — da primeira rajada ao último rider fora da água.',

  /** Texto explicativo sobre PWA */
  platformNote: 'PWA para iPhone e Android · use no navegador ou instale na tela inicial',

  /** NavigationItems itens de navegação */
  navigationItems: [
    { href: '#condicao', label: 'Condição' },
    { href: '#downwind', label: 'Downwind' },
    { href: '#seguranca', label: 'Segurança' },
    { href: '#comunidade', label: 'Comunidade' },
  ],

  /** Recursos principais exibidos no hero */
  heroFeatures: [
    { icon: 'Wind', label: 'Vento + maré', suffix: 'por spot' },
    { icon: 'Route', label: 'Downwind', suffix: 'posição ao vivo' },
    { icon: 'LifeBuoy', label: 'SOS', suffix: 'por proximidade' },
  ],

  /** Dados de condição mostrados no console - demonstração */
  conditionDemo: {
    spot: {
      name: 'Ponta do Mel',
      location: 'Areia Branca · RN',
    },
    score: 86,
    scoreLabel: 'favorável',
    lastUpdate: '15:40',
    wind: {
      direction: 'ENE',
      speed: 22,
      gust: 28,
    },
    tide: {
      status: 'vazando',
      height: '1,2',
      nextLow: '18:42',
    },
    forecast: [
      { hour: '15h', wind: 20, gust: 24 },
      { hour: '16h', wind: 22, gust: 28 },
      { hour: '17h', wind: 23, gust: 29 },
      { hour: '18h', wind: 21, gust: 27 },
    ],
    userWeight: 78,
    recommendedKite: '9 m²',
  },

  /** Dados de downwind mostrados no mapa - demonstração */
  downwindDemo: {
    status: 'em andamento',
    route: 'Galinhos → Ponta do Mel',
    riders: [
      { name: 'Você', x: '73%', y: '27%', tone: 'lead', signal: 'agora' },
      { name: 'Rafa', x: '53%', y: '48%', tone: 'crew', signal: '18s' },
      { name: 'Nina', x: '33%', y: '69%', tone: 'crew', signal: '32s' },
    ],
    stats: {
      distance: '18,4',
      maxSpeed: '24,7',
      ridersCount: 3,
    },
    supportMessage: 'Apoio em terra recebeu o último sinal agora',
  },

  /** Dados de sessão mostrados no trace - demonstração */
  sessionDemo: {
    rider: {
      initials: 'TA',
      name: 'Tarcyo Alves',
      spot: 'Ponta do Mel',
      date: 'hoje, 17:48',
      boardType: 'TWINTIP',
    },
    stats: {
      distance: '34,2',
      maxSpeed: '28,4',
      duration: '2h05',
    },
    social: {
      likes: 18,
      comments: 3,
    },
  },

  /** Seção de condição - textos */
  conditionSection: {
    tag: 'Antes da água',
    description:
      'Rajada, direção, maré e janela do dia mudam a decisão. O KiteNinja põe a leitura completa na sua mão, sem fingir que previsão é sensor.',
    features: [
      { icon: 'Navigation', title: 'Direção', description: 'Saiba como o vento cruza a costa.' },
      { icon: 'Waves', title: 'Maré', description: 'Veja a curva e o próximo extremo.' },
      { icon: 'Gauge', title: 'Equipamento', description: 'Comece pela pipa mais coerente com seu peso.' },
    ],
  },

  /** Seção de downwind - textos */
  downwindSection: {
    tag: 'Na água',
    description:
      'O grupo segue em movimento. Quem ficou em terra enxerga a rota, o último sinal e quem ainda está na água.',
    features: [
      {
        icon: 'Radio',
        title: 'Sinais recentes',
        description: 'com horário visível, sem esconder perda de conexão.',
      },
      {
        icon: 'Smartphone',
        title: 'Link público',
        description: 'para o apoio acompanhar sem criar uma conta.',
      },
      {
        icon: 'Zap',
        title: 'Modo navegação',
        description: 'mantém o acompanhamento visível durante o velejo.',
      },
    ],
  },

  /** Seção de segurança - textos */
  safetySection: {
    tag: 'Se algo sair da rota',
    description:
      'O SOS encontra primeiro quem tem mais contexto para responder e amplia o alcance quando ninguém assume o chamado.',
    warning:
      'O KiteNinja complementa a resposta. Em emergência, acione também Bombeiros (193) e Marinha (185).',
    sosSteps: [
      {
        title: 'Posição registrada',
        description: 'O alerta nasce com sua última coordenada disponível.',
      },
      {
        title: 'O grupo recebe primeiro',
        description: 'Quem está no mesmo downwind ganha prioridade.',
      },
      {
        title: 'O raio aumenta',
        description: 'Sem resposta, a busca amplia de 5 para 15 e 50 km.',
      },
    ],
  },

  /** Seção de comunidade - textos */
  communitySection: {
    tag: 'Depois da sessão',
    description:
      'Guarde o que o celular realmente mediu, publique a sessão e encontre riders pelos velejos — não por uma bio genérica.',
    features: [
      'distância, tempo e máxima da sessão',
      'feed, comentários e perfis de riders',
      'diário pessoal para acompanhar evolução',
    ],
  },

  /** Seção final - textos */
  finalSection: {
    subtitle: 'Próxima sessão',
    installNote: 'Funciona como PWA no iPhone e no Android, sem download de APK.',
  },

  /** Footer - textos */
  footer: {
    brand: {
      description: 'Condição, tracking e comunidade para quem vive o vento.',
    },
    explore: {
      title: 'Explore',
      links: [
        { href: '#condicao', label: 'Condição' },
        { href: '#downwind', label: 'Downwind' },
        { href: '#seguranca', label: 'SOS' },
      ],
    },
    access: {
      title: 'Acesse',
      links: [
        { href: '/', label: 'Entrar no app' },
        { href: '#instalar', label: 'Instalar no celular' },
        { href: '/recuperar-senha', label: 'Recuperar senha' },
      ],
    },
    signal: {
      text: 'Feito no Nordeste para dias de vento, água salgada e sinal instável.',
    },
    copyright: '© 2026 KiteNinja',
    disclaimer: 'Previsão orienta. Decisão continua sendo sua.',
  },
};
