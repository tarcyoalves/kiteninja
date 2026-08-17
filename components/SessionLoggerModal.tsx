'use client';

import React, { useState } from 'react';
import { X, Calendar, Clock, Wind, Waves, Star, Compass, Camera, Sparkles, Gauge, ArrowUpCircle, ImagePlus, Loader2 } from 'lucide-react';
import { useKiteData } from '../context/KiteDataContext';
import { useAuth } from '../context/AuthContext';
import { Discipline } from '../types';
import { compressImage } from '../lib/imageCompress';

const MAX_PHOTO_BYTES = 12 * 1024 * 1024; // 12MB — limite antes de processar, para não travar o navegador com arquivos gigantes
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

export const SessionLoggerModal: React.FC = () => {
  const { isLoggerOpen, setIsLoggerOpen, spots, addSession, convertWind } = useKiteData();
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
  const [maxGustKnots, setMaxGustKnots] = useState(26);
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
  const [isPublic, setIsPublic] = useState(true);

  if (!isLoggerOpen) return null;

  const targetSpot = spots.find(s => s.id === selectedSpotId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalSpotName = selectedSpotId === 'outro' ? (customSpotName || 'Spot Customizado') : (targetSpot?.name || 'Spot');
    const finalSpotLocation = selectedSpotId === 'outro' ? 'Brasil' : (targetSpot?.location || 'Litoral');

    addSession({
      userId: user?.id || 'user_guest',
      userName: user?.name || 'Velejador Rider',
      userAvatar: user?.avatarUrl,
      spotId: selectedSpotId,
      spotName: finalSpotName,
      spotLocation: finalSpotLocation,
      date: new Date(date + 'T12:00:00').toLocaleDateString('pt-BR'),
      startTime,
      durationMinutes: Number(durationMinutes),
      discipline,
      kiteSizeM2: Number(kiteSizeM2),
      boardModel: boardModel || undefined,
      avgWindKnots: Number(avgWindKnots),
      maxGustKnots: Number(maxGustKnots),
      windDirection,
      tideCondition,
      waterCondition,
      rating,
      distanceKm: distanceKm ? Number(distanceKm) : undefined,
      maxSpeedKnots: maxSpeedKnots ? Number(maxSpeedKnots) : undefined,
      highestJumpM: highestJumpM ? Number(highestJumpM) : undefined,
      notes: notes || undefined,
      photoUrl: photoUrl || undefined,
      isPublic,
    });

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
            onClick={() => setIsLoggerOpen(false)}
            className="p-1.5 rounded-full bg-black/20 hover:bg-black/40 text-white transition-colors"
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
                  onChange={e => setMaxGustKnots(Number(e.target.value))}
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
                  onChange={e => setTideCondition(e.target.value as any)}
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
          <div className="p-3.5 bg-[#1E293B] rounded-2xl border border-slate-700/80 space-y-2">
            <h4 className="font-black text-xs text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Gauge size={14} className="text-cyan-400" />
              <span>Telemetria GPS / WOO / Garmin (Opcional)</span>
            </h4>
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
          <button
            type="submit"
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-sm shadow-xl shadow-cyan-500/25 active:scale-98 transition-all flex items-center justify-center gap-2 mt-4"
          >
            <Sparkles size={16} />
            <span>Salvar no Meu Histórico de Velejos</span>
          </button>
        </form>
      </div>
    </div>
  );
};
