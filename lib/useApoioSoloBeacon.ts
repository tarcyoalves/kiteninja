'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { INTERVALO_ENVIO_APOIO_MS } from './apoioSolo';
import type { PontoTrilha } from './trilhaDownwind';

/**
 * Sobe a posição do velejo solo enquanto alguém está acompanhando.
 *
 * NÃO ABRE UM SEGUNDO GPS. Recebe o último ponto que `useTrilhaSessao` já
 * mediu — o `watchPosition` do Modo Navegação continua sendo um só. Isso
 * importa mais do que parece: o custo de bateria desta funcionalidade é
 * apenas o de uma requisição a cada 45s, não o de ligar o GPS de novo. Foi a
 * primeira pergunta feita antes de construir isto.
 *
 * NÃO ENVIA NADA quando `ativo` é falso, que é o estado de todo velejo solo
 * em que ninguém pediu o link (ver ACOMPANHAMENTO_NUNCA_LIGA_SOZINHO em
 * lib/apoioSolo.ts).
 *
 * PARA SOZINHO no 409. O servidor responde 409 quando não há sessão aberta —
 * porque o velejo foi encerrado em outro aparelho, ou porque as 12h venceram
 * no meio da água. Continuar tentando gastaria bateria e invocação para
 * gravar em lugar nenhum. `onEncerrado` deixa a tela saber, para não seguir
 * mostrando "transmitindo" quando não está mais.
 */
export function useApoioSoloBeacon(
  ativo: boolean,
  ultimoPonto: PontoTrilha | null,
  onEncerrado?: () => void
): void {
  /*
   * Refs para o ponto e o callback: o `setInterval` é criado uma vez por
   * ativação, e ler o ponto do closure congelaria o primeiro para sempre —
   * o app mandaria a mesma coordenada a cada 45s durante a travessia inteira.
   * É o mesmo stale closure que já mordeu `useDownwindPosicoes` (ver o
   * comentário de `pausadoRef` lá).
   */
  const pontoRef = useRef<PontoTrilha | null>(ultimoPonto);
  const onEncerradoRef = useRef(onEncerrado);
  // `useLayoutEffect` e não atribuição no corpo do render: escrever em ref
  // durante o render é impuro e o React 19 pode renderizar duas vezes — o lint
  // do React Compiler reprova. Mesmo padrão de `pausadoRef` em
  // lib/useDownwindPosicoes.ts, e roda antes de qualquer timer disparar.
  useLayoutEffect(() => {
    pontoRef.current = ultimoPonto;
    onEncerradoRef.current = onEncerrado;
  });

  /** Timestamp do último ponto ENVIADO, para não repetir posição parada. */
  const enviadoAteRef = useRef<number>(0);

  useEffect(() => {
    if (!ativo) return;
    let cancelado = false;

    const enviar = async () => {
      const ponto = pontoRef.current;
      if (!ponto) return;
      const [lat, lng, ts] = ponto;
      // Nada novo desde o último envio: o GPS não mediu nada ou a pessoa está
      // parada. Mandar de novo só gastaria invocação para gravar a mesma
      // coordenada — quem acompanha já a tem.
      if (ts <= enviadoAteRef.current) return;

      try {
        const res = await fetch('/api/velejo-apoio/posicoes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat, lng }),
          cache: 'no-store',
        });
        if (cancelado) return;
        if (res.status === 409) {
          onEncerradoRef.current?.();
          return;
        }
        if (res.ok) enviadoAteRef.current = ts;
      } catch {
        // Sem rede: o próximo tique tenta de novo com o ponto mais recente.
        // Não há fila aqui de propósito — diferente do beacon do downwind,
        // isto NÃO é segurança: é comodidade para quem está no carro, e uma
        // fila que sobe trinta pontos velhos de uma vez atrapalharia mais do
        // que ajudaria quem está tentando saber onde a pessoa está AGORA.
      }
    };

    enviar();
    const id = setInterval(enviar, INTERVALO_ENVIO_APOIO_MS);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, [ativo]);
}
