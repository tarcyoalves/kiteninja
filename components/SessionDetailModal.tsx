'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  AlertTriangle,
  ArrowUpToLine,
  Clock,
  Compass,
  CornerDownRight,
  Droplet,
  Gauge,
  Heart,
  Layers,
  Loader2,
  MessageCircle,
  Route,
  Send,
  Star,
  Trash2,
  User,
  Waves,
  Wind,
  X,
  Zap,
} from 'lucide-react';
import { EstatisticaCard } from './CardSessaoFeed';
import { TrilhaMiniatura } from './TrilhaMiniatura';
import { useAuth } from '@/context/AuthContext';
import { useCurtidaOtimista } from '@/lib/useCurtidaOtimista';
import { formatRelativeTime } from '@/lib/chat';
import type { SessionComment, SessionDetail } from '@/types';

/**
 * Mesmo Leaflet real do card do feed (não um mapa novo) — a diferença aqui é
 * que este modal é UM só aberto por vez, então monta direto, sem o gate de
 * `IntersectionObserver` que `CardSessaoFeed` usa (esse gate existe para uma
 * LISTA de vários cards rolando, não para um único modal já aberto de
 * propósito).
 */
const CardSessaoFeedMapa = dynamic(
  () => import('./CardSessaoFeedMapa').then((m) => m.CardSessaoFeedMapa),
  { ssr: false }
);

interface SessionDetailModalProps {
  /** `null` = modal fechado — mesmo contrato de `riderId` em RiderProfileModal. */
  sessionId: string | null;
  onClose: () => void;
  /** Toca no autor lá dentro → abre o perfil dele (mesmo `setRiderIdAberto`
   * do contexto que já circula pelo resto do app). */
  onAbrirPerfil: (riderId: string) => void;
}

