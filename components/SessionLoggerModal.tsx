'use client';

import React, { useEffect, useState } from 'react';
import { X, Calendar, Clock, Wind, Star, Compass, Camera, Sparkles, Gauge, ImagePlus, Loader2, Satellite } from 'lucide-react';
import { useKiteData } from '../context/KiteDataContext';
import { useAuth } from '../context/AuthContext';
import { Discipline } from '../types';
import { compressImage } from '../lib/imageCompress';

const MAX_PHOTO_BYTES = 12 * 1024 * 1024; // 12MB — limite antes de processar, para não travar o navegador com arquivos gigantes
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

export const SessionLoggerModal: React.FC = () => {
  const {
    isLoggerOpen,
    setIsLoggerOpen,
    spots,
    addSession,
    loggerPrefill,
    limparLoggerPrefill,
  } = useKiteData();
  const { user } = useAuth();

  const [selectedSpotId, setSelectedSpotId] = useState(spots[0]?.id || 'ponta-do-mel');
  const [customSpotName, setCustomSpotName] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState('15:30');
  const [durationMinutes, setDurationMinutes] = useState(90);
  const [discipline, setDiscipline] = useState<Discipline>('Kitesurf Twintip');
  const [kiteSizeM2, setKiteSizeM2] = useState(9);
  const [boardModel, setBoardModel] = useState('');
  const [avgWindKnots, setAvgWindKnots] = useState(20);
  const [maxGustKnots, setMaxGustKnots] = useState<number | ''>(26);
  const [windDirection, setWindDirection] = useState('ENE');
  const [tideCondition, setTideCondition] = useState<'Seca' | 'Enchendo' | 'Cheia' | 'Vazando'>('Enchendo');
  const [waterCondition, setWaterCondition] = useState('Chop Médio');
  const [rating, setRating] = useState(5);
  const [distanceKm, setDistanceKm] = useState<number | ''>(28.4);
  const [maxSpeedKnots, setMaxSpeedKnots] = useState<number | ''>(26.8);
  const [highestJumpM, setHighestJumpM] = useState<number | ''>(9.2);
  const [notes, setNotes] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [isCompressingPhoto, setIsCompressingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  // Distância/velocidade máxima vieram de uma sessão real do Modo Navegação
  // (mapa normal), não de digitação manual — controla só o banner informativo
  // abaixo, nunca a validação nem o envio.
  const [prefilledFromGps, setPrefilledFromGps] = useState(false);
  // Trilha reduzida do prefill de GPS (ver lib/trilhaSessao.ts,
  // PrefillLogbook.trilhaReduzida). Só guardada em estado para reenviar no
  // submit — NUNCA vira um campo do formulário: é dado medido pelo GPS, não
  // digitado pelo velejador, e não haveria como editar uma trilha num input
  // de texto de qualquer forma.
  const [trilhaReduzida, setTrilhaReduzida] = useState<Array<[number, number, number]>>([]);

  /**
   * Aplica o rascunho de `lib/trilhaSessao.ts` (via context) quando o modal
   * abre vindo de uma sessão de GPS real (`views/MapView.tsx`, ao sair do
   * Modo Navegação). `highestJumpM` é zerado de propósito: `useTrilhaSessao`
   * não mede altura de salto (exigiria acelerômetro, não GPS), então deixar o
   * valor de exemplo (9.2) ali pareceria um dado real ao lado dos números que
   * de fato vieram do GPS — ver docs sobre nunca fingir saber o que não se
   * sabe. `limparLoggerPrefill()` evita que uma abertura manual seguinte
   * (botão "+ Velejo" do Header) herde o resumo desta sessão antiga.
   */
  // O prefill é um evento externo (rastreamento GPS concluído), não estado
  // derivável durante o render; por isso a sincronização ocorre neste effect.
  useEffect(() => {
    if (!isLoggerOpen || !loggerPrefill) return;
    // Sincroniza o rascunho entregue pelo rastreador GPS.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDistanceKm(loggerPrefill.distanceKm);
    setMaxSpeedKnots(loggerPrefill.maxSpeedKnots);
    setHighestJumpM('');
    setDurationMinutes(loggerPrefill.durationMinutes);
    setDate(loggerPrefill.date);
    setStartTime(loggerPrefill.startTime);
    if (loggerPrefill.spotId) setSelectedSpotId(loggerPrefill.spotId);
    if (loggerPrefill.customSpotName) setCustomSpotName(loggerPrefill.customSpotName);
    if (loggerPrefill.notes) setNotes(loggerPrefill.notes);
    setPrefilledFromGps(true);
    setTrilhaReduzida(loggerPrefill.trilhaReduzida);
    limparLoggerPrefill();
  }, [isLoggerOpen, loggerPrefill, limparLoggerPrefill]);

  // Some o banner de "veio do GPS" ao fechar, para uma abertura manual
  // seguinte (sem prefill nenhum) não carregar o aviso de uma sessão antiga.
  // Zera a trilha guardada pelo mesmo motivo: sem isto, uma abertura manual
  // seguinte (botão "+ Velejo") reenviaria a trilha de uma sessão antiga
  // junto de dados digitados à mão, que não tem relação nenhuma com ela.
  useEffect(() => {
    if (!isLoggerOpen) {
      // Limpa dados medidos que não podem vazar para a próxima abertura manual.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPrefilledFromGps(false);
      setTrilhaReduzida([]);
    }
  }, [isLoggerOpen]);

  if (!isLoggerOpen) return null;

  const targetSpot = spots.find(s => s.id === selectedSpotId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving || isCompressingPhoto) return;
    const finalSpotName = selectedSpotId === 'outro' ? (customSpotName || 'Spot Customizado') : (targetSpot?.name || 'Spot');
    const finalSpotLocation = selectedSpotId === 'outro' ? 'Brasil' : (targetSpot?.location || 'Litoral');

    setIsSaving(true);
    setSaveError('');
    const result = await addSession({
      userId: user?.id || 'user_guest',
      userName: user?.name || 'Velejador Rider',
      userAvatar: user?.avatarUrl,
      spotId: selectedSpotId,
      spotName: finalSpotName,
      spotLocation: finalSpotLocation,
      // A API grava em coluna DATE e exige ISO `YYYY-MM-DD`. A versão anterior
      // convertia para `dd/mm/aaaa` antes do POST; esse texto depende do
      // DateStyle do Postgres e normalmente falha com 500.
      date,
      startTime,
      durationMinutes: Number(durationMinutes),
      discipline,
      kiteSizeM2: Number(kiteSizeM2),
      boardModel: boardModel || undefined,
      avgWindKnots: Number(avgWindKnots),
      maxGustKnots: maxGustKnots === '' ? undefined : Number(maxGustKnots),
      windDirection,
      tideCondition,
      waterCondition,
      rating,
      distanceKm: distanceKm === '' ? undefined : Number(distanceKm),
      maxSpeedKnots: maxSpeedKnots === '' ? undefined : Number(maxSpeedKnots),
      highestJumpM: highestJumpM === '' ? undefined : Number(highestJumpM),
      notes: notes || undefined,
      photoUrl: photoUrl || undefined,
      isPublic,
      trilhaReduzida: trilhaReduzida.length > 0 ? trilhaReduzida : undefined,
    });

    setIsSaving(false);
    if (!result.ok) {
      setSaveError(result.error || 'Não foi possível salvar o velejo. Confira a conexão e tente novamente.');
      return;
    }

    // Limpa somente após confirmação do servidor. Em falha, o formulário
    // permanece intacto para o velejador corrigir ou tentar novamente.
    setSelectedSpotId(spots[0]?.id || 'ponta-do-mel');
    setCustomSpotName('');
    setDate(new Date().toISOString().split('T')[0]);
    setStartTime('15:30');
    setDurationMinutes(90);
    setDiscipline('Kitesurf Twintip');
    setKiteSizeM2(9);
    setBoardModel('');
    setAvgWindKnots(20);
    setMaxGustKnots(26);
    setWindDirection('ENE');
    setTideCondition('Enchendo');
    setWaterCondition('Chop Médio');
    setRating(5);
    setDistanceKm(28.4);
    setMaxSpeedKnots(26.8);
    setHighestJumpM(9.2);
    setNotes('');
    setPhotoUrl('');
    setPhotoError('');
    setSaveError('');
    setIsPublic(true);
    setPrefilledFromGps(false);
    setTrilhaReduzida([]);
    setIsLoggerOpen(false);
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite selecionar o mesmo arquivo de novo depois de remover
    if (!file) return;

    setPhotoError('');

    if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
      setPhotoError('Formato inválido. Envie uma foto em JPEG, PNG, WEBP ou HEIC.');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError('Foto muito grande (máx. 12MB). Escolha outra ou tire uma nova foto.');
      return;
    }

    setIsCompressingPhoto(true);
    try {
      const dataUrl = await compressImage(file, 1280, 0.75);
      setPhotoUrl(dataUrl);
    } catch {
      setPhotoError('Não foi possível processar essa foto. Tente outra.');
    } finally {
      setIsCompressingPhoto(false);
    }
  };

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-3 bg-black/75 backdrop-blur-xs overflow-y-auto">
      <div className="bg-[#0F172A] text-slate-100 rounded-3xl w-full max-w-lg overflow-hidden border border-slate-800 shadow-2xl my-6">
        {/* Header */}
        <div className="bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-4 flex items-center justify-between shadow-md">
          <div className="flex items-center gap-2.5">
            <Compass size={22} className="text-slate-950" />
            <h2 className="font-black text-base sm:text-lg text-slate-950">Registrar Velejo no Logbook</h2>
          </div>
          <button
            type="button"
            onClick={() => {
              if (isSaving || isCompressingPhoto) return;
              setSaveError('');
              setIsLoggerOpen(false);
            }}
            disabled={isSaving || isCompressingPhoto}
            className="p-1.5 rounded-full bg-black/20 hover:bg-black/40 text-white transition-colors disabled:opacity-50"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4 max-h-[80vh] overflow-y-auto text-xs">
          {/* Spot Selection */}
          <div>
            <label className="block font-bold text-slate-300 mb-1">Spot do Velejo</label>
            <select
              value={selectedSpotId}
              onChange={e => setSelectedSpotId(e.target.value)}
              className="w-full p-2.5 rounded-xl bg-[#1E293B] border border-slate-700 text-white font-medium focus:ring-2 focus:ring-cyan-400 focus:outline-hidden"
            >
              {spots.map(sp => (
                <option key={sp.id} value={sp.id}>
                  {sp.name} - {sp.location}
                </option>
              ))}
              <option value="outro">+ Outro Spot Personalizado</option>
            </select>
          </div>

          {selectedSpotId === 'outro' && (
            <div>
              <label className="block font-bold text-slate-300 mb-1">Nome do Spot</label>
              <input
                type="text"
                value={customSpotName}
                onChange={e => setCustomSpotName(e.target.value)}
                placeholder="Ex: Praia de Pipa / RN"
                className="w-full p-2.5 rounded-xl bg-[#1E293B] border border-slate-700 text-white font-semibold focus:outline-hidden focus:border-cyan-400"
                required
              />
            </div>
          )}

          {/* Date, Time & Duration */}
          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="block font-bold text-slate-300 mb-1 flex items-center gap-1">
                <Calendar size={13} className="text-rose-400" />
                <span>Data</span>
              </label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full p-2 rounded-xl bg-[#1E293B] border border-slate-700 text-white font-semibold focus:outline-hidden focus:border-cyan-400"
                required
              />
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1 flex items-center gap-1">
                <Clock size={13} className="text-cyan-400" />
                <span>Horário</span>
              </label>
              <input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="w-full p-2 rounded-xl bg-[#1E293B] border border-slate-700 text-white font-semibold focus:outline-hidden focus:border-cyan-400"
                required
              />
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">Duração (min)</label>
              <input
                type="number"
                min="10"
                max="600"
                value={durationMinutes}
                onChange={e => setDurationMinutes(Number(e.target.value))}
                className="w-full p-2 rounded-xl bg-[#1E293B] border border-slate-700 text-white font-bold focus:outline-hidden focus:border-cyan-400"
                required
              />
            </div>
          </div>

          {/* Discipline & Gear */}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block font-bold text-slate-300 mb-1">Modalidade</label>
              <select
                value={discipline}
                onChange={e => setDiscipline(e.target.value as Discipline)}
                className="w-full p-2 rounded-xl bg-[#1E293B] border border-slate-700 text-white font-medium focus:outline-hidden focus:border-cyan-400"
              >
                <option value="Kitesurf Twintip">Kitesurf Twintip</option>
                <option value="Big Air">Big Air</option>
                <option value="Hydrofoil">Hydrofoil</option>
                <option value="Wingfoil">Wingfoil</option>
                <option value="Kitesurf Strapless Wave">Strapless Wave</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">Tamanho da Pipa (m²)</label>
              <div className="flex items-center gap-1">
                {[7, 8, 9, 10, 12].map(sz => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setKiteSizeM2(sz)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      kiteSizeM2 === sz ? 'bg-cyan-500 text-slate-950 shadow-xs' : 'bg-[#1E293B] text-slate-300 border border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    {sz}m
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="session-board-model" className="block font-bold text-slate-300 mb-1">
              Modelo da prancha (opcional)
            </label>
            <input
              id="session-board-model"
              type="text"
              value={boardModel}
              onChange={e => setBoardModel(e.target.value)}
              maxLength={100}
              placeholder="Ex.: Duotone Jaime 136"
              className="w-full p-2.5 rounded-xl bg-[#1E293B] border border-slate-700 text-white placeholder:text-slate-500 focus:outline-hidden focus:border-cyan-400"
            />
          </div>

          {/* Wind & Tide Conditions Recorded */}
          <div className="p-3.5 bg-[#1E293B] rounded-2xl border border-slate-700/80 space-y-2.5">
            <h4 className="font-black text-xs text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
              <Wind size={14} className="text-cyan-400" />
              <span>Condições Registradas no Mar</span>
            </h4>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-slate-400 mb-0.5">Vento Médio (nós)</label>
                <input
                  type="number"
                  value={avgWindKnots}
                  onChange={e => setAvgWindKnots(Number(e.target.value))}
                  className="w-full p-2 rounded-xl bg-[#0F172A] border border-slate-700 text-emerald-400 font-black text-sm"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-0.5">Rajada Máx (nós)</label>
                <input
                  type="number"
                  value={maxGustKnots}
                  onChange={e => setMaxGustKnots(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full p-2 rounded-xl bg-[#0F172A] border border-slate-700 text-amber-400 font-black text-sm"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-0.5">Direção</label>
                <select
                  value={windDirection}
                  onChange={e => setWindDirection(e.target.value)}
                  className="w-full p-2 rounded-xl bg-[#0F172A] border border-slate-700 text-white font-bold text-sm"
                >
                  <option value="ENE">ENE</option>
                  <option value="E">E</option>
                  <option value="ESE">ESE</option>
                  <option value="SE">SE</option>
                  <option value="NE">NE</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <label className="block text-slate-400 mb-0.5">Estado da Maré</label>
                <select
                  value={tideCondition}
                  onChange={e => setTideCondition(e.target.value as 'Seca' | 'Enchendo' | 'Cheia' | 'Vazando')}
                  className="w-full p-2 rounded-xl bg-[#0F172A] border border-slate-700 text-white text-xs"
                >
                  <option value="Enchendo">Enchendo ↗</option>
                  <option value="Cheia">Cheia ⇈</option>
                  <option value="Vazando">Vazando ↘</option>
                  <option value="Seca">Seca ⇊</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-0.5">Condição da Água</label>
                <select
                  value={waterCondition}
                  onChange={e => setWaterCondition(e.target.value)}
                  className="w-full p-2 rounded-xl bg-[#0F172A] border border-slate-700 text-white text-xs"
                >
                  <option value="Flat / Lagoa">Flat / Lagoa</option>
                  <option value="Chop Médio">Chop Médio</option>
                  <option value="Ondas / Swell">Ondas / Swell</option>
                  <option value="Bancada de Areia">Bancada de Areia</option>
                </select>
              </div>
            </div>
          </div>

          {/* GPS / Performance Telemetry */}
          <div
            className={`p-3.5 rounded-2xl border space-y-2 ${
              prefilledFromGps
                ? 'bg-cyan-950/30 border-cyan-500/40'
                : 'bg-[#1E293B] border-slate-700/80'
            }`}
          >
            <h4 className="font-black text-xs text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Gauge size={14} className="text-cyan-400" />
              <span>Telemetria GPS / WOO / Garmin (Opcional)</span>
            </h4>

            {prefilledFromGps && (
              <p className="flex items-start gap-1.5 text-[11px] leading-snug text-cyan-300">
                <Satellite size={13} className="shrink-0 mt-0.5" />
                Distância, velocidade máxima, data, horário e duração vieram
                do rastreamento real do Modo Navegação. Salto mais alto não é
                medido por GPS — preencha só se souber por outro aparelho.
              </p>
            )}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-slate-400 mb-0.5">Distância (km)</label>
                <input
                  type="number"
                  step="0.1"
                  value={distanceKm}
                  onChange={e => setDistanceKm(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full p-2 rounded-xl bg-[#0F172A] border border-slate-700 text-cyan-400 font-bold"
                  placeholder="30.5"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-0.5">Velocidade Máx (nós)</label>
                <input
                  type="number"
                  step="0.1"
                  value={maxSpeedKnots}
                  onChange={e => setMaxSpeedKnots(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full p-2 rounded-xl bg-[#0F172A] border border-slate-700 text-cyan-400 font-bold"
                  placeholder="28.4"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-0.5">Salto Mais Alto (m)</label>
                <input
                  type="number"
                  step="0.1"
                  value={highestJumpM}
                  onChange={e => setHighestJumpM(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full p-2 rounded-xl bg-[#0F172A] border border-slate-700 text-amber-400 font-black"
                  placeholder="10.5"
                />
              </div>
            </div>
          </div>

          {/* Rating */}
          <div>
            <label className="block font-bold text-slate-300 mb-1">Como foi a sessão?</label>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map(star => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  className="p-1 text-2xl transition-transform active:scale-125"
                >
                  <Star
                    size={24}
                    className={rating >= star ? 'fill-amber-400 text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.6)]' : 'text-slate-600'}
                  />
                </button>
              ))}
              <span className="text-xs font-semibold text-slate-400 ml-2">
                {rating === 5 ? 'Épico / Perfeito' : rating === 4 ? 'Muito bom' : 'Bom velejo'}
              </span>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block font-bold text-slate-300 mb-1">Relato & Anotações</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Sensação da pipa, evolução de manobras, parceiros de velejo..."
              className="w-full p-2.5 rounded-xl bg-[#1E293B] border border-slate-700 text-white resize-none h-18 text-xs focus:outline-hidden focus:border-cyan-400"
            />
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={isPublic}
            onClick={() => setIsPublic((value) => !value)}
            className="w-full flex items-center justify-between gap-3 p-3 rounded-xl bg-[#1E293B] border border-slate-700 text-left"
          >
            <span>
              <span className="block font-bold text-slate-200">Publicar na Comunidade</span>
              <span className="block text-[10px] text-slate-400 mt-0.5">
                {isPublic
                  ? 'O Ride aparecerá para outros velejadores.'
                  : 'O Ride ficará visível somente no seu Logbook.'}
              </span>
            </span>
            <span
              aria-hidden="true"
              className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${
                isPublic ? 'bg-cyan-500' : 'bg-slate-700'
              }`}
            >
              <span
                className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                  isPublic ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </span>
          </button>

          {/* Foto real do velejo (opcional) */}
          <div>
            <label htmlFor="session-photo-input" className="block font-bold text-slate-300 mb-1 flex items-center gap-1.5">
              <Camera size={13} className="text-cyan-400" />
              <span>Foto da Sessão (opcional)</span>
            </label>

            {photoUrl ? (
              <div className="relative w-full max-w-[220px] aspect-video rounded-xl overflow-hidden border-2 border-cyan-400/60 shadow-md shadow-cyan-500/20">
                <img src={photoUrl} alt="Pré-visualização da foto do velejo" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => {
                    setPhotoUrl('');
                    setPhotoError('');
                  }}
                  aria-label="Remover foto selecionada"
                  className="absolute top-1 right-1 p-1 rounded-full bg-black/70 hover:bg-black/90 text-white transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <label
                htmlFor="session-photo-input"
                className="flex items-center justify-center gap-2 w-full p-3 rounded-xl border border-dashed border-slate-600 bg-[#1E293B] text-slate-300 font-semibold cursor-pointer hover:bg-slate-800/80 hover:border-cyan-400/60 transition-colors"
              >
                {isCompressingPhoto ? (
                  <>
                    <Loader2 size={16} className="text-cyan-400 animate-spin" />
                    <span>Processando foto...</span>
                  </>
                ) : (
                  <>
                    <ImagePlus size={16} className="text-cyan-400" />
                    <span>Anexar foto (câmera ou galeria)</span>
                  </>
                )}
              </label>
            )}

            <input
              id="session-photo-input"
              type="file"
              /* Sem `capture`: com ele o celular abre direto a câmera e o
                 velejador não consegue escolher a foto do velejo que já tirou.
                 heic/heif explícitos porque é o formato padrão do iPhone. */
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*"
              onChange={handlePhotoChange}
              disabled={isCompressingPhoto}
              className="sr-only"
            />

            {photoError && <p className="mt-1 text-[11px] font-semibold text-rose-400">{photoError}</p>}
          </div>

          {/* Submit */}
          {saveError && (
            <div role="alert" className="p-3 rounded-xl border border-rose-500/50 bg-rose-950/30 text-rose-200 text-xs font-bold">
              {saveError}
            </div>
          )}
          <button
            type="submit"
            disabled={isSaving || isCompressingPhoto}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-sm shadow-xl shadow-cyan-500/25 active:scale-98 transition-all flex items-center justify-center gap-2 mt-4 disabled:opacity-60 disabled:cursor-wait"
          >
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            <span>{isSaving ? 'Salvando velejo...' : 'Salvar no Meu Histórico de Velejos'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
