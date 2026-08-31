'use client';

import { useState } from 'react';

/**
 * Roda um ajuste de estado quando um valor muda — DURANTE O RENDER, não num
 * efeito.
 *
 * POR QUE ISTO EXISTE
 *
 * O padrão que este hook substitui aparecia dezenas de vezes na base:
 *
 *     useEffect(() => {
 *       setAlgo(null);        // limpa o estado velho
 *       setCarregando(true);  // prepara o novo
 *     }, [id]);
 *
 * Parece inofensivo e é o que quase todo mundo escreve, mas tem um custo real:
 * o React **pinta um quadro inteiro com o estado obsoleto** antes de rodar o
 * efeito e pintar de novo com o estado limpo. Na prática o usuário vê, por um
 * frame, o perfil da pessoa anterior dentro do modal que acabou de abrir para
 * outra. É a "cascata de renders" que a regra `react-hooks/set-state-in-effect`
 * do React 19 acusa.
 *
 * Ajustando durante o render, o React descarta o render em andamento e refaz
 * com o valor certo antes de tocar na tela — o quadro intermediário nunca
 * chega a existir. É o padrão que a documentação do React recomenda
 * explicitamente para "estado que precisa mudar quando uma prop muda".
 *
 * QUANDO NÃO USAR: se o ajuste envolve I/O (buscar dados, ler o disco, medir o
 * DOM), isso continua sendo trabalho de `useEffect`. Este hook é só para o
 * ajuste SÍNCRONO de estado que costumava vir junto — tipicamente a limpeza do
 * que estava na tela e o "começou a carregar".
 *
 * Comparação com `Object.is`, igual ao React: `NaN` não dispara mudança
 * consigo mesmo, e `0`/`-0` são tratados como valores diferentes.
 */
/**
 * Sentinela de "ainda não rodou", no escopo do módulo e não num `useRef`:
 * ler `ref.current` durante o render é exatamente o que a regra
 * `react-hooks/refs` do React 19 proíbe — e este hook roda no render.
 */
const NUNCA_RODOU = Symbol('useAoMudar/nunca-rodou');

export function useAoMudar<T>(
  valor: T,
  ajustar: (anterior: T) => void,
  opcoes?: {
    /**
     * Rodar também no primeiro render, não só quando o valor muda.
     *
     * O padrão é `false` porque "ajustar quando muda" não deveria disparar na
     * montagem: ali o estado já é o que o inicializador do `useState` definiu.
     *
     * Vale `true` quando o que se está fazendo não é ajustar, e sim
     * INICIALIZAR a partir de algo externo e síncrono — `Notification.permission`,
     * `matchMedia`, um valor de contexto que já existe quando o componente
     * monta. Sem isto, um `useEffect(..., [dep])` convertido às cegas para este
     * hook deixaria de rodar na montagem, e o estado nunca receberia o valor
     * inicial. (Foi um erro cometido e pego antes de subir.)
     */
    naMontagem?: boolean;
  }
): void {
  const [anterior, setAnterior] = useState<T | typeof NUNCA_RODOU>(
    opcoes?.naMontagem ? NUNCA_RODOU : valor
  );

  if (!Object.is(anterior, valor)) {
    setAnterior(valor);
    ajustar(anterior === NUNCA_RODOU ? valor : (anterior as T));
  }
}
