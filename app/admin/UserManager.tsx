'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Search,
  Shield,
  UserCheck,
  UserX,
  KeyRound,
  Users,
  Loader2,
  Check,
  AlertTriangle,
  RefreshCw,
  Clock,
  Radio,
  Wind,
  MessageSquare,
  Flame,
  Smartphone,
  Laptop,
  Globe,
  MapPin,
  Sparkles,
} from 'lucide-react';

interface UserData {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'moderator' | 'instructor' | 'rider';
  riderId: string;
  avatarUrl: string | null;
  countryFlag: string;
  isActive: boolean;
  mustChangePassword: boolean;
  homeSpot: string | null;
  riderLevel: string;
  weightKg: number;
  createdAt: string;
  lastLoginAt: string | null;
  lastSeenAt: string;
  loginCount: number;
  lastUserAgent: string | null;
  isOnline: boolean;
  currentRoom: string | null;
  currentSpotId: string | null;
  totalSessions: number;
  totalPosts: number;
  totalMessages: number;
}

interface StatsData {
  totalUsers: number;
  activeUsers: number;
  onlineNow: number;
  activeToday: number;
  activeWeek: number;
  totalSessions: number;
  totalPosts: number;
  totalMessages: number;
}

const ROLE_BADGES: Record<UserData['role'], { label: string; class: string }> = {
  admin: { label: 'Admin', class: 'bg-rose-500/20 text-rose-300 border-rose-500/30' },
  moderator: { label: 'Moderador', class: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  instructor: { label: 'Instrutor/Escola', class: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  rider: { label: 'Velejador', class: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
};

/** Formata tempo relativo de fácil leitura */
function formatTimeAgo(isoString: string | null): string {
  if (!isoString) return 'Nunca acessou';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return 'Desconhecido';

  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 45) return 'Agora mesmo';
  if (diffMin < 60) return `Há ${diffMin} min`;
  if (diffHours < 24) return `Há ${diffHours}h`;
  if (diffDays === 1) return 'Ontem';
  if (diffDays < 7) return `Há ${diffDays} dias`;
  if (diffDays < 30) return `Há ${Math.floor(diffDays / 7)} sem`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/** Extrai informações amigáveis do User-Agent */
function parseUserAgent(ua: string | null): { device: string; icon: 'phone' | 'laptop' } {
  if (!ua) return { device: 'Dispositivo móvel', icon: 'phone' };
  const lower = ua.toLowerCase();
  if (lower.includes('iphone')) return { device: 'iPhone • iOS', icon: 'phone' };
  if (lower.includes('ipad')) return { device: 'iPad • iPadOS', icon: 'phone' };
  if (lower.includes('android')) return { device: 'Android', icon: 'phone' };
  if (lower.includes('macintosh') || lower.includes('mac os')) return { device: 'Mac • Safari/Chrome', icon: 'laptop' };
  if (lower.includes('windows')) return { device: 'Windows PC', icon: 'laptop' };
  if (lower.includes('linux')) return { device: 'Linux', icon: 'laptop' };
  return { device: 'Navegador Web', icon: 'phone' };
}

export function UserManager() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'today' | 'inactive'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (roleFilter) params.set('role', roleFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);

      const res = await fetch(`/api/admin/users?${params.toString()}`);
      if (!res.ok) {
        throw new Error('Falha ao carregar lista de velejadores.');
      }
      const data = await res.json();
      setUsers(data.users ?? []);
      setStats(data.stats ?? null);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao buscar usuários.');
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, statusFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchUsers();
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchUsers]);

  // Atualização em tempo real das presenças a cada 12s
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchUsers();
    }, 12000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchUsers]);

  async function updateUser(
    userId: string,
    patch: Partial<{ role: string; isActive: boolean; mustChangePassword: boolean }>,
    feedbackMsg: string
  ) {
    setError(null);
    setActionSuccess(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Falha ao atualizar usuário.');
        return;
      }

      setActionSuccess(feedbackMsg);
      setTimeout(() => setActionSuccess(null), 3000);
      fetchUsers();
    } catch {
      setError('Falha de conexão.');
    }
  }

  return (
    <div className="space-y-5">
      {/* 1. Cards de Métricas em Tempo Real */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Card: Total */}
          <div className="p-3.5 rounded-2xl bg-[#1E293B] border border-slate-700/80 shadow-md">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span className="font-bold">Velejadores</span>
              <Users size={16} className="text-cyan-400" />
            </div>
            <p className="text-2xl font-black text-white">{stats.totalUsers}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {stats.activeUsers} ativos • {stats.totalUsers - stats.activeUsers} suspensos
            </p>
          </div>

          {/* Card: Online Agora */}
          <div className="p-3.5 rounded-2xl bg-emerald-950/30 border border-emerald-500/40 shadow-md">
            <div className="flex items-center justify-between text-emerald-400 text-xs mb-1">
              <span className="font-bold">Online Agora</span>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
            </div>
            <p className="text-2xl font-black text-emerald-300">{stats.onlineNow}</p>
            <p className="text-[10px] text-emerald-400/80 mt-0.5">
              Conectados nos últimos 5 min
            </p>
          </div>

          {/* Card: Ativos Hoje */}
          <div className="p-3.5 rounded-2xl bg-[#1E293B] border border-slate-700/80 shadow-md">
            <div className="flex items-center justify-between gap-1 text-slate-400 text-xs mb-1">
              {/* Rótulo mais comprido dos quatro cartões; em grade de 2 colunas
                  num celular ele é o que estoura primeiro. */}
              <span className="font-bold truncate">Ativos Hoje (24h)</span>
              <Radio size={16} className="text-cyan-400 shrink-0" />
            </div>
            <p className="text-2xl font-black text-cyan-300">{stats.activeToday}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {stats.activeWeek} ativos na semana
            </p>
          </div>

          {/* Card: Engajamento Velejos */}
          <div className="p-3.5 rounded-2xl bg-[#1E293B] border border-slate-700/80 shadow-md">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span className="font-bold">Total Velejos</span>
              <Wind size={16} className="text-cyan-400" />
            </div>
            <p className="text-2xl font-black text-white">{stats.totalSessions}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {stats.totalPosts} posts • {stats.totalMessages} msgs
            </p>
          </div>
        </div>
      )}

      {/* 2. Filtros Rápidos e Busca */}
      <div className="bg-[#1E293B] p-4 rounded-2xl border border-slate-700/80 shadow-xl space-y-3">
        {/* Status Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
              statusFilter === 'all'
                ? 'bg-cyan-500 text-slate-950 font-black'
                : 'bg-[#0F172A] text-slate-400 hover:text-white border border-slate-700'
            }`}
          >
            Todos ({stats?.totalUsers ?? total})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('online')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 ${
              statusFilter === 'online'
                ? 'bg-emerald-500 text-slate-950 font-black'
                : 'bg-[#0F172A] text-emerald-400 hover:text-emerald-300 border border-emerald-500/30'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Online Agora ({stats?.onlineNow ?? 0})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('today')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
              statusFilter === 'today'
                ? 'bg-cyan-500 text-slate-950 font-black'
                : 'bg-[#0F172A] text-slate-400 hover:text-white border border-slate-700'
            }`}
          >
            ⚡ Ativos Hoje ({stats?.activeToday ?? 0})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('inactive')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
              statusFilter === 'inactive'
                ? 'bg-amber-500 text-slate-950 font-black'
                : 'bg-[#0F172A] text-slate-400 hover:text-white border border-slate-700'
            }`}
          >
            💤 Inativos (+7d)
          </button>
        </div>

        {/* Search Bar */}
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar velejador por nome, e-mail ou rider ID..."
              className="w-full pl-9 pr-3 py-2 bg-[#0F172A] border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-hidden focus:border-cyan-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="px-3 py-2 bg-[#0F172A] border border-slate-700 rounded-xl text-xs text-white focus:outline-hidden focus:border-cyan-500"
            >
              <option value="">Todas as Funções</option>
              <option value="rider">Velejador</option>
              <option value="admin">Administrador</option>
              <option value="moderator">Moderador</option>
              <option value="instructor">Instrutor</option>
            </select>

            <button
              onClick={fetchUsers}
              disabled={loading}
              className="p-2 bg-[#0F172A] border border-slate-700 hover:border-slate-600 rounded-xl text-slate-300 hover:text-white active:scale-95 transition-all disabled:opacity-50"
              title="Atualizar dados agora"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {/* Feedback Messages */}
      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-2 text-xs text-rose-300">
          <AlertTriangle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {actionSuccess && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center gap-2 text-xs text-emerald-300">
          <Check size={16} className="shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* 3. Lista Detalhada de Monitoramento dos Velejadores */}
      <div className="space-y-3">
        {loading && users.length === 0 ? (
          <div className="p-12 text-center text-slate-400 bg-[#1E293B] rounded-2xl border border-slate-700/80">
            <Loader2 size={24} className="animate-spin mx-auto text-cyan-400 mb-2" />
            <span className="text-xs font-bold">Carregando dados de monitoramento...</span>
          </div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-slate-400 bg-[#1E293B] rounded-2xl border border-slate-700/80">
            <Users size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-xs font-bold">Nenhum velejador encontrado com esses filtros.</p>
          </div>
        ) : (
          users.map((u) => {
            const uaInfo = parseUserAgent(u.lastUserAgent);
            const roleBadge = ROLE_BADGES[u.role] || ROLE_BADGES.rider;

            return (
              <div
                key={u.id}
                className={`p-4 rounded-2xl border transition-all ${
                  u.isOnline
                    ? 'bg-[#1E293B] border-emerald-500/40 shadow-lg shadow-emerald-950/20'
                    : u.isActive
                    ? 'bg-[#1E293B] border-slate-700/80'
                    : 'bg-[#161f30] border-rose-900/40 opacity-75'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  {/* Informações Principais do Usuário */}
                  <div className="flex items-start gap-3.5 min-w-0">
                    {/* Avatar com Anel de Status */}
                    <div className="relative shrink-0">
                      <div className="w-12 h-12 rounded-full overflow-hidden bg-slate-800 ring-2 ring-slate-700 flex items-center justify-center">
                        {u.avatarUrl ? (
                          <img src={u.avatarUrl} alt={u.name} className="w-full h-full object-cover" />
                        ) : (
                          <Users size={20} className="text-slate-400" />
                        )}
                      </div>
                      {u.isOnline ? (
                        <span
                          className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-400 rounded-full ring-2 ring-[#1E293B]"
                          title="Online agora"
                        />
                      ) : (
                        <span
                          className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-slate-600 rounded-full ring-2 ring-[#1E293B]"
                          title="Offline"
                        />
                      )}
                    </div>

                    {/* Dados e Badges */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <strong className="text-sm font-black text-white break-words">{u.name}</strong>
                        <span>{u.countryFlag}</span>
                        <span
                          className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${roleBadge.class}`}
                        >
                          {roleBadge.label}
                        </span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                          {u.riderLevel}
                        </span>
                        {!u.isActive && (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                            Suspenso
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-slate-400 mt-1 flex-wrap font-mono min-w-0">
                        {/* `break-all`: e-mail é uma palavra só, sem espaço para
                            quebrar. `flex-wrap` quebra ENTRE itens, nunca dentro
                            de um — sem isto, um endereço comprido empurra o
                            cartão para fora da tela. */}
                        <span className="break-all">{u.email}</span>
                        <span>&bull;</span>
                        <span className="text-cyan-400 font-bold">#{u.riderId}</span>
                        {u.homeSpot && (
                          <>
                            <span>&bull;</span>
                            <span className="text-slate-300 flex items-center gap-1 font-sans">
                              <MapPin size={11} className="text-rose-400" /> {u.homeSpot}
                            </span>
                          </>
                        )}
                      </div>

                      {/* Métricas de Acesso e Dispositivo */}
                      <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-2 flex-wrap pt-1 border-t border-slate-800/80">
                        {/* Status de Acesso */}
                        <span className="flex items-center gap-1 font-medium">
                          <Clock size={12} className="text-cyan-400 shrink-0" />
                          {u.isOnline ? (
                            <strong className="text-emerald-400 font-bold">Online agora</strong>
                          ) : (
                            <span>Último acesso: <strong className="text-slate-200">{formatTimeAgo(u.lastSeenAt)}</strong></span>
                          )}
                        </span>

                        <span>&bull;</span>

                        {/* Dispositivo */}
                        <span className="flex items-center gap-1">
                          {uaInfo.icon === 'phone' ? (
                            <Smartphone size={12} className="text-slate-400 shrink-0" />
                          ) : (
                            <Laptop size={12} className="text-slate-400 shrink-0" />
                          )}
                          <span>{uaInfo.device}</span>
                        </span>

                        <span>&bull;</span>

                        {/* Engajamento */}
                        <span className="flex items-center gap-2 text-slate-300">
                          <span title="Sessões de velejo" className="flex items-center gap-0.5">
                            🪁 <strong className="text-white">{u.totalSessions}</strong>
                          </span>
                          <span title="Posts no feed" className="flex items-center gap-0.5">
                            📸 <strong className="text-white">{u.totalPosts}</strong>
                          </span>
                          <span title="Mensagens no chat" className="flex items-center gap-0.5">
                            💬 <strong className="text-white">{u.totalMessages}</strong>
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Ações Administrativas */}
                  <div className="flex items-center gap-2 shrink-0 md:self-center pt-2 md:pt-0 border-t md:border-t-0 border-slate-800">
                    {/* Role selector */}
                    <select
                      value={u.role}
                      onChange={(e) =>
                        updateUser(
                          u.id,
                          { role: e.target.value },
                          `Papel de ${u.name} alterado para ${e.target.value}.`
                        )
                      }
                      className="px-2.5 py-1.5 bg-[#0F172A] border border-slate-700 rounded-xl text-xs text-white font-bold focus:outline-hidden focus:border-cyan-500"
                    >
                      <option value="rider">Velejador</option>
                      <option value="moderator">Moderador</option>
                      <option value="instructor">Instrutor</option>
                      <option value="admin">Admin</option>
                    </select>

                    {/* Toggle Active/Inactive */}
                    <button
                      onClick={() =>
                        updateUser(
                          u.id,
                          { isActive: !u.isActive },
                          u.isActive
                            ? `Conta de ${u.name} foi suspensa.`
                            : `Conta de ${u.name} foi reativada.`
                        )
                      }
                      className={`p-2 rounded-xl text-xs font-bold border transition-all active:scale-95 ${
                        u.isActive
                          ? 'bg-rose-500/15 border-rose-500/30 text-rose-300 hover:bg-rose-500/25'
                          : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25'
                      }`}
                      title={u.isActive ? 'Suspender velejador' : 'Reativar velejador'}
                    >
                      {u.isActive ? <UserX size={15} /> : <UserCheck size={15} />}
                    </button>

                    {/* Force password change */}
                    <button
                      onClick={() =>
                        updateUser(
                          u.id,
                          { mustChangePassword: true },
                          `Foi exigida a troca de senha para ${u.name} no próximo login.`
                        )
                      }
                      className="p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs text-slate-300 hover:text-white transition-all active:scale-95"
                      title="Exigir troca de senha no próximo login"
                    >
                      <KeyRound size={15} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
