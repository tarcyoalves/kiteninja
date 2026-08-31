'use client';

import { useCallback, useState } from 'react';

/**
 * Curtida otimista de uma sessão (seção 3 do plano de rede social): pinta no
 * toque, a requisição vai atrás; se falhar, reverte. Extraído de
 * `CardSessaoFeed.tsx` porque `SessionDetailModal.tsx` (Fase 5) precisa da
 * MESMA lógica — 2 consumidores é o limiar em que duplicar deixa de valer a
 * pena.
 */
export function useCurtidaOtimista(
  sessionId: string,
  euCurtiServidor: boolean,
  curtidasServidor: number
) {
  // `null` = "sem override local", mostra o que veio do servidor — é o
  // estado normal. Um objeto aqui é a exceção: só existe enquanto o toque
  // local diverge do que o servidor tem (durante a requisição, ou depois
  // dela, até o próximo fetch trazer a verdade do servidor de novo).
  const [otimista, setOtimista] = useState<{ curtido: boolean; contagem: number } | null>(null);

  /*
   * Sempre que uma nova verdade do servidor chega para ESTA sessão (feed
   * recarregado por pull-to-refresh, por exemplo), o override local perde a
   * validade — sem isto, um pull-to-refresh que trouxesse curtidas de OUTRAS
   * pessoas continuaria escondido atrás do valor otimista antigo para sempre.
   *
   * Ajuste DURANTE O RENDER, não num efeito. É o padrão que a própria
   * documentação do React recomenda para "estado que precisa mudar quando uma
   * prop muda": guardar o valor anterior e comparar. Com `useEffect` o React
   * pintava um quadro com o valor otimista obsoleto antes de corrigir —
   * cascata de render que a regra react-hooks/set-state-in-effect acusa. Aqui
   * o React descarta o render em andamento e refaz com o valor certo, sem
   * nunca mostrar o intermediário.
   */
  const [servidorAnterior, setServidorAnterior] = useState({
    euCurti: euCurtiServidor,
    curtidas: curtidasServidor,
  });
  if (
    servidorAnterior.euCurti !== euCurtiServidor ||
    servidorAnterior.curtidas !== curtidasServidor
  ) {
    setServidorAnterior({ euCurti: euCurtiServidor, curtidas: curtidasServidor });
    setOtimista(null);
  }

  const curtido = otimista ? otimista.curtido : euCurtiServidor;
  const contagem = otimista ? otimista.contagem : curtidasServidor;

  const alternar = useCallback(() => {
    const proximoCurtido = !curtido;
    const proximaContagem = Math.max(0, contagem + (proximoCurtido ? 1 : -1));
    setOtimista({ curtido: proximoCurtido, contagem: proximaContagem });

    fetch(`/api/sessions/${sessionId}/like`, { method: proximoCurtido ? 'POST' : 'DELETE' })
      .then((res) => {
        if (!res.ok) throw new Error('curtida falhou');
        return res.json() as Promise<{ count: number }>;
      })
      .then((body) => setOtimista({ curtido: proximoCurtido, contagem: body.count }))
      .catch(() => {
        // Reverte: some o override e volta a mostrar o que o servidor tinha
        // antes do toque — nunca deixa a UI presa num estado que a
        // requisição não confirmou.
        setOtimista(null);
      });
  }, [curtido, contagem, sessionId]);

  return { curtido, contagem, alternar };
}