function formatarDuracao(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, '0')}`;
}

interface ComentarioItemProps {
  comentario: SessionComment;
  podeApagar: boolean;
  onApagar: () => void;
  /** Ausente para uma RESPOSTA: comentário que já é resposta não pode ganhar
   * outra resposta (Fase 6, regra de 1 nível — reforço visual do que a rota
   * já reforça no servidor via podeResponderComentario). */
  onResponder?: () => void;
  respondendoAberto?: boolean;
}

/** Um comentário (ou resposta) da lista — mesmo visual para os dois casos,
 * só o recuo (`ml-8` de quem chama) e o botão "Responder" diferem. */
const ComentarioItem: React.FC<ComentarioItemProps> = ({
  comentario: c,
  podeApagar,
  onApagar,
  onResponder,
  respondendoAberto,
}) => (
  <div className="flex items-start gap-2.5">
    <div className="w-8 h-8 rounded-full bg-slate-800 ring-1 ring-slate-700 overflow-hidden shrink-0 flex items-center justify-center">
      {c.userAvatarUrl ? (
        <img src={c.userAvatarUrl} alt={c.userName} className="w-full h-full object-cover" />
      ) : (
        <User size={14} className="text-slate-400" />
      )}
    </div>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-black text-slate-100 truncate">{c.userName}</span>
        <span className="text-[10px] text-slate-500 font-mono shrink-0">
          {formatRelativeTime(c.createdAt)}
        </span>
      </div>
      <p className="text-sm text-slate-300 leading-snug break-words">{c.text}</p>
      {onResponder && (
        <button
          type="button"
          onClick={onResponder}
          className={`mt-0.5 flex items-center gap-1 text-[11px] font-bold transition-colors ${
            respondendoAberto ? 'text-cyan-300' : 'text-slate-500 hover:text-cyan-400'
          }`}
        >
          <CornerDownRight size={12} />
          Responder
        </button>
      )}
    </div>
    {podeApagar && (
      <button
        type="button"
        onClick={onApagar}
        className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
        aria-label="Apagar comentário"
      >
        <Trash2 size={14} />
      </button>
    )}
  </div>
);

/**
 * Detalhe de uma sessão de velejo (Fase 5 do plano de rede social): o
 * "achar → seguir → ver o velejo" ganha aqui a página final — mapa full-bleed
 * (reaproveitando `CardSessaoFeedMapa`/`TrilhaMiniatura`, não um mapa novo),
 * estatísticas completas (o card do feed só mostra 4 números; aqui mostra
 * tudo que `SessionDetail` carrega) e comentários, que a Fase 3 tinha
 * deixado só como contagem.
 *
 * Mesmo padrão estrutural de `RiderProfileModal.tsx`: header com botão
 * fechar, foco inicial nele, fetch com guard `ativo`, estados
 * carregando/erro.
 */
export const SessionDetailModal: React.FC<SessionDetailModalProps> = ({
  sessionId,
  onClose,
  onAbrirPerfil,
}) => {
  const { user, canModerateEvents } = useAuth();

  const [sessao, setSessao] = useState<SessionDetail | null>(null);
  const [carregandoSessao, setCarregandoSessao] = useState(false);
  const [erroSessao, setErroSessao] = useState<string | null>(null);

  const [comentarios, setComentarios] = useState<SessionComment[]>([]);
  const [carregandoComentarios, setCarregandoComentarios] = useState(false);

  const [textoComentario, setTextoComentario] = useState('');
  const [enviandoComentario, setEnviandoComentario] = useState(false);
  const [erroComentario, setErroComentario] = useState<string | null>(null);

  // Resposta a comentário (Fase 6, estilo Facebook: só 1 nível) — campo
  // ANINHADO sob o comentário de primeiro nível, não um modal novo.
  // `respondendoParaId` é o id do comentário-pai cujo campo está aberto;
  // `null` = nenhum campo de resposta aberto no momento.
  const [respondendoParaId, setRespondendoParaId] = useState<string | null>(null);
  const [textoResposta, setTextoResposta] = useState('');
  const [enviandoResposta, setEnviandoResposta] = useState(false);
  const [erroResposta, setErroResposta] = useState<string | null>(null);

  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Detalhe da sessão — estado de carregamento PRÓPRIO, independente dos
  // comentários abaixo: se o detalhe chega primeiro, a tela já renderiza sem
  // esperar a segunda requisição terminar.
  useEffect(() => {
    if (!sessionId) {
      setSessao(null);
      setErroSessao(null);
      return;
    }

    let ativo = true;
    setCarregandoSessao(true);
    setErroSessao(null);

    (async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`, { cache: 'no-store' });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(
            (body && typeof body === 'object' && 'error' in body
              ? String((body as { error: unknown }).error)
              : null) || 'Não foi possível carregar o velejo.'
          );
        }
        if (!ativo) return;
        setSessao((body as { sessao: SessionDetail }).sessao);
      } catch (err) {
        if (ativo) setErroSessao(err instanceof Error ? err.message : 'Falha ao carregar o velejo.');
      } finally {
        if (ativo) setCarregandoSessao(false);
      }
    })();

    return () => {
      // Evita aplicar a resposta de uma sessão que o velejador já fechou (ou
      // trocou por outra, tocando em dois cards em sequência).
      ativo = false;
    };
  }, [sessionId]);

  // Comentários — segundo fetch, em paralelo com o de cima (efeitos
  // separados, não Promise.all): um comentário lento nunca atrasa a
  // renderização do detalhe, que já pode ter chegado.
  useEffect(() => {
    if (!sessionId) {
      setComentarios([]);
      return;
    }

    let ativo = true;
    setCarregandoComentarios(true);

    (async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/comments`, { cache: 'no-store' });
        const body = await res.json().catch(() => null);
        if (!res.ok) return;
        if (!ativo) return;
        setComentarios((body as { comentarios: SessionComment[] }).comentarios);
      } catch {
        // Falha ao listar comentários não trava o resto do modal.
      } finally {
        if (ativo) setCarregandoComentarios(false);
      }
    })();

    return () => {
      ativo = false;
    };
  }, [sessionId]);

  // Esc fecha e trava o scroll do fundo — mesmo padrão de RiderProfileModal.
  useEffect(() => {
    if (!sessionId) return;
    closeButtonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = anterior;
    };
  }, [sessionId, onClose]);

  // Curtida otimista — mesmo hook de CardSessaoFeed (lib/useCurtidaOtimista.ts).
  // Chamado incondicionalmente (regra dos hooks): com o modal fechado
  // (`sessao === null`) os valores de entrada são só placeholders, nunca
  // usados porque o componente devolve `null` mais abaixo.
  const { curtido, contagem: contagemCurtidas, alternar: handleCurtir } = useCurtidaOtimista(
    sessionId ?? '',
    sessao?.euCurti ?? false,
    sessao?.curtidas ?? 0
  );

  const handleEnviarComentario = useCallback(() => {
    if (!sessionId) return;
    const texto = textoComentario.trim();
    if (!texto || enviandoComentario) return;

    setEnviandoComentario(true);
    setErroComentario(null);

    fetch(`/api/sessions/${sessionId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: texto }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(
            (body && typeof body === 'object' && 'error' in body
              ? String((body as { error: unknown }).error)
              : null) || 'Não foi possível comentar.'
          );
        }
        // Pedido ordenado por created_at ASC — o novo vai no FIM da lista
        // local, sem esperar recarregar a lista inteira.
        setComentarios((prev) => [...prev, (body as { comentario: SessionComment }).comentario]);
        setTextoComentario('');
      })
      .catch((err) => setErroComentario(err instanceof Error ? err.message : 'Falha de rede ao comentar.'))
      .finally(() => setEnviandoComentario(false));
  }, [sessionId, textoComentario, enviandoComentario]);

  const handleApagarComentario = useCallback(
    (commentId: string) => {
      if (!sessionId) return;
      // Otimista: some da lista na hora; reverte se o servidor recusar (ex.:
      // permissão perdida entre o clique e a resposta) — mesmo padrão de
      // deleteEvent em KiteDataContext.tsx.
      setComentarios((prev) => prev.filter((c) => c.id !== commentId));

      fetch(`/api/sessions/${sessionId}/comments/${commentId}`, { method: 'DELETE' }).then((res) => {
        if (res.ok) return;
        // Recarrega a lista real do servidor em vez de reinserir o item
        // localmente (evita ressuscitar um comentário que outro moderador
        // apagou de verdade entre o clique e esta resposta).
        fetch(`/api/sessions/${sessionId}/comments`, { cache: 'no-store' })
          .then((r) => r.json())
          .then((body) => setComentarios((body as { comentarios: SessionComment[] }).comentarios))
          .catch(() => {});
      }).catch(() => {});
    },
    [sessionId]
  );

  const handleAbrirResposta = useCallback((parentId: string) => {
    setRespondendoParaId((atual) => (atual === parentId ? null : parentId));
    setTextoResposta('');
    setErroResposta(null);
  }, []);

  const handleEnviarResposta = useCallback(
    (parentId: string) => {
      if (!sessionId) return;
      const texto = textoResposta.trim();
      if (!texto || enviandoResposta) return;

      setEnviandoResposta(true);
      setErroResposta(null);

      fetch(`/api/sessions/${sessionId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: texto, parentCommentId: parentId }),
      })
        .then(async (res) => {
          const body = await res.json().catch(() => null);
          if (!res.ok) {
            throw new Error(
              (body && typeof body === 'object' && 'error' in body
                ? String((body as { error: unknown }).error)
                : null) || 'Não foi possível responder.'
            );
          }
          // Mesmo padrão otimista do comentário raiz: insere no FIM da lista
          // local (ordem cronológica) — o agrupamento por comentário-pai
          // acontece na renderização, não aqui.
          setComentarios((prev) => [...prev, (body as { comentario: SessionComment }).comentario]);
          setTextoResposta('');
          setRespondendoParaId(null);
        })
        .catch((err) => setErroResposta(err instanceof Error ? err.message : 'Falha de rede ao responder.'))
        .finally(() => setEnviandoResposta(false));
    },
    [sessionId, textoResposta, enviandoResposta]
  );

  // Após todos os hooks (regra do React): fechado não renderiza nada.
  if (!sessionId) return null;

  const temTrilha = Boolean(sessao?.trilhaReduzida && sessao.trilhaReduzida.length > 0);
  const podeApagar = (autorComentarioId: string) =>
    Boolean(user && (autorComentarioId === user.id || canModerateEvents));

  // Agrupamento de respostas sob o comentário-pai (Fase 6) — feito no
  // CLIENTE: a rota devolve tudo ordenado por created_at ASC, sem aninhar
  // (ver GET /api/sessions/[id]/comments). Comentários com `parentCommentId`
  // nulo são de primeiro nível; os demais entram no mapa pelo id do pai, na
  // mesma ordem cronológica em que já vieram.
  const comentariosDePrimeiroNivel = comentarios.filter((c) => c.parentCommentId === null);
  const respostasPorPai = new Map<string, SessionComment[]>();
  for (const c of comentarios) {
    if (!c.parentCommentId) continue;
    const lista = respostasPorPai.get(c.parentCommentId) ?? [];
    lista.push(c);
    respostasPorPai.set(c.parentCommentId, lista);
  }

  return (
    <div className="fixed inset-0 z-modal flex items-start sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-xs overflow-y-auto">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={sessao ? `Velejo em ${sessao.spotName}` : 'Detalhe do velejo'}
        className="bg-[#0F172A] text-slate-100 w-full max-w-lg sm:rounded-3xl border-slate-800 sm:border shadow-2xl min-h-full sm:min-h-0 sm:my-6 overflow-hidden"
      >
        <div className="sticky top-0 overlay-safe-top bg-[#0F172A]/95 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => sessao && onAbrirPerfil(sessao.authorId)}
            className="flex items-center gap-2.5 min-w-0 text-left disabled:pointer-events-none"
            disabled={!sessao}
            aria-label={sessao ? `Ver perfil de ${sessao.authorName}` : undefined}
          >
            <div className="w-9 h-9 rounded-full bg-slate-800 ring-2 ring-cyan-400 overflow-hidden shrink-0 flex items-center justify-center">
              {sessao?.authorAvatarUrl ? (
                <img src={sessao.authorAvatarUrl} alt={sessao.authorName} className="w-full h-full object-cover" />
              ) : (
                <User size={16} className="text-slate-300" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="font-black text-sm text-white truncate leading-tight">
                {sessao ? sessao.authorName : 'Velejo'}
              </h2>
              {sessao && <p className="text-xs text-cyan-400 font-bold truncate">{sessao.spotName}</p>}
            </div>
          </button>

          <button
            type="button"
            ref={closeButtonRef}
            onClick={onClose}
            className="min-w-11 min-h-11 flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors shrink-0"
            aria-label="Fechar detalhe do velejo"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {carregandoSessao && (
          <div className="py-20 flex flex-col items-center gap-3 text-slate-400">
            <Loader2 size={28} className="animate-spin text-cyan-400" aria-hidden="true" />
            <p className="text-xs font-bold">Carregando velejo...</p>
          </div>
        )}

        {!carregandoSessao && erroSessao && !sessao && (
          <div className="p-8 text-center space-y-4">
            <AlertTriangle size={26} className="mx-auto text-rose-400" />
            <p role="alert" className="text-sm font-bold text-rose-300">
              {erroSessao}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-3 min-h-11 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 font-black text-xs"
            >
              Fechar
            </button>
          </div>
        )}

        {sessao && (
          <div className="max-h-[calc(100dvh-64px)] sm:max-h-[85vh] overflow-y-auto">
            {/* Mapa full-bleed: TrilhaMiniatura (SVG) sempre por baixo,
                CardSessaoFeedMapa (Leaflet) sempre montado por cima — é um
                único modal aberto por vez, não uma lista rolando, então não
                precisa do gate de IntersectionObserver de CardSessaoFeed.
                Sem trilha, não desenha mapa nenhum aqui. */}
            {temTrilha && (
              <div className="relative h-72 sm:h-96 bg-black overflow-hidden">
                <TrilhaMiniatura trilha={sessao.trilhaReduzida!} className="absolute inset-0 w-full h-full" />
                <div className="absolute inset-0">
                  <CardSessaoFeedMapa trilha={sessao.trilhaReduzida!} />
                </div>
              </div>
            )}

            {/* Curtir + comentar (contagem), acima da grade de estatísticas —
                mesma linguagem visual do rodapé do card do feed. */}
            <div className="px-4 py-3 flex items-center gap-4 border-b border-slate-800">
              <button
                type="button"
                onClick={handleCurtir}
                aria-pressed={curtido}
                className={`flex items-center gap-1.5 text-xs font-black transition-all active:scale-125 min-h-11 ${
                  curtido
                    ? 'text-rose-500 drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]'
                    : 'text-slate-400 hover:text-rose-400'
                }`}
              >
                <Heart size={18} className={curtido ? 'fill-current' : ''} />
                <span>{contagemCurtidas}</span>
              </button>
              <span className="flex items-center gap-1.5 text-xs font-black text-slate-400">
                <MessageCircle size={18} />
                <span>{comentarios.length}</span>
              </span>
              <span className="ml-auto px-3 py-1 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-[11px] font-black truncate max-w-[50%]">
                {sessao.discipline}
              </span>
            </div>

            {/* Grade completa de estatísticas — o card do feed só mostra 4;
                aqui mostra tudo que SessionDetail carrega. Altura de salto
                SEMPRE rotulada como manual, nunca ao lado dos outros números
                como se fosse medido do mesmo jeito (mesmo cuidado de
                CardSessaoFeed.tsx: GPS de celular não mede salto). */}
            <div className="grid grid-cols-3 gap-3 px-4 py-4 border-b border-slate-800">
              <EstatisticaCard icone={<Route size={14} className="text-cyan-400" />} rotulo="Distância">
                {sessao.distanceKm !== undefined ? `${sessao.distanceKm.toFixed(1)}km` : '—'}
              </EstatisticaCard>
              <EstatisticaCard icone={<Gauge size={14} className="text-amber-400" />} rotulo="Vel. máx">
                {sessao.maxSpeedKnots !== undefined ? `${sessao.maxSpeedKnots.toFixed(1)}nós` : '—'}
              </EstatisticaCard>
              <EstatisticaCard icone={<Clock size={14} className="text-slate-300" />} rotulo="Duração">
                {formatarDuracao(sessao.durationMinutes)}
              </EstatisticaCard>
              <EstatisticaCard icone={<Wind size={14} className="text-emerald-400" />} rotulo="Vento médio">
                {sessao.avgWindKnots}nós
              </EstatisticaCard>
              <EstatisticaCard icone={<Zap size={14} className="text-yellow-400" />} rotulo="Rajada máx">
                {sessao.maxGustKnots !== undefined ? `${sessao.maxGustKnots}nós` : '—'}
              </EstatisticaCard>
              {sessao.highestJumpM !== undefined && (
                <EstatisticaCard icone={<ArrowUpToLine size={14} className="text-fuchsia-400" />} rotulo="Salto (manual)">
                  {sessao.highestJumpM}m
                </EstatisticaCard>
              )}
              <EstatisticaCard icone={<Compass size={14} className="text-sky-400" />} rotulo="Direção do vento">
                {sessao.windDirection || '—'}
              </EstatisticaCard>
              <EstatisticaCard icone={<Waves size={14} className="text-blue-400" />} rotulo="Maré">
                {sessao.tideCondition || '—'}
              </EstatisticaCard>
              <EstatisticaCard icone={<Droplet size={14} className="text-cyan-300" />} rotulo="Água">
                {sessao.waterCondition || '—'}
              </EstatisticaCard>
              <EstatisticaCard icone={<Wind size={14} className="text-teal-400" />} rotulo="Tamanho da pipa">
                {sessao.kiteSizeM2}m²
              </EstatisticaCard>
              {sessao.boardModel && (
                <EstatisticaCard icone={<Layers size={14} className="text-orange-400" />} rotulo="Prancha">
                  {sessao.boardModel}
                </EstatisticaCard>
              )}
              <EstatisticaCard icone={<Star size={14} className="text-amber-300" />} rotulo="Nota">
                {'★'.repeat(sessao.rating)}
                {'☆'.repeat(Math.max(0, 5 - sessao.rating))}
              </EstatisticaCard>
            </div>

            {sessao.notes && (
              <div className="px-4 py-4 border-b border-slate-800">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-1.5">Notas</h3>
                <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{sessao.notes}</p>
              </div>
            )}

            {sessao.photoUrl && (
              <div className="px-4 py-4 border-b border-slate-800">
                <img src={sessao.photoUrl} alt="Foto da sessão" className="w-full rounded-xl object-cover max-h-96" />
              </div>
            )}

            {/* Comentários — Fase 5: a Fase 3 tinha deixado só a contagem. */}
            <div className="px-4 py-4 space-y-3">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider">Comentários</h3>

              {carregandoComentarios && comentarios.length === 0 && (
                <div className="py-4 flex justify-center text-slate-500">
                  <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                </div>
              )}

              {!carregandoComentarios && comentarios.length === 0 && (
                <p className="text-xs text-slate-500 py-2">Nenhum comentário ainda. Seja o primeiro.</p>
              )}

              <ul className="space-y-4">
                {comentariosDePrimeiroNivel.map((c) => {
                  const respostas = respostasPorPai.get(c.id) ?? [];
                  return (
                    <li key={c.id} className="space-y-2.5">
                      <ComentarioItem
                        comentario={c}
                        podeApagar={podeApagar(c.userId)}
                        onApagar={() => handleApagarComentario(c.id)}
                        // Comentário que JÁ É resposta não mostra "Responder"
                        // (reforça no cliente a regra de 1 nível que a rota
                        // já reforça no servidor).
                        onResponder={() => handleAbrirResposta(c.id)}
                        respondendoAberto={respondendoParaId === c.id}
                      />

                      {respostas.map((r) => (
                        <div key={r.id} className="ml-8">
                          <ComentarioItem
                            comentario={r}
                            podeApagar={podeApagar(r.userId)}
                            onApagar={() => handleApagarComentario(r.id)}
                          />
                        </div>
                      ))}

                      {respondendoParaId === c.id && (
                        <div className="ml-8 flex items-center gap-2">
                          {erroResposta && (
                            <p className="text-[11px] text-rose-400 w-full">{erroResposta}</p>
                          )}
                          <input
                            type="text"
                            value={textoResposta}
                            onChange={(e) => setTextoResposta(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleEnviarResposta(c.id);
                            }}
                            placeholder={`Responder a ${c.userName}...`}
                            maxLength={1000}
                            autoFocus
                            className="flex-1 min-w-0 h-10 px-3 rounded-xl bg-slate-800/80 border border-slate-700 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
                          />
                          <button
                            type="button"
                            onClick={() => handleEnviarResposta(c.id)}
                            disabled={!textoResposta.trim() || enviandoResposta}
                            className="w-10 h-10 shrink-0 flex items-center justify-center rounded-xl bg-cyan-500 text-slate-950 disabled:opacity-40 disabled:pointer-events-none active:scale-95 transition-transform"
                            aria-label="Enviar resposta"
                          >
                            {enviandoResposta ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Send size={14} />
                            )}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}

        {/* Campo de comentário — dentro do próprio modal, no rodapé. Só faz
            sentido com a sessão carregada (precisa do sessionId de verdade). */}
        {sessao && (
          <div className="sticky bottom-0 bg-[#0F172A]/95 backdrop-blur border-t border-slate-800 p-3 space-y-1.5">
            {erroComentario && <p className="text-[11px] text-rose-400 px-1">{erroComentario}</p>}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={textoComentario}
                onChange={(e) => setTextoComentario(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleEnviarComentario();
                }}
                placeholder="Escreva um comentário..."
                maxLength={1000}
                className="flex-1 min-w-0 h-11 px-3.5 rounded-xl bg-slate-800/80 border border-slate-700 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
              />
              <button
                type="button"
                onClick={handleEnviarComentario}
                disabled={!textoComentario.trim() || enviandoComentario}
                className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl bg-cyan-500 text-slate-950 disabled:opacity-40 disabled:pointer-events-none active:scale-95 transition-transform"
                aria-label="Enviar comentário"
              >
                {enviandoComentario ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Send size={16} />
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
