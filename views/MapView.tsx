'use client';

import React, { useState, useCallback, useEffect, Suspense, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useKiteData } from '../context/KiteDataContext';
import { Spot } from '../types';
import { Loader2, Navigation } from 'lucide-react';
import { nearestSpot } from '../lib/geo';
import { UserPosition } from '@/components/LeafletMap';
import { ModoNavegacao, ResumoNavegacao } from '@/components/ModoNavegacao';
import { paraPrefillLogbook, valePenaRegistrarSessao } from '@/lib/trilhaSessao';
import { useDownwind } from '@/context/DownwindContext';
import { IniciarAtividadeSheet } from '@/components/activity/IniciarAtividadeSheet';
import { CriarDownwindModal } from '@/components/activity/CriarDownwindModal';

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

/**
 * Prazo do vigia de localização — ver `handleLocateUser`. Maior que o
 * `timeout` de 8s do `getCurrentPosition` abaixo: a folga é justamente para
 * cobrir o caso em que aquele `timeout` NÃO é respeitado pelo navegador (o
 * bug que este vigia existe para pegar), não para duplicar o mesmo prazo.
 */
const LOCATE_WATCHDOG_MS = 10_000;

interface MapViewProps {
  onSelectSpot: (spot: Spot) => void;
}

export const MapView: React.FC<MapViewProps> = ({ onSelectSpot }) => {
  const {
    spots,
    convertWind,
    beachMode,
    allActiveSosList,
    setLastKnownPosition,
    abrirLoggerComResumo,
  } = useKiteData();
  const { downwindAtivo, recarregar: recarregarDownwind } = useDownwind();
  const [selectedMapSpot, setSelectedMapSpot] = useState<Spot>(spots[0] || null);
  const [locateStatus, setLocateStatus] = useState<
    'idle' | 'loading' | 'success' | 'error' | 'denied' | 'timeout'
  >('idle');
  const [nearestSpotInfo, setNearestSpotInfo] = useState<{ spot: Spot; distanceKm: number } | null>(null);
  const [userPosition, setUserPosition] = useState<UserPosition | null>(null);
  // Referência para o watch ID - precisa existir para limpar no unmount
  const watchIdRef = useRef<number | null>(null);
  // Modo Navegação: tela cheia preta que mantém o app em primeiro plano
  // durante uma travessia. Entra a partir daqui (aba Mapa) porque é onde o
  // velejador está antes de ir para a água — ver components/ModoNavegacao.tsx.
  const [modoNavegacaoAtivo, setModoNavegacaoAtivo] = useState(false);
  const [sheetIniciarAberto, setSheetIniciarAberto] = useState(false);
  const [modalCriarDwAberto, setModalCriarDwAberto] = useState(false);
  // Incrementado a cada clique manual no botão "Minha localização", para o
  // LeafletMap recentralizar mesmo quando o watch de GPS já está rodando (ver
  // handleLocateButtonClick abaixo).
  const [recenterTick, setRecenterTick] = useState(0);

  const handleEntrarConvite = useCallback(async (token: string) => {
    try {
      const res = await fetch(`/api/downwind/invite/${token}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || 'Falha ao entrar no downwind.' };
      await recarregarDownwind();
      return { ok: true };
    } catch {
      return { ok: false, error: 'Erro de conexão ao validar convite.' };
    }
  }, [recarregarDownwind]);

  const handleCriarDownwind = useCallback(async (dados: {
    nome: string;
    spotSaida: string;
    spotChegada?: string;
    previstoPara?: string;
    visibilidade: 'privado' | 'comunidade';
  }) => {
    try {
      const res = await fetch('/api/downwind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || 'Falha ao criar downwind.' };
      await recarregarDownwind();
      return { ok: true, downwindId: data.id };
    } catch {
      return { ok: false, error: 'Erro de conexão ao criar downwind.' };
    }
  }, [recarregarDownwind]);

  /**
   * Registro pessoal: ao sair do Modo Navegação a partir DESTE mapa (sempre
   * um velejo solo, nunca um downwind em grupo — ver ModoNavegacaoProps em
   * components/ModoNavegacao.tsx), o resumo real de GPS vira um rascunho do
   * logbook em vez de simplesmente ser descartado. `valePenaRegistrarSessao`
   * filtra sessões sem dado real (ex.: toque acidental no botão Iniciar), e
   * `paraPrefillLogbook` só converte o que o GPS de fato mede — vento, maré,
   * prancha e nota da sessão continuam sempre preenchimento manual.
   */
  const handleSairModoNavegacao = useCallback(
    (resumo: ResumoNavegacao) => {
      setModoNavegacaoAtivo(false);
      if (!valePenaRegistrarSessao(resumo)) return;
      abrirLoggerComResumo(paraPrefillLogbook(resumo, new Date()));
    },
    [abrirLoggerComResumo]
  );

  const handleSelectSpot = useCallback((spot: Spot) => {
    setSelectedMapSpot(spot);
    onSelectSpot(spot);
  }, [onSelectSpot]);

  // Cleanup do watch de geolocalização: evita vazamento de GPS que drena bateria.
  // Executa quando o componente desmonta OU quando a aba vai para segundo plano.
  useEffect(() => {
    const limparWatch = () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
    const limparWatchAoOcultar = () => {
      if (document.hidden) limparWatch();
    };

    // Reutiliza a mesma referência no add/removeEventListener; uma função
    // anônima nova no cleanup não remove o listener registrado anteriormente.
    window.addEventListener('beforeunload', limparWatch);
    document.addEventListener('visibilitychange', limparWatchAoOcultar);

    return () => {
      limparWatch();
      window.removeEventListener('beforeunload', limparWatch);
      document.removeEventListener('visibilitychange', limparWatchAoOcultar);
    };
  }, []);

  /**
   * Inicia o rastreamento da posição do usuário usando watchPosition.
   * Segue o velejador em tempo real enquanto ele se move na praia.
   * O cleanup é feito no useEffect acima.
   */
  const handleLocateUser = useCallback(() => {
    if (!navigator.geolocation) {
      setLocateStatus('error');
      return;
    }

    // Já está rastreando? Não iniciar outro watch.
    if (watchIdRef.current !== null) {
      return;
    }

    setLocateStatus('loading');
    setNearestSpotInfo(null);
    setUserPosition(null);

    /**
     * Vigia do primeiro fix: existe porque um PWA instalado na tela de
     * início do iOS pede a permissão de localização separada da do Safari
     * — e em certas versões/combinações o WebKit não chama NEM onSuccess
     * NEM onError quando essa permissão específica trava, mesmo com
     * `timeout` explícito nas opções abaixo (que deveria, mas nem sempre,
     * garantir uma resposta). Sem este vigia, a tela ficava presa para
     * sempre em "Localizando..." sem nenhuma pista do que fazer — o
     * sintoma real relatado ("o mapa não centraliza ao abrir") é
     * indistinguível, de fora, de "ainda não recebi resposta nenhuma do
     * navegador". `cancelarVigia()` só cancela o TEMPORIZADOR, nunca
     * desliga onSuccess/onError — o watchPosition abaixo segue chamando
     * onSuccess a cada atualização de posição pelo resto da sessão.
     */
    let vigiaAtivo = true;
    const vigia = setTimeout(() => {
      if (vigiaAtivo) {
        vigiaAtivo = false;
        setLocateStatus('timeout');
        // Libera o botão "Minha localização" para tentar de novo: sem isto,
        // watchIdRef.current continuaria preenchido (watchPosition devolve um
        // ID síncrono mesmo quando nunca chama de volta), e um novo clique
        // cairia no caminho de "só recentralizar" em vez de reiniciar o GPS
        // de verdade — deixando o velejador sem nenhuma saída a não ser sair
        // e voltar para a aba Mapa.
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
      }
    }, LOCATE_WATCHDOG_MS);
    const cancelarVigia = () => {
      if (vigiaAtivo) {
        vigiaAtivo = false;
        clearTimeout(vigia);
      }
    };

    // Sucesso: atualiza posição e encontra spot mais próximo
    const onSuccess = (position: GeolocationPosition) => {
      cancelarVigia();
      const { latitude, longitude, accuracy } = position.coords;

      // Guardar a posição real do usuário para desenhar no mapa
      setUserPosition({ lat: latitude, lng: longitude, accuracy });

      // Também guarda no contexto compartilhado: é essa posição que o
      // heartbeat de presença (ChatView) reenvia, sem precisar de um novo
      // watchPosition nem de pedir permissão de GPS de novo — a seleção de
      // candidatos de um SOS depende de alguma posição estar aqui.
      setLastKnownPosition({ lat: latitude, lng: longitude });

      // Calcular o spot mais próximo
      const result = nearestSpot(latitude, longitude, spots);
      if (result) {
        setNearestSpotInfo(result);
      }
      setLocateStatus('success');
    };

    // Erro: traduzir código de erro em mensagem útil
    const onError = (error: GeolocationPositionError) => {
      cancelarVigia();
      if (error.code === error.PERMISSION_DENIED) {
        setLocateStatus('denied');
      } else if (error.code === error.TIMEOUT) {
        setLocateStatus('error');
      } else {
        // PERMISSION_DENIED, POSITION_UNAVAILABLE, TIMEOUT
        setLocateStatus('error');
      }
    };

    // Obter fix imediato rápido (para renderizar o pino na hora)
    navigator.geolocation.getCurrentPosition(
      onSuccess,
      onError,
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );

    // Iniciar watchPosition para seguir o usuário em tempo real
    watchIdRef.current = navigator.geolocation.watchPosition(
      onSuccess,
      onError,
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  }, [spots, setLastKnownPosition]);

  /**
   * Clique manual no botão "Minha localização".
   *
   * `handleLocateUser` só inicia o watch a primeira vez — a partir daí
   * `watchIdRef.current` fica preenchido para sempre e a função vira um no-op
   * silencioso (é assim que evita abrir um segundo watch). Isso fazia o botão
   * "para centralizar" funcionar só uma vez, na abertura automática da tela:
   * clicar de novo depois não fazia nada visível, nem recentralizava, nem
   * pedia um fix novo de GPS. `recenterTick` é o sinal explícito de "quero
   * ver minha posição agora", separado de "quero começar a rastrear" — o
   * LeafletMap recentraliza com zoom próximo sempre que este contador muda,
   * usando a posição mais recente já conhecida.
   */
  const handleLocateButtonClick = useCallback(() => {
    if (watchIdRef.current === null) {
      handleLocateUser();
      return;
    }
    setRecenterTick((t) => t + 1);
  }, [handleLocateUser]);

  /**
   * Para o rastreamento quando o usuário sai da tela de mapa.
   */
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  /**
   * Localiza automaticamente ao abrir a tela de mapa no celular/desktop.
   */
  useEffect(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) return;
    handleLocateUser();
  }, [handleLocateUser]);

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
      <div className="flex flex-col app-viewport items-center justify-center text-slate-400">
        <p className="text-sm font-bold">Nenhum spot disponível</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col app-viewport relative overflow-hidden">
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
          onLocateUser={handleLocateButtonClick}
          recenterTrigger={recenterTick}
          locateStatus={locateStatus}
          nearestSpotInfo={nearestSpotInfo}
          userPosition={userPosition}
          activeSosList={allActiveSosList}
        />
      </Suspense>

      {/* Entrada do Modo Navegação (referência: botão de PLAY do Wind Maps).
          Fica no meio da lateral direita de propósito: o topo já é ocupado
          pelos controles de estilo/localização do LeafletMap (mais o
          aviso de GPS, quando aparece), e o rodapé é ocupado pelo menu
          flutuante (altura real em --nav-h). Um ponto fixo na metade
          vertical da tela nunca cai dentro de nenhuma dessas duas faixas,
          em nenhum iPhone. */}
      {!modoNavegacaoAtivo && (
        <button
          type="button"
          onClick={() => setSheetIniciarAberto(true)}
          className="absolute right-3 top-1/2 -translate-y-1/2 z-map-ui flex flex-col items-center justify-center gap-0.5 w-16 h-16 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 border border-cyan-300/40 text-slate-950 shadow-2xl shadow-cyan-500/30 active:scale-95 transition-all"
          aria-label="Iniciar atividade no mapa"
          title="Iniciar Velejo ou Downwind"
        >
          <Navigation size={20} className="fill-current stroke-[1.5]" />
          <span className="text-[9px] font-black leading-none tracking-tight">INICIAR</span>
        </button>
      )}

      {sheetIniciarAberto && (
        <IniciarAtividadeSheet
          isOpen={sheetIniciarAberto}
          onClose={() => setSheetIniciarAberto(false)}
          selectedSpot={selectedMapSpot}
          downwindAtivo={downwindAtivo}
          modoNavegacaoAtivo={modoNavegacaoAtivo}
          onIniciarVelejoSolo={() => setModoNavegacaoAtivo(true)}
          onAbrirCriarDownwind={() => setModalCriarDwAberto(true)}
          onAbrirEntrarPorLink={() => {
            const token = window.prompt('Cole o link ou token do convite de downwind:');
            if (token) handleEntrarConvite(token.trim().replace(/^.*dw_invite=/, ''));
          }}
          onContinuarDownwindAtivo={() => {
            setSheetIniciarAberto(false);
          }}
          onCompartilharSoloLink={async () => {
            const shareData = {
              title: 'Acompanhar Velejo KiteNinja',
              text: `Estou iniciando um velejo solo em ${selectedMapSpot?.name || 'KiteNinja'}! Acompanhe comigo.`,
              url: typeof window !== 'undefined' ? window.location.origin : '',
            };
            if (navigator.share) {
              try {
                await navigator.share(shareData);
              } catch {}
            } else if (navigator.clipboard) {
              await navigator.clipboard.writeText(shareData.url);
              alert('Link copiado para a área de transferência!');
            }
          }}
        />
      )}

      {modalCriarDwAberto && (
        <CriarDownwindModal
          isOpen={modalCriarDwAberto}
          onClose={() => setModalCriarDwAberto(false)}
          spots={spots}
          defaultSpotId={selectedMapSpot?.id}
          onCriarDownwind={handleCriarDownwind}
        />
      )}

      {modoNavegacaoAtivo && (
        <ModoNavegacao onSair={handleSairModoNavegacao} />
      )}
    </div>
  );
};
