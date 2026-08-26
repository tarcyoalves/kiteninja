'use client';

import React, { use } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

const DownwindLiveReplayViewer = dynamic(
  () =>
    import('@/components/downwind/DownwindLiveReplayViewer').then(
      (m) => m.DownwindLiveReplayViewer
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#070D18] text-slate-300 gap-3">
        <Loader2 size={32} className="text-cyan-400 animate-spin" />
        <p className="text-xs font-bold text-slate-400">Carregando mapa ao vivo...</p>
      </div>
    ),
  }
);

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function DownwindLivePage({ params }: PageProps) {
  const { id } = use(params);

  return (
    <main className="h-screen w-screen bg-[#070D18] overflow-hidden">
      <DownwindLiveReplayViewer downwindId={id} />
    </main>
  );
}