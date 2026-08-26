export type WindUnit = 'nós' | 'km/h' | 'mph';
export type TideStatus = 'subindo' | 'descendo' | 'estável';
export type WindSafety = 'Side-Onshore' | 'Side-Shore' | 'Onshore' | 'Side-Offshore' | 'Offshore';
export type RiderLevel = 'Iniciante' | 'Intermediário' | 'Avançado' | 'Profissional';
export type Discipline = 'Kitesurf Twintip' | 'Kitesurf Strapless Wave' | 'Hydrofoil' | 'Wingfoil' | 'Big Air';

export interface SailingScore {
  totalScore: number; // 0 a 100
  classification: 'Épico' | 'Muito Bom' | 'Bom' | 'Regular' | 'Ruim';
  badgeColor: string;
  summary: string;
  breakdown: {
    windSpeedScore: number; // máx 35
    gustQualityScore: number; // máx 20
    directionSafetyScore: number; // máx 25
    tideWaterScore: number; // máx 20
  };
}

export interface WindForecastHour {
  hour: string; // e.g. "00h", "03h", "06h", "09h", "12h", "15h", "18h", "21h"
  knots: number;
  gustKnots: number;
  directionDeg: number; // 0-360
  directionText: string; // e.g. "ENE", "E", "SE"
  conditionIcon: 'sun' | 'moon' | 'cloud-sun' | 'cloud-moon' | 'cloud' | 'rain';
  temperature: number; // in °C
  pressureHpa: number;
  /**
   * Onda e maré vêm de uma segunda API (marine), que pode falhar sozinha ou
   * não cobrir a hora. `null` significa "sem dado" e é diferente de 0: maré de
   * 0,00m é uma leitura real e legítima. Cair para 0 aqui fazia a tela mostrar
   * "0.0m / 0s" como se fosse previsão, escondendo a falha.
   */
  waveHeightM: number | null;
  wavePeriodS: number | null;
  waveDirDeg: number | null;
  /** Detalhamento do Swell oceânico de fundo */
  swellHeightM?: number | null;
  swellPeriodS?: number | null;
  swellDirDeg?: number | null;
  /** Detalhamento de vagas de vento local */
  windWaveHeightM?: number | null;
  windWavePeriodS?: number | null;
  windWaveDirDeg?: number | null;
  /** `null` quando não há série de maré para deduzir a tendência. */
  tideTrend: 'up' | 'down' | 'peak_high' | 'peak_low' | null;
  tideHeightM: number | null;
  tidePeakTime?: string;
  tidePeakHeight?: string;
  /** Score do velejo para esta hora específica */
  sailingScore?: SailingScore;
}

export interface DayForecast {
  dateStr: string; // e.g. "SEXTA-FEIRA, 14/08"
  shortDate: string; // e.g. "Hoje, 14 Ago"
  hours: WindForecastHour[];
}

export interface Spot {
  id: string;
  name: string;
  location: string;
  state: string;
  country: string;
  countryFlag: string;
  lat: number;
  lng: number;
  isFavorite: boolean;
  currentKnots: number;
  avgKnots?: number;
  maxKnots: number;
  gustKnots?: number;
  windDirectionDeg: number;
  windDirectionText: string;
  windSafety: WindSafety;
  temperature: number;
  weatherDescription: string;
  weatherIcon: 'sun' | 'moon' | 'cloud-sun' | 'cloud-moon' | 'cloud' | 'rain';
  isLiveObservation: boolean;
  stationName?: string;
  stationProvider?: string;
  lastUpdated: string;
  lastUpdatedFull?: string;
  nextUpdate: string;
  /** `null` quando a API marinha não cobriu o spot — ver WindForecastHour. */
  currentTideHeightM: number | null;
  currentTideTrend: TideStatus | null;
  nextTideInfo: string;
  nextTideHeightM?: number | null;
  nextTideTime?: string | null;
  waveHeightM: number | null;
  wavePeriodS: number | null;
  /** Detalhamento de ondas e swell */
  swellHeightM?: number | null;
  swellPeriodS?: number | null;
  swellDirDeg?: number | null;
  windWaveHeightM?: number | null;
  windWavePeriodS?: number | null;
  windWaveDirDeg?: number | null;
  /** Pontuação e diagnóstico náutico da sessão */
  sailingScore?: SailingScore;
  waterCondition: 'Flat / Lagoa' | 'Chop Médio' | 'Ondas / Swell' | 'Água Rasa';
  bottomType: 'Areia' | 'Coral / Pedras' | 'Misto';
  difficulty: RiderLevel;
  idealWindDirections: string[];
  hazards: string[];
  amenities: string[];
  webcamUrl?: string;
  webcamLiveStream?: boolean;
  coverImage: string;
  daysForecast: DayForecast[];
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  riderId: string;
  nationality: string;
  countryFlag: string;
  weightKg: number;
  heightCm?: number;
  riderLevel: RiderLevel;
  homeSpot: string;
  disciplines: Discipline[];
  quiverKites?: number[];
  quiverBoards?: string[];
  preferredWindUnit?: string;
  totalSessions: number;
  totalHours: number;
  totalKm: number;
  maxKnotsRidden: number;
  highestJumpM?: number;
  bio?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
}

