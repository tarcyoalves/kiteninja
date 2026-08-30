'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useKiteData } from '../context/KiteDataContext';
import {
  UserCog,
  Weight,
  Ruler,
  Compass,
  MapPin,
  Wind,
  Plus,
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import { Discipline, RiderLevel } from '../types';

const LEVELS: RiderLevel[] = ['Iniciante', 'Intermediário', 'Avançado', 'Profissional'];
const DISCIPLINES: Discipline[] = [
  'Kitesurf Twintip',
  'Kitesurf Strapless Wave',
  'Hydrofoil',
  'Wingfoil',
  'Big Air',
];
// Valores em inglês: precisam bater com o CHECK de preferred_wind_unit em
// lib/schema.sql, não com o rótulo em português mostrado na tela.
const WIND_UNITS: { value: string; label: string }[] = [
  { value: 'knots', label: 'Nós' },
  { value: 'kmh', label: 'km/h' },
  { value: 'mph', label: 'mph' },
  { value: 'ms', label: 'm/s' },
];

const MAX_QUIVER_ITEMS = 10;

export const PerfilView: React.FC = () => {
  const { user, updateProfile } = useAuth();
  const { beachMode } = useKiteData();

  const [weightKg, setWeightKg] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [riderLevel, setRiderLevel] = useState<RiderLevel>('Intermediário');
  const [homeSpot, setHomeSpot] = useState('');
  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [quiverKites, setQuiverKites] = useState<number[]>([]);
  const [newKiteSize, setNewKiteSize] = useState('');
  const [quiverBoards, setQuiverBoards] = useState<string[]>([]);
  const [newBoard, setNewBoard] = useState('');
  const [preferredWindUnit, setPreferredWindUnit] = useState('knots');
  // Padrão ligado, igual ao DEFAULT da coluna — ver lib/schema.sql.
  const [notificarAmigoVelejando, setNotificarAmigoVelejando] = useState(true);
  const [bio, setBio] = useState('');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preenche o formulário quando o velejador entra na aba. Depende só do id
  // (não do objeto `user` inteiro) para não apagar edições em andamento se
  // outra parte do app (ex: troca de avatar) atualizar o contexto no meio da
  // edição.
  useEffect(() => {
    if (!user) return;
    setWeightKg(String(user.weightKg ?? ''));
    setHeightCm(user.heightCm ? String(user.heightCm) : '');
    setRiderLevel(user.riderLevel ?? 'Intermediário');
    setHomeSpot(user.homeSpot ?? '');
    setDisciplines(user.disciplines ?? []);
    setQuiverKites(user.quiverKites ?? []);
    setQuiverBoards(user.quiverBoards ?? []);
    setPreferredWindUnit(user.preferredWindUnit ?? 'knots');
    setNotificarAmigoVelejando(user.notificarAmigoVelejando !== false);
    setBio(user.bio ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const toggleDiscipline = (d: Discipline) => {
    setDisciplines((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  };

  const addKite = () => {
    const val = Number(newKiteSize.replace(',', '.'));
    if (!Number.isFinite(val) || val < 3 || val > 21) {
      setError('Tamanho da pipa deve estar entre 3 e 21 m².');
      return;
    }
    if (quiverKites.length >= MAX_QUIVER_ITEMS) {
      setError(`Máximo de ${MAX_QUIVER_ITEMS} pipas no quiver.`);
      return;
    }
    setError(null);
    setQuiverKites((prev) => [...prev, val].sort((a, b) => a - b));
    setNewKiteSize('');
  };

  const removeKite = (idx: number) => {
    setQuiverKites((prev) => prev.filter((_, i) => i !== idx));
  };

  const addBoard = () => {
    const val = newBoard.trim();
    if (!val) return;
    if (quiverBoards.length >= MAX_QUIVER_ITEMS) {
      setError(`Máximo de ${MAX_QUIVER_ITEMS} pranchas no quiver.`);
      return;
    }
    setError(null);
    setQuiverBoards((prev) => [...prev, val.slice(0, 60)]);
    setNewBoard('');
  };

  const removeBoard = (idx: number) => {
    setQuiverBoards((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    setError(null);
    setSaved(false);

    const weight = Number(weightKg.replace(',', '.'));
    if (!Number.isFinite(weight) || weight < 30 || weight > 200) {
      setError('Peso deve estar entre 30 e 200 kg.');
      return;
    }

    let height: number | undefined;
    if (heightCm.trim() !== '') {
      height = Number(heightCm.replace(',', '.'));
      if (!Number.isFinite(height) || height < 100 || height > 230) {
        setError('Altura deve estar entre 100 e 230 cm.');
        return;
      }
    }

    setSaving(true);
    const res = await updateProfile({
      weightKg: weight,
      ...(height !== undefined ? { heightCm: height } : {}),
      riderLevel,
      homeSpot: homeSpot.trim(),
      disciplines,
      quiverKites,
      quiverBoards,
      preferredWindUnit,
      notificarAmigoVelejando,
      bio: bio.trim(),
    });
    setSaving(false);

    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } else {
      setError(res.error ?? 'Não foi possível salvar o perfil.');
    }
  };

  const cardClass = `p-4 rounded-2xl border shadow-xl transition-colors space-y-3 ${
    beachMode ? 'bg-[#020617] border-slate-800 text-white' : 'bg-[#1E293B] border-slate-700/80 text-slate-100'
  }`;

  const inputClass =
    'w-full px-3.5 py-2 rounded-xl bg-[#0F172A] border border-slate-700 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-cyan-500';

  const labelClass = 'text-xs font-bold text-slate-300 block mb-1.5';

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-full p-8 text-center text-slate-400">
        <UserCog size={32} className="mb-2 text-slate-500" />
        <p className="text-sm font-bold">Entre na sua conta para editar o perfil.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full pb-24 p-3 space-y-4 max-w-lg mx-auto w-full">
      {/* Cabeçalho */}
      <div className={cardClass}>
        <div className="flex items-center gap-2">
          <UserCog size={20} className="text-cyan-400" />
          <div>
            <h2 className="font-black text-base text-white">Dados do Velejador</h2>
            <p className="text-xs text-slate-400">
              Peso, altura e equipamento ajustam o cálculo da pipa ideal e as recomendações do app.
            </p>
          </div>
        </div>
      </div>

      {/* Alertas */}
      {error && (
        <div className="flex items-center gap-2 p-3.5 bg-red-950/40 border border-red-500/40 rounded-xl text-red-300 text-xs font-medium">
          <AlertTriangle size={16} className="text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {saved && (
        <div className="flex items-center gap-2 p-3.5 bg-emerald-950/40 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs font-medium">
          <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
          <span>Perfil salvo com sucesso!</span>
        </div>
      )}

      {/* Peso & Altura */}
      <div className={cardClass}>
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Weight size={16} className="text-amber-400" />
          <span>Peso & Altura</span>
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Peso (kg)</label>
            <input
              type="number"
              inputMode="decimal"
              min={30}
              max={200}
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              className={inputClass}
              placeholder="75"
            />
          </div>
          <div>
            <label className={labelClass}>
              <Ruler size={11} className="inline mr-1 -mt-0.5" />
              Altura (cm)
            </label>
            <input
              type="number"
              inputMode="decimal"
              min={100}
              max={230}
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
              className={inputClass}
              placeholder="178"
            />
          </div>
        </div>
      </div>

      {/* Nível & Home Spot */}
      <div className={cardClass}>
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Compass size={16} className="text-cyan-400" />
          <span>Nível & Spot Base</span>
        </h3>
        <div>
          <label className={labelClass}>Nível de Rider</label>
          <div className="flex flex-wrap gap-1.5">
            {LEVELS.map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setRiderLevel(lvl)}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
                  riderLevel === lvl
                    ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/25'
                    : 'bg-[#0F172A] text-slate-300 border border-slate-700/70 hover:bg-slate-800'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelClass}>
            <MapPin size={11} className="inline mr-1 -mt-0.5" />
            Spot Base
          </label>
          <input
            type="text"
            value={homeSpot}
            onChange={(e) => setHomeSpot(e.target.value)}
            className={inputClass}
            placeholder="Ex: Ponta do Mel / RN"
            maxLength={120}
          />
        </div>
      </div>

      {/* Disciplinas */}
      <div className={cardClass}>
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Sparkles size={16} className="text-emerald-400" />
          <span>Disciplinas</span>
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {DISCIPLINES.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => toggleDiscipline(d)}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
                disciplines.includes(d)
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/25'
                  : 'bg-[#0F172A] text-slate-300 border border-slate-700/70 hover:bg-slate-800'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Quiver de Pipas */}
      <div className={cardClass}>
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Wind size={16} className="text-cyan-400" />
          <span>Quiver de Pipas (m²)</span>
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {quiverKites.length === 0 && (
            <p className="text-xs text-slate-500 italic">Nenhuma pipa cadastrada ainda.</p>
          )}
          {quiverKites.map((k, idx) => (
            <span
              key={`${k}-${idx}`}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0F172A] border border-cyan-500/30 text-cyan-300 text-xs font-bold"
            >
              {k}m²
              <button
                type="button"
                onClick={() => removeKite(idx)}
                aria-label={`Remover pipa de ${k}m²`}
                className="text-slate-500 hover:text-rose-400"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="decimal"
            min={3}
            max={21}
            step={0.5}
            value={newKiteSize}
            onChange={(e) => setNewKiteSize(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addKite();
              }
            }}
            className={inputClass}
            placeholder="Ex: 9"
          />
          <button
            type="button"
            onClick={addKite}
            className="px-3.5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black flex items-center gap-1 shrink-0"
          >
            <Plus size={15} className="stroke-[3]" />
          </button>
        </div>
      </div>

      {/* Quiver de Pranchas */}
      <div className={cardClass}>
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Compass size={16} className="text-blue-400" />
          <span>Quiver de Pranchas</span>
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {quiverBoards.length === 0 && (
            <p className="text-xs text-slate-500 italic">Nenhuma prancha cadastrada ainda.</p>
          )}
          {quiverBoards.map((b, idx) => (
            <span
              key={`${b}-${idx}`}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0F172A] border border-blue-500/30 text-blue-300 text-xs font-bold"
            >
              {b}
              <button
                type="button"
                onClick={() => removeBoard(idx)}
                aria-label={`Remover prancha ${b}`}
                className="text-slate-500 hover:text-rose-400"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newBoard}
            onChange={(e) => setNewBoard(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addBoard();
              }
            }}
            className={inputClass}
            placeholder="Ex: North Whip 135cm"
            maxLength={60}
          />
          <button
            type="button"
            onClick={addBoard}
            className="px-3.5 py-2 rounded-xl bg-blue-500 hover:bg-blue-400 text-slate-950 font-black flex items-center gap-1 shrink-0"
          >
            <Plus size={15} className="stroke-[3]" />
          </button>
        </div>
      </div>

      {/* Unidade de vento & Bio */}
      <div className={cardClass}>
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Wind size={16} className="text-slate-300" />
          <span>Preferências</span>
        </h3>
        <div>
          <label className={labelClass}>Unidade de Vento Preferida</label>
          <div className="flex flex-wrap gap-1.5">
            {WIND_UNITS.map((u) => (
              <button
                key={u.value}
                type="button"
                onClick={() => setPreferredWindUnit(u.value)}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
                  preferredWindUnit === u.value
                    ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/25'
                    : 'bg-[#0F172A] text-slate-300 border border-slate-700/70 hover:bg-slate-800'
                }`}
              >
                {u.label}
              </button>
            ))}
          </div>
        </div>

        {/*
          Interruptor do aviso de amigo velejando. Fica aqui, junto das outras
          preferências, e não escondido atrás de um submenu de notificações:
          é a única preferência de push que existe hoje, e uma tela inteira
          para um item só seria mais difícil de achar do que uma linha aqui.
        */}
        <div className="flex items-start justify-between gap-3 py-2">
          <div className="min-w-0">
            <label htmlFor="notificar-amigo" className={labelClass}>
              Avisar quando amigos entrarem na água
            </label>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Você recebe um aviso quando alguém que você segue começa um velejo
              ou um downwind.
            </p>
          </div>
          <button
            id="notificar-amigo"
            type="button"
            role="switch"
            aria-checked={notificarAmigoVelejando}
            onClick={() => setNotificarAmigoVelejando((v) => !v)}
            className={`relative shrink-0 w-12 h-7 rounded-full transition-colors ${
              notificarAmigoVelejando ? 'bg-cyan-500' : 'bg-slate-700'
            }`}
          >
            <span
              className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-transform ${
                notificarAmigoVelejando ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div>
          <label className={labelClass}>Bio</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            className={`${inputClass} resize-none`}
            rows={3}
            maxLength={500}
            placeholder="Conte um pouco sobre você como velejador..."
          />
        </div>
      </div>

      {/* Salvar */}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="w-full py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 disabled:opacity-50 active:scale-95 transition-all"
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
        <span>{saving ? 'Salvando...' : 'Salvar Perfil'}</span>
      </button>
    </div>
  );
};
