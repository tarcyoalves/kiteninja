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
} from 'lucide-react';

interface UserData {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'moderator' | 'instructor' | 'rider';
  riderId: string;
  avatarUrl: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  homeSpot: string | null;
  riderLevel: string;
  weightKg: number;
  createdAt: string;
}

const ROLE_BADGES: Record<UserData['role'], { label: string; class: string }> = {
  admin: { label: 'Admin', class: 'bg-rose-500/20 text-rose-300 border-rose-500/30' },
  moderator: { label: 'Moderador', class: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  instructor: { label: 'Instrutor/Escola', class: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  rider: { label: 'Velejador', class: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
};

export function UserManager() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (roleFilter) params.set('role', roleFilter);

      const res = await fetch(`/api/admin/users?${params.toString()}`);
      if (!res.ok) {
        throw new Error('Falha ao carregar lista de velejadores.');
      }
      const data = await res.json();
      setUsers(data.users ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao buscar usuários.');
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchUsers();
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchUsers]);

  async function updateUser(userId: string, patch: Partial<{ role: string; isActive: boolean; mustChangePassword: boolean }>, feedbackMsg: string) {
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
    <div className="space-y-4">
      {/* Search and Filters */}
      <div className="bg-[#1E293B] p-4 rounded-2xl border border-slate-700/80 shadow-xl space-y-3">
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, e-mail ou rider ID..."
              className="w-full pl-9 pr-3 py-2 bg-[#0F172A] border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-hidden focus:border-cyan-500"
            />
          </div>

          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-3 py-2 bg-[#0F172A] border border-slate-700 rounded-xl text-xs text-white focus:outline-hidden focus:border-cyan-500"
          >
            <option value="">Todos os Papéis</option>
            <option value="rider">Velejadores</option>
            <option value="instructor">Instrutores / Escolas</option>
            <option value="moderator">Moderadores</option>
            <option value="admin">Administradores</option>
          </select>

          <button
            onClick={fetchUsers}
            disabled={loading}
            className="px-3 py-2 bg-[#0F172A] hover:bg-slate-800 border border-slate-700 rounded-xl text-xs font-bold text-slate-300 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Atualizar</span>
          </button>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Total: <strong className="text-cyan-400 font-bold">{total}</strong> velejador(es)</span>
        </div>
      </div>

      {/* Status Messages */}
      {actionSuccess && (
        <div className="p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-xl text-xs font-bold text-emerald-300 flex items-center gap-2">
          <Check size={16} className="text-emerald-400" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl text-xs font-bold text-rose-300 flex items-center gap-2">
          <AlertTriangle size={16} className="text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Users List */}
      <div className="space-y-2">
        {loading && users.length === 0 ? (
          <div className="flex items-center justify-center p-8 bg-[#1E293B] rounded-2xl border border-slate-800 text-slate-400">
            <Loader2 size={24} className="animate-spin text-cyan-400 mr-2" />
            <span className="text-xs font-bold">Carregando velejadores...</span>
          </div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center bg-[#1E293B] rounded-2xl border border-slate-800 text-slate-400 text-xs font-bold">
            Nenhum velejador encontrado com os filtros selecionados.
          </div>
        ) : (
          users.map((u) => {
            const badge = ROLE_BADGES[u.role] || ROLE_BADGES.rider;
            return (
              <div
                key={u.id}
                className={`p-3.5 bg-[#1E293B] rounded-2xl border transition-all ${
                  u.isActive ? 'border-slate-700/80 shadow-md' : 'border-rose-500/30 opacity-70 bg-slate-900/60'
                }`}
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  {/* Left: User Info */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-full bg-slate-800 border border-slate-700 overflow-hidden flex items-center justify-center shrink-0">
                      {u.avatarUrl ? (
                        <img src={u.avatarUrl} alt={u.name} className="w-full h-full object-cover" />
                      ) : (
                        <Users size={20} className="text-slate-400" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-black text-sm text-white truncate">{u.name}</h4>
                        <span className="text-[10px] font-mono font-bold text-cyan-400 bg-cyan-950/60 border border-cyan-800/60 px-1.5 py-0.5 rounded-md">
                          #{u.riderId}
                        </span>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${badge.class}`}>
                          {badge.label}
                        </span>
                        {!u.isActive && (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40">
                            SUSPENSO
                          </span>
                        )}
                        {u.mustChangePassword && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/40">
                            Troca de Senha Pendente
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-400 truncate mt-0.5">
                        {u.email} &bull; {u.homeSpot || 'Litoral'} &bull; {u.riderLevel}
                      </p>
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-1.5 self-end sm:self-auto flex-wrap">
                    {/* Alterar Papel */}
                    <select
                      value={u.role}
                      onChange={(e) =>
                        updateUser(u.id, { role: e.target.value }, `Papel de ${u.name} alterado para ${e.target.value}.`)
                      }
                      className="px-2.5 py-1.5 bg-[#0F172A] border border-slate-700 rounded-lg text-xs font-bold text-slate-200 focus:outline-hidden"
                    >
                      <option value="rider">Velejador</option>
                      <option value="instructor">Instrutor</option>
                      <option value="moderator">Moderador</option>
                      <option value="admin">Admin</option>
                    </select>

                    {/* Forçar Troca de Senha */}
                    <button
                      onClick={() =>
                        updateUser(
                          u.id,
                          { mustChangePassword: !u.mustChangePassword },
                          u.mustChangePassword ? 'Exigência de troca de senha removida.' : 'Troca de senha exigida no próximo login.'
                        )
                      }
                      title="Forçar troca de senha no próximo login"
                      className="p-2 rounded-lg bg-[#0F172A] hover:bg-slate-900 border border-slate-700 text-slate-300 hover:text-amber-400 transition-colors"
                    >
                      <KeyRound size={14} />
                    </button>

                    {/* Suspender / Reativar */}
                    <button
                      onClick={() =>
                        updateUser(
                          u.id,
                          { isActive: !u.isActive },
                          u.isActive ? `Conta de ${u.name} suspensa.` : `Conta de ${u.name} reativada.`
                        )
                      }
                      title={u.isActive ? 'Suspender conta' : 'Reativar conta'}
                      className={`p-2 rounded-lg border transition-colors ${
                        u.isActive
                          ? 'bg-[#0F172A] hover:bg-rose-950/40 border-slate-700 text-slate-300 hover:text-rose-400'
                          : 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/60'
                      }`}
                    >
                      {u.isActive ? <UserX size={14} /> : <UserCheck size={14} />}
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
