export type WindUnit = 'nós' | 'km/h' | 'mph';
export type TideStatus = 'subindo' | 'descendo' | 'estável';
export type WindSafety = 'Side-Onshore' | 'Side-Shore' | 'Onshore' | 'Side-Offshore' | 'Offshore';
export type RiderLevel = 'Iniciante' | 'Intermediário' | 'Avançado' | 'Profissional';
export type Discipline = 'Kitesurf Twintip' | 'Kitesurf Strapless Wave' | 'Hydrofoil' | 'Wingfoil' | 'Big Air';

export interface MultiModelForecast {
  consensusKnots: number;
  spreadKnots: number;
  confidencePercent: number; // 0 a 100%
  confidenceLevel: 'Alta' | 'Média' | 'Baixa';
  confidenceText: string;
  models: {
    gfsKnots: number;
    ecmwfKnots: number;
    iconKnots: number;
  };
}

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
  /** Comparativo multimodelo em tempo real */
  multiModel?: MultiModelForecast;
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
  riderLevel: RiderLevel;
  homeSpot: string;
  disciplines: Discipline[];
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
  maxGustKnots: number;
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