export interface SessionLog {
  id: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  spotId: string;
  spotName: string;
  spotLocation: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  discipline: Discipline;
  kiteSizeM2: number;
  boardModel?: string;
  avgWindKnots: number;
  maxGustKnots?: number;
  windDirection: string;
  tideCondition: 'Seca' | 'Enchendo' | 'Cheia' | 'Vazando';
  waterCondition: string;
  rating: number; // 1 to 5
  distanceKm?: number;
  maxSpeedKnots?: number;
  highestJumpM?: number;
  notes?: string;
  photoUrl?: string;
  isPublic: boolean;
  likesCount: number;
  commentsCount: number;
  createdAt: string;
  /**
   * Trilha GPS reduzida (`[lat, lng, tsMs]`, no máximo ~200 pontos) medida
   * pelo Modo Navegação — mesmo formato de `downwind_participantes.
   * trilha_reduzida`. `undefined`/ausente numa sessão digitada manualmente
   * ou sem trilha válida; nunca um campo editável no formulário, é dado
   * medido, não digitado (ver `lib/trilhaSessao.ts`, `PrefillLogbook`).
   */
  trilhaReduzida?: Array<[number, number, number]>;
}

/**
 * Um item de `GET /api/feed` (Fase 3 do plano de rede social): a sessão de
 * velejo de alguém que eu sigo (ou minha própria), já com autor, curtidas e
 * contagem de comentários embutidos — a rota devolve tudo numa única
 * consulta (ver comentário lá) para o card não fazer N+1 por sessão.
 *
 * Não é o mesmo tipo de `SessionLog` (o logbook pessoal, `GET /api/sessions`)
 * de propósito: o feed nunca precisa de `notes`/`photoUrl` do dono e sempre
 * precisa de autor+curtidas, que o logbook nunca precisa (é sempre "eu").
 * Duplicar os poucos campos em comum é mais barato que um tipo genérico que
 * dois consumidores tão diferentes teriam que forçar a caber.
 */
export interface SessionFeedItem {
  id: string;
  spotName: string;
  spotLocation: string;
  createdAt: string;
  durationMinutes: number;
  discipline: Discipline;
  boardModel?: string;
  avgWindKnots: number;
  maxGustKnots?: number;
  distanceKm?: number;
  maxSpeedKnots?: number;
  /** Manual, do logbook — NUNCA calculado do GPS (ver seção 5 do plano: altura
   * de salto por GPS de celular é ruído, não dado). Ausente = não preenchido. */
  highestJumpM?: number;
  /** Mesmo formato de SessionLog.trilhaReduzida — ausente em sessão digitada
   * à mão, sem GPS. O card nunca desenha mapa/números de trilha nesse caso. */
  trilhaReduzida?: Array<[number, number, number]>;
  authorId: string;
  authorName: string;
  authorAvatarUrl?: string;
  authorRiderId: string;
  authorCountryFlag: string;
  /** Quantas curtidas a sessão tem agora (já contando a minha, se eu curti). */
  curtidas: number;
  /** Se EU curti esta sessão — a rota já resolve isso pelo cookie de sessão,
   * então o card nunca precisa perguntar de novo. */
  euCurti: boolean;
  /** Só a contagem nesta fase — ler/escrever comentário é a Fase 4 (tela de
   * detalhe da sessão), de propósito (ver docs/PLANO-REDE-SOCIAL.md). */
  comentarios: number;
}

/** Sessão completa para a tela de detalhe (Fase 5): tudo que SessionFeedItem
 * deliberadamente NÃO tem (notes, photoUrl, kiteSizeM2, windDirection,
 * tideCondition, waterCondition, rating) porque o feed não precisa, mas o
 * detalhe sim. */
export interface SessionDetail {
  id: string;
  spotName: string;
  spotLocation: string;
  date: string;
  startTime: string;
  createdAt: string;
  durationMinutes: number;
  discipline: Discipline;
  kiteSizeM2: number;
  boardModel?: string;
  avgWindKnots: number;
  maxGustKnots?: number;
  windDirection: string;
  tideCondition: 'Seca' | 'Enchendo' | 'Cheia' | 'Vazando';
  waterCondition: string;
  rating: number;
  distanceKm?: number;
  maxSpeedKnots?: number;
  highestJumpM?: number;
  notes?: string;
  photoUrl?: string;
  isPublic: boolean;
  trilhaReduzida?: Array<[number, number, number]>;
  authorId: string;
  authorName: string;
  authorAvatarUrl?: string;
  authorRiderId: string;
  authorCountryFlag: string;
  curtidas: number;
  euCurti: boolean;
  comentarios: number;
}

