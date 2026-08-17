'use client';

import React, { useState, useCallback, useEffect, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useKiteData } from '../context/KiteDataContext';
import { Spot } from '../types';
import { ChevronRight, Loader2 } from 'lucide-react';
import { nearestSpot } from '../lib/geo';
import { MapLayer } from '@/components/LeafletMap';

// Carregar Leaflet apenas no cliente (SSR = false) — Leaflet depende de window
const LeafletMap = dynamic(
  () => import('@/components/LeafletMap').then((mod) => mod.LeafletMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full bg-[#090e1a]">
        <div className="flex flex-col items-center gap-3 text-cyan-400">
          <Loader2 size={32} className="animate-spin" />
          <span className="text-sm font-bold">Carregando mapa...</span>
        </div>
      </div>
    ),
  }
);

interface MapViewProps {
  onSelectSpot: (spot: Spot) => void;
}

export const MapView: React.FC<MapViewProps> = ({ onSelectSpot }) => {
  const { spots, convertWind, beachMode } = useKiteData();
  const [selectedMapSpot, setSelectedMapSpot] = useState<Spot>(spots[0] || null);
  const [activeLayer, setActiveLayer] = useState<MapLayer>('vento');
  const [locateStatus, setLocateStatus] = useState<'idle' | 'loading' | 'success' | 'error' | 'denied'>('idle');
  const [nearestSpotInfo, setNearestSpotInfo] = useState<{ spot: Spot; distanceKm: number } | null>(null);

  const handleLayerChange = useCallback((layer: MapLayer) => {
    setActiveLayer(layer);
  }, []);

  const handleSelectSpot = useCallback((spot: Spot) => {
    setSelectedMapSpot(spot);
    onSelectSpot(spot);
  }, [onSelectSpot]);

  const handleLocateUser = useCallback(() => {
    if (!navigator.geolocation) {
      setLocateStatus('error');
      return;
    }

    setLocateStatus('loading');
    setNearestSpotInfo(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const result = nearestSpot(latitude, longitude, spots);

        if (result) {
          setNearestSpotInfo(result);
          setLocateStatus('success');
          // O mapa vai centralizar no spot mais próximo automaticamente
        } else {
          setLocateStatus('error');
        }
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setLocateStatus('denied');
        } else {
          setLocateStatus('error');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [spots]);

  /**
   * Os spots chegam da API depois da primeira renderização, então o estado
   * inicial pode nascer nulo. Isto tem que ser efeito: setState no corpo do
   * render dispara re-render em cascata.
   */
  useEffect(() => {
    if (!selectedMapSpot && spots.length > 0) setSelectedMapSpot(spots[0]);
  }, [selectedMapSpot, spots]);

  if (spots.length === 0) {
    return (
      <div className="flex flex-col h-[calc(100vh-120px)] items-center justify-center text-slate-400">
        <p className="text-sm font-bold">Nenhum spot disponível</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] relative overflow-hidden pb-16">
      {/* Leaflet Map with all functionality */}
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-full bg-[#090e1a]">
            <div className="flex flex-col items-center gap-3 text-cyan-400">
              <Loader2 size={32} className="animate-spin" />
              <span className="text-sm font-bold">Carregando mapa...</span>
            </div>
          </div>
        }
      >
        <LeafletMap
          spots={spots}
          selectedSpot={selectedMapSpot}
          onSelectSpot={handleSelectSpot}
          activeLayer={activeLayer}
          onLayerChange={handleLayerChange}
          onLocateUser={handleLocateUser}
          locateStatus={locateStatus}
          nearestSpotInfo={nearestSpotInfo}
        />
      </Suspense>

      {/* Selected Spot Bottom Floating Card */}
      {selectedMapSpot && (
        <div className="absolute bottom-2 left-3 right-3 z-[1000]">
          <div
            onClick={() => onSelectSpot(selectedMapSpot)}
            className="bg-[#1E293B]/95 backdrop-blur-md text-white p-3.5 rounded-2xl border border-slate-700 shadow-2xl flex items-center justify-between cursor-pointer hover:bg-slate-800 active:scale-99 transition-all"
          >
            <div className="flex items-center gap-3 min-w-0">
              {/* Wind circle badge */}
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-rose-700 flex flex-col items-center justify-center shrink-0 shadow-md shadow-rose-600/30">
                <span className="text-base font-black leading-none">
                  {selectedMapSpot.currentKnots}
                </span>
                <span className="text-[9px] font-black uppercase tracking-tight opacity-95">
                  Nós
                </span>
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-extrabold text-sm text-white truncate">
                    {selectedMapSpot.name}
                  </h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    {selectedMapSpot.windSafety}
                  </span>
                </div>
                <p className="text-xs text-slate-400 truncate mt-0.5">
                  {selectedMapSpot.location} &bull; Maré: {selectedMapSpot.currentTideHeightM}m ({selectedMapSpot.currentTideTrend})
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 pl-2 shrink-0 text-cyan-400 font-black text-xs">
              <span>Ver Previsão</span>
              <ChevronRight size={16} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
