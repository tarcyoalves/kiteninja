'use client';

import React, { useState } from 'react';
import { X, Camera, MapPin, Wind, Sparkles, Send, Check, Tag } from 'lucide-react';
import { useKiteData } from '../context/KiteDataContext';
import { useAuth } from '../context/AuthContext';

export const NewPostModal: React.FC = () => {
  const { isNewPostOpen, setIsNewPostOpen, spots, addPost } = useKiteData();
  const { user, openAuthModal } = useAuth();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [selectedSpotId, setSelectedSpotId] = useState(spots[0]?.id || 'ponta-do-mel');
  const [knots, setKnots] = useState(20);
  const [kiteUsed, setKiteUsed] = useState('9m² Twintip');
  const [condition, setCondition] = useState('Side-Onshore Liso');
  const [tag, setTag] = useState('Relato de Velejo');
  const [photoUrl, setPhotoUrl] = useState('https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800&q=80');

  if (!isNewPostOpen) return null;

  const targetSpot = spots.find(s => s.id === selectedSpotId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      openAuthModal();
      return;
    }

    addPost({
      authorName: user.name,
      authorAvatar: user.avatarUrl,
      authorRiderId: user.riderId.split(' ')[0] || '4011',
      authorCountryFlag: user.countryFlag || '🇧🇷',
      title,
      content,
      spotName: targetSpot?.name || 'Spot de Kite',
      spotLocation: targetSpot?.location || 'Litoral',
      timestamp: 'Agora mesmo',
      photoUrl: photoUrl || undefined,
      windReport: {
        knots,
        kiteUsed,
        condition,
      },
      tag,
    });

    setIsNewPostOpen(false);
    setTitle('');
    setContent('');
  };

  const samplePhotos = [
    'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800&q=80',
    'https://images.unsplash.com/photo-1518837695005-2083093ee35b?w=800&q=80',
    'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&q=80',
    'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=800&q=80',
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/75 backdrop-blur-xs overflow-y-auto">
      <div className="bg-[#0F172A] text-slate-100 rounded-3xl w-full max-w-md overflow-hidden border border-slate-800 shadow-2xl my-6">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-4 flex items-center justify-between shadow-md">
          <div className="flex items-center gap-2.5">
            <Send size={20} className="text-white" />
            <h2 className="font-black text-base sm:text-lg text-white">Publicar no Feed de Riders</h2>
          </div>
          <button
            onClick={() => setIsNewPostOpen(false)}
            className="p-1.5 rounded-full bg-black/20 hover:bg-black/40 text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-3.5 text-xs">
          {/* Post Title */}
          <div>
            <label className="block font-bold text-slate-300 mb-1">Título da Publicação</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Ex: Sessão épica de 22 nós em Ponta do Mel!"
              className="w-full p-2.5 rounded-xl bg-[#1E293B] border border-slate-700 text-white font-bold text-sm focus:outline-hidden focus:border-cyan-400"
              required
            />
          </div>

          {/* Spot Selection */}
          <div>
            <label className="block font-bold text-slate-300 mb-1 flex items-center gap-1">
              <MapPin size={13} className="text-rose-400" />
              <span>Onde você está velejando?</span>
            </label>
            <select
              value={selectedSpotId}
              onChange={e => setSelectedSpotId(e.target.value)}
              className="w-full p-2.5 rounded-xl bg-[#1E293B] border border-slate-700 text-white font-medium focus:outline-hidden focus:border-cyan-400"
            >
              {spots.map(sp => (
                <option key={sp.id} value={sp.id}>
                  {sp.name} - {sp.location}
                </option>
              ))}
            </select>
          </div>

          {/* Tag & Wind Condition Info */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-bold text-slate-300 mb-1">Categoria</label>
              <select
                value={tag}
                onChange={e => setTag(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-[#1E293B] border border-slate-700 text-white font-semibold focus:outline-hidden focus:border-cyan-400"
              >
                <option value="Relato de Velejo">Relato de Velejo</option>
                <option value="Aulas & Escola">Aulas & Escola</option>
                <option value="Downwind">Downwind</option>
                <option value="Alerta de Vento">Alerta de Vento</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">Vento Real (nós)</label>
              <input
                type="number"
                value={knots}
                onChange={e => setKnots(Number(e.target.value))}
                className="w-full p-2.5 rounded-xl bg-[#1E293B] border border-slate-700 text-cyan-400 font-black text-sm focus:outline-hidden focus:border-cyan-400"
              />
            </div>
          </div>

          {/* Kite & Water Info */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-bold text-slate-300 mb-1">Pipa Utilizada</label>
              <input
                type="text"
                value={kiteUsed}
                onChange={e => setKiteUsed(e.target.value)}
                placeholder="Ex: 9m² Rebel / Wing 5m"
                className="w-full p-2 rounded-xl bg-[#1E293B] border border-slate-700 text-white font-semibold focus:outline-hidden focus:border-cyan-400"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-300 mb-1">Condição do Mar</label>
              <input
                type="text"
                value={condition}
                onChange={e => setCondition(e.target.value)}
                placeholder="Ex: Flat / Choppy / Maré Alta"
                className="w-full p-2 rounded-xl bg-[#1E293B] border border-slate-700 text-white font-semibold focus:outline-hidden focus:border-cyan-400"
              />
            </div>
          </div>

          {/* Content Story */}
          <div>
            <label className="block font-bold text-slate-300 mb-1">Relato do Dia / Dicas</label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Compartilhe como está o mar, o vento, manobras ou chame a galera pro velejo..."
              className="w-full p-2.5 rounded-xl bg-[#1E293B] border border-slate-700 text-white resize-none h-20 focus:outline-hidden focus:border-cyan-400"
              required
            />
          </div>

          {/* Photo Selector */}
          <div>
            <label className="block font-bold text-slate-300 mb-1 flex items-center gap-1">
              <Camera size={13} className="text-cyan-400" />
              <span>Foto do Velejo</span>
            </label>
            <div className="grid grid-cols-4 gap-2">
              {samplePhotos.map((p, idx) => (
                <div
                  key={idx}
                  onClick={() => setPhotoUrl(p)}
                  className={`relative aspect-video rounded-xl overflow-hidden cursor-pointer border-2 transition-all ${
                    photoUrl === p ? 'border-cyan-400 scale-105 shadow-md shadow-cyan-500/30' : 'border-transparent opacity-60 hover:opacity-100'
                  }`}
                >
                  <img src={p} alt="Sample" className="w-full h-full object-cover" />
                  {photoUrl === p && (
                    <div className="absolute top-1 right-1 bg-cyan-400 rounded-full p-0.5 shadow-sm">
                      <Check size={10} className="text-slate-950 stroke-[3]" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-sm shadow-xl shadow-cyan-500/25 active:scale-98 transition-all flex items-center justify-center gap-2 mt-3"
          >
            <Send size={16} />
            <span>Publicar nos Destaques</span>
          </button>
        </form>
      </div>
    </div>
  );
};