/** Um comentário em uma sessão (Fase 5). */
export interface SessionComment {
  id: string;
  userId: string;
  userName: string;
  userAvatarUrl?: string;
  text: string;
  createdAt: string;
  /** `null` = comentário de primeiro nível. Presente = é resposta a esse
   * comentário-pai (Fase 6, estilo Facebook: só 1 nível — ver
   * lib/social.ts, podeResponderComentario). */
  parentCommentId: string | null;
}

/**
 * Uma notificação da central de atividades in-app (Fase 6 do plano de rede
 * social — SEM push de propósito, decisão do dono do produto). `actorId`/
 * `actorName` são quem praticou a ação; `sessionId`/`spotName` e
 * `commentId`/`commentText` só vêm preenchidos quando fazem sentido para o
 * tipo (ver GET /api/notifications).
 */
export interface AppNotification {
  id: string;
  type: 'curtida_sessao' | 'comentario_sessao' | 'resposta_comentario' | 'novo_seguidor' | 'convite_downwind';
  actorId: string;
  actorName: string;
  actorAvatarUrl?: string;
  sessionId?: string;
  spotName?: string;
  commentId?: string;
  commentText?: string;
  downwindId?: string;
  inviteId?: string;
  downwindNome?: string;
  readAt: string | null;
  createdAt: string;
}

export type TipoChamado = 'bug' | 'melhoria';
export type StatusChamado = 'novo' | 'em_analise' | 'aprovado' | 'rejeitado' | 'implementado';

/** Um chamado de bug/melhoria reportado por um usuário — visão do PRÓPRIO
 * usuário que reportou (sem dado de outros usuários). */
export interface MeuChamado {
  id: string;
  tipo: TipoChamado;
  titulo: string;
  descricao: string;
  tela?: string;
  status: StatusChamado;
  parecer?: string;
  createdAt: string;
}

/** Visão de administração: mesmo chamado, mais quem reportou (para o dono
 * saber quem é, sem expor isso ao próprio autor do chamado nem a terceiros). */
export interface ChamadoAdmin extends MeuChamado {
  autorId: string;
  autorNome: string;
  autorAvatarUrl?: string;
}

export interface CommunityPost {
  id: string;
  authorName: string;
  authorAvatar?: string;
  authorRiderId: string;
  authorCountryFlag: string;
  title: string;
  content: string;
  spotName: string;
  spotLocation: string;
  timestamp: string;
  photoUrl?: string;
  windReport?: {
    knots: number;
    kiteUsed: string;
    condition: string;
  };
  likes: number;
  isLiked?: boolean;
  comments: {
    id: string;
    userName: string;
    userAvatar?: string;
    text: string;
    time: string;
  }[];
  shares: number;
  tag?: string; // e.g. "Relato", "Alerta", "Aulas", "Downwind"
}

export interface SafetyOccurrence {
  id: string;
  title: string;
  spotName: string;
  severity: 'alerta' | 'perigo' | 'informativo';
  description: string;
  reportedBy: string;
  timestamp: string;
  status: 'Ativo' | 'Resolvido';
}

export interface KiteEvent {
  id: string;
  title: string;
  date: string;
  location: string;
  spotName: string;
  type: 'Downwind' | 'Campeonato' | 'Clínica / Aulas' | 'Encontro de Riders';
  description: string;
  organizer: string;
  imageUrl?: string;
  participantsCount: number;
  isRegistered?: boolean;
  /** Presente só em eventos type === 'Downwind' que têm downwind vinculado. */
  downwindId?: string | null;
  downwindStatus?: 'aberto' | 'em_andamento' | 'encerrado' | 'cancelado' | null;
  /** True quando EU fui quem criou o downwind vinculado — controla se o botão
   * de apagar aparece para um organizador comum (que não é admin/moderador)
   * além da moderação. Calculado no servidor (GET /api/events), nunca no
   * cliente — evita mostrar um botão que a rota de apagar recusaria. */
  downwindCriadoPorMim?: boolean;
}

// ------------------------------------------------------------- marketplace
export type ListingCategory =
  | 'Kite'
  | 'Prancha'
  | 'Barra'
  | 'Trapézio'
  | 'Foil'
  | 'Wing'
  | 'Neoprene'
  | 'Acessório'
  | 'Outro';

