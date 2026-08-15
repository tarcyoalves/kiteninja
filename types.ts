export type WindUnit = 'nós' | 'km/h' | 'mph';
export type TideStatus = 'subindo' | 'descendo' | 'estável';
export type WindSafety = 'Side-Onshore' | 'Side-Shore' | 'Onshore' | 'Side-Offshore' | 'Offshore';
export type RiderLevel = 'Iniciante' | 'Intermediário' | 'Avançado' | 'Profissional';
export type Discipline = 'Kitesurf Twintip' | 'Kitesurf Strapless Wave' | 'Hydrofoil' | 'Wingfoil' | 'Big Air';

export interface WindForecastHour {
  hour: string; // e.g. "00h", "03h", "06h", "09h", "12h", "15h", "18h", "21h"
  knots: number;
  gustKnots: number;
  directionDeg: number; // 0-360
  directionText: string; // e.g. "ENE", "E", "SE"
  conditionIcon: 'sun' | 'moon' | 'cloud-sun' | 'cloud-moon' | 'cloud' | 'rain';
  temperature: number; // in °C
  pressureHpa: number;
  waveHeightM: number;
  wavePeriodS: number;
  waveDirDeg: number;
  tideTrend: 'up' | 'down' | 'peak_high' | 'peak_low';
  tideHeightM: number;
  tidePeakTime?: string;
  tidePeakHeight?: string;
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
  maxKnots: number;
  windDirectionDeg: number;
  windDirectionText: string;
  windSafety: WindSafety;
  temperature: number;
  weatherDescription: string;
  weatherIcon: 'sun' | 'moon' | 'cloud-sun' | 'cloud-moon' | 'cloud' | 'rain';
  isLiveObservation: boolean;
  lastUpdated: string;
  nextUpdate: string;
  currentTideHeightM: number;
  currentTideTrend: TideStatus;
  nextTideInfo: string;
  waveHeightM: number;
  wavePeriodS: number;
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
