'use client';

import { useEffect, useRef, useState } from 'react';
import { mesclarTrilha, proximoCursor, ultimoTimestamp, type PontoTrilha } from './trilhaDownwind';

/**
 * Poll de `GET /api/downwind/[id]/posicoes` — o único endpoint com polling
 * desta feature (ver docs/PLANO-DOWNWIND-MAPA.md sobre a regra de custo: um
 * único GET devolve todo mundo).
 *
 * Cadência de 30s, e PAUSA por dois motivos, ao contrário do beacon de envio
 * (lib/useDownwindBeacon.ts), que só pausa com a aba oculta: `document.hidden`
 * (ninguém está olhando) e `pausado` (prop externa — usada na Fase 7 para não
 * gastar invocação enquanto o Modo Navegação, tela preta, está por cima).
 */

const INTERVALO_MS = 30_000;

export interface DownwindParticipanteMapa {
  userId: string;
  nome: string;
  avatarUrl: string | null;
  papel: 'velejador' | 'apoio_terra';
  ehOrganizador: boolean;
  estado: 'confirmado' | 'navegando' | 'encerrado' | 'desistiu';
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  registradoEm: string | null;
  ehMeuApoio: boolean;
  souApoioDele: boolean;
}

export interface UseDownwindPosicoesState {
  participantes: DownwindParticipanteMapa[];
  minhaTrilha: PontoTrilha[];
  carregando: boolean;
  erro: string | null;
  servePosicoes: boolean;
}

export function useDownwindPosicoes(
  downwindId: string | null,
  pausado: boolean
): UseDownwindPosicoesState {
  const [participantes, setParticipantes] = useState<DownwindParticipanteMapa[]>([]);
  const [minhaTrilha, setMinhaTrilha] = useState<PontoTrilha[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [servePosicoes, setServePosicoes] = useState(true);

  const cursorRef = useRef<string | null>(null);
  const emVoo = useRef(false);
  const trilhaRef = useRef<PontoTrilha[]>([]);

  useEffect(() => {
    if (!downwindId) return;
    let cancelado = false;
    cursorRef.current = null;
    trilhaRef.current = [];

    const buscar = async () => {
      if (emVoo.current || document.hidden || pausado) return;
      emVoo.current = true;
      try {
        const url = new URL(`/api/downwind/${downwindId}/posicoes`, window.location.origin);
        if (cursorRef.current) url.searchParams.set('desde', cursorRef.current);

        const res = await fetch(url.toString(), { cache: 'no-store' });
        const body = await res.json().catch(() => null);
        if (cancelado) return;

        if (!res.ok) {
          setErro(body?.error ?? 'Não foi possível carregar o mapa.');
          return;
        }
        setErro(null);
        setServePosicoes(Boolean(body.downwind?.servePosicoes));
        setParticipantes((body.participantes ?? []) as DownwindParticipanteMapa[]);

        const novos = (body.trilha ?? []) as PontoTrilha[];
        trilhaRef.current = mesclarTrilha(trilhaRef.current, novos);
        setMinhaTrilha(trilhaRef.current);

        // Se a resposta veio truncada (muitos pontos pendentes), o cursor
        // avança só até o último ponto de fato recebido — nunca "agora" —
        // para não abrir buraco na trilha. Ver lib/trilhaDownwind.ts.
        const ultimo = ultimoTimestamp(novos);
        cursorRef.current = proximoCursor(cursorRef.current, ultimo) ?? body.cursor ?? cursorRef.current;
      } catch {
        if (!cancelado) setErro('Falha de conexão.');
      } finally {
        emVoo.current = false;
        if (!cancelado) setCarregando(false);
      }
    };

    buscar();
    const id = setInterval(buscar, INTERVALO_MS);

    const onVisibility = () => {
      if (!document.hidden && !pausado) buscar();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelado = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // `pausado` de propósito fora das deps: mudar de pausado para ativo não
    // deve reiniciar o polling do zero (perderia o cursor); o próximo tick ou
    // o listener de visibilidade já cobre a retomada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downwindId]);

  return { participantes, minhaTrilha, carregando, erro, servePosicoes };
}