export type ListingCondition = 'Novo' | 'Semi-novo' | 'Usado' | 'Bem usado' | 'Para reparo';

export type ListingStatus = 'Ativo' | 'Reservado' | 'Vendido' | 'Removido';

export type ListingSort = 'recent' | 'price_asc' | 'price_desc';

/**
 * Anúncio do marketplace.
 *
 * `priceCents` é inteiro em centavos, espelhando a coluna do banco. A conversão
 * para reais acontece só na formatação — nenhuma conta de dinheiro usa float.
 */
export interface Listing {
  id: string;
  userId: string;
  title: string;
  description: string;
  category: ListingCategory;
  condition: ListingCondition;
  priceCents: number;
  negotiable: boolean;
  brand?: string;
  model?: string;
  yearManufactured?: number;
  sizeM2?: number;
  sizeCm?: number;
  city: string;
  state: string;
  status: ListingStatus;
  viewsCount: number;
  createdAt: string;
  updatedAt: string;
  /** Primeira foto no feed; no detalhe vem a lista completa em `photos`. */
  coverPhoto?: string;
  photos?: string[];
  sellerName: string;
  sellerAvatar?: string;
  sellerRiderId?: string;
  favoritesCount: number;
  isFavorite: boolean;
  isOwner: boolean;
}

/** Filtros do feed do marketplace. `null` = filtro não aplicado. */
export interface ListingFilters {
  category: ListingCategory | null;
  condition: ListingCondition | null;
  state: string | null;
  /** Em centavos, para casar com a coluna sem conversão intermediária. */
  minPriceCents: number | null;
  maxPriceCents: number | null;
  minSize: number | null;
  maxSize: number | null;
  q: string;
  sort: ListingSort;
  mine: boolean;
  favorites: boolean;
}

// ------------------------------------------------ chat de velejadores online

/** Mensagem do chat como a API devolve. `createdAt` é sempre ISO em UTC. */
export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  userRiderId: string;
  text: string;
  createdAt: string;
}

/**
 * Um velejador visto recentemente. Não existe campo `isOnline`: a presença é
 * derivada de `lastSeenAt` contra a janela (ver PRESENCE_WINDOW_MS em
 * lib/chat.ts), porque o celular fecha o app sem avisar e um booleano ficaria
 * preso em `true`.
 */
export interface OnlineRider {
  userId: string;
  userName: string;
  userAvatar?: string;
  userRiderId: string;
  userLevel: string;
  countryFlag: string;
  /** Sala onde a pessoa está com o chat aberto, se estiver em alguma. */
  room?: string;
  /** Spot que o velejador marcou como "estou aqui". */
  atSpotId?: string;
  atSpotName?: string;
  lastSeenAt: string;
}

/** Uma conversa direta (DM), como a API de inbox (`/api/chat/dms`) devolve. */
export interface DmConversation {
  userId: string;
  userName: string;
  userAvatar?: string;
  userRiderId: string;
  countryFlag?: string;
  lastMessage: {
    text: string;
    createdAt: string;
    fromMe: boolean;
  };
}

/**
 * Relação entre quem busca e o rider encontrado — mesmos 4 valores de
 * `RelacaoRider` em lib/social.ts (não importado aqui porque types.ts não
 * depende de código de servidor; a UI só precisa da união de strings).
 */
export type RelacaoRider = 'amigos' | 'seguindo' | 'segue_voce' | 'nenhuma';

/** Um resultado de `GET /api/riders/search` — nunca inclui e-mail. */
export interface RiderSearchResult {
  id: string;
  name: string;
  avatarUrl?: string;
  riderId: string;
  countryFlag: string;
  riderLevel: RiderLevel;
  homeSpot?: string;
  relacao: RelacaoRider;
}

/**
 * Perfil público de um velejador — `GET /api/riders/[id]` (Fase 4 do plano de
 * rede social). Superconjunto de `RiderSearchResult`: o perfil precisa de
 * nacionalidade, bio, disciplinas e contadores de seguidores/seguindo, que a
 * busca (uma lista compacta) nunca precisa. Assim como `RiderSearchResult`,
 * NUNCA inclui email/senha/IP/contato de emergência — ver
 * app/api/riders/[id]/route.ts.
 */
export interface RiderProfile {
  id: string;
  name: string;
  avatarUrl?: string;
  riderId: string;
  countryFlag: string;
  nationality: string;
  riderLevel: RiderLevel;
  homeSpot?: string;
  bio?: string;
  disciplines: Discipline[];
  /** Quantos velejadores seguem este perfil. */
  seguidores: number;
  /** Quantos velejadores este perfil segue. */
  seguindo: number;
  relacao: RelacaoRider;
}
