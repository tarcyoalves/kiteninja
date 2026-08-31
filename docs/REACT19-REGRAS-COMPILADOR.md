# React 19 — zerando os erros do compilador

**Estado: 0 erros de lint** (`npx eslint .` → 157 warnings, 0 errors).
Ponto de partida: **50 erros**, distribuídos por 20 arquivos.

Este documento existe porque a maior parte desses 50 erros **não era ruído de
lint**. Eram bugs visíveis, de classes que ninguém tinha nomeado ainda nesta
base. O objetivo aqui é que a próxima pessoa (ou o próximo agente) reconheça o
padrão antes de escrever o mesmo defeito de novo.

---

## As quatro regras que dispararam, e o que cada uma pegava de verdade

### 1. `react-hooks/set-state-in-effect` — 39 dos 50 erros

O padrão acusado:

```ts
useEffect(() => {
  setAlgo(null);        // limpa o que estava na tela
  setCarregando(true);  // prepara o novo
}, [id]);
```

**O que o usuário via.** O React pinta um quadro inteiro com o estado
obsoleto ANTES de rodar o efeito e pintar de novo. Casos reais encontrados:

| Onde | O quadro errado que aparecia |
|---|---|
| `views/ChatView.tsx` | Trocar de sala mostrava, por um frame, as mensagens da sala anterior dentro da sala nova |
| `lib/useTrilhaSessao.ts` | Reabrir o Modo Navegação pintava a distância e a velocidade máxima da sessão **anterior** antes de zerar |
| `components/downwind/DownwindLiveReplayViewer.tsx` | O slider de tempo aparecia na posição antiga antes de pular para o fim da trilha |
| `views/MapView.tsx` | O mapa pintava um quadro sem spot nenhum antes do efeito "conserta depois" rodar |
| `app/page.tsx` | Um SOS ativo — a tela mais urgente do app — pintava um quadro sem o painel antes de abri-lo |
| `components/SpotDetailModal.tsx` | Quem pediu `prefers-reduced-motion` via a animação **começar** e ser cortada |

**A correção, sempre a mesma.** O ajuste síncrono de estado pertence ao
render, não a um efeito. `lib/useAoMudar.ts` faz exatamente isso: compara o
valor com o do render anterior e, se mudou, chama o ajuste ali mesmo. O React
descarta o render em andamento e refaz antes de tocar na tela — o quadro
intermediário nunca chega a existir.

```ts
useAoMudar(room, () => {
  setLoading(true);
  setError(null);
});
```

**A armadilha do `useAoMudar`:** ele **não roda na montagem** por padrão, e
converter um `useEffect(..., [dep])` às cegas quebra silenciosamente (o
estado nunca recebe o valor inicial). Para os casos em que a intenção é
INICIALIZAR a partir de algo externo, existe `{ naMontagem: true }`. Este
erro foi cometido e pego antes de subir — está documentado no próprio hook.

**A outra armadilha: a chave.** `useAoMudar` compara com `Object.is`. Passar
um objeto que o pai recria a cada render dispara o ajuste **todo render** —
laço infinito. Por isso as chaves são sempre primitivas:

```ts
useAoMudar(myActiveSos?.id ?? null, ...)              // não o objeto do SOS
useAoMudar(`${valorInicial?.inicioSeg}|${duracao}`, ...) // não o objeto do trecho
```

Como efeito colateral, isso **corrigiu** um bug latente no `VideoTrimmer`: um
pai que passasse `valorInicial={{...}}` inline apagaria o trecho que o
velejador acabou de arrastar.

### 2. `react-hooks/purity` — leitura de relógio no render

`DownwindLiveReplayViewer` chamava `Date.now()` dentro de um `useMemo` para
o caso "não há trilha nenhuma". Dois renders do mesmo estado davam valores
diferentes — impureza. E o sintoma visível era a barra de tempo de um replay
**vazio** mostrando a hora atual. Passou a devolver `0`, que
`formatarHoraReplay` já tratava.

### 3. `react-hooks/static-components` — componente definido no render

`PermissoesOnboarding` definia `Item` dentro do corpo do componente. Isso cria
um **tipo novo** a cada render: o React desmonta e remonta a subárvore inteira
em vez de atualizá-la. Aqui, apagava a animação de "concedido" toda vez que o
pai renderizasse. Correção: mover para o escopo do módulo.

### 4. `react-hooks/refs` — ref lido/escrito durante o render

Dois formatos:

- **Escrita direta no corpo do componente** (`spotsRef.current = spots;`) —
  em `WindParticleLayer`, `SplashIntro`, `useTrilhaSessao`. Foi para efeito.
- **Fábrica curried chamada no JSX.** `VideoTrimmer` tinha
  `onPointerDown={iniciarArraste('inicio')}`. A função É invocada durante o
  render, e ela escreve num ref — o compilador acusa nos três pontos de uso.
  Correção: o modo virou argumento (`(e) => iniciarArraste('inicio', e)`), e
  o que vai para o JSX é um arrow que só roda no evento.

Caso relacionado, em `ConvidadoView`: o retorno inteiro de
`useSplitArrastavel()` era tratado como ref pelo compilador, e **cada acesso a
propriedade** durante o render virava erro. Bastou desestruturar.

### 5. `react-hooks/rules-of-hooks` — um bug de verdade

`app/page.tsx` tinha `spots={useKiteData().spots}` dentro de um bloco
condicional do JSX (`{tokenConviteUrl && (...)}`). Um hook chamado
condicionalmente — a ordem dos hooks mudava conforme o modal de convite
estivesse ou não na tela. `spots` já vinha desestruturado no topo do
componente; a chamada extra era acidental.

---

## O padrão novo: `useSyncExternalStore` para o que só o navegador sabe

Três lugares liam `navigator`/`matchMedia` num efeito e chamavam `setState`.
Além do erro de lint, isso garante que **o primeiro quadro sempre sai com o
valor errado**.

`useSyncExternalStore` é a API que o React dá exatamente para isso: um valor
que vive fora do React, tem snapshot diferente no servidor e no cliente, e
muda por evento.

- `lib/usePrefereMenosMovimento.ts` — `prefers-reduced-motion`.
- `components/PermissoesOnboarding.tsx` — o ambiente iOS/instalado, com a
  decisão isolada em `lib/instalacaoIos.ts` (pura e testada, seguindo a
  convenção da base: *a regra que pode estar errada mora numa função pura*).

**Regra do `getSnapshot`:** tem que devolver SEMPRE o mesmo objeto enquanto
nada mudou, senão o React entra em laço de render. Por isso o snapshot do
ambiente é cacheado no escopo do módulo e o do servidor é uma constante.

**Regra do snapshot do servidor:** devolve o valor da MAIORIA. `false` para
`prefers-reduced-motion`, `false` para "é iPhone" — assim a hidratação bate
para quase todo mundo, e quem diverge vê o ajuste no primeiro quadro do
cliente em vez de um erro de hidratação.

---

## Os `eslint-disable` que sobraram, e por quê

São **cinco**, cada um verificado à mão, e cada um diz no comentário o que
voltaria a torná-lo um erro de verdade. Duas categorias:

**(a) Falso positivo: função `async` sem setState antes do primeiro `await`.**
O lint vê `buscarSala(room)` dentro do efeito, não consegue entrar na função,
e acusa. Mas todo setState dela acontece num microtask, depois do commit —
não há cascata. É o caso de `buscarSala`, `buscarDms`, `loadOnline` e
`buscarPagina`. *Vira erro de verdade no dia em que alguém puser um setState
na primeira linha dessas funções* — e o comentário diz isso.

Para tornar isso verificável, a separação é explícita: a função `async` fica
**só com o I/O**, e o "começou a carregar" mora em outro lugar — no
`useAoMudar` (troca de sala, troca de aba) ou no handler do clique (botão
"tentar novamente", onde setState síncrono é justamente o certo).

**(b) Render extra real, aceito conscientemente.** Dois casos, os dois pela
mesma razão: o valor só existe no cliente, e lê-lo no render quebraria a
hidratação.

- `views/MapView.tsx` — `handleLocateUser()` na montagem marca
  `locateStatus = 'loading'`. A alternativa (nascer em `'loading'` via
  inicializador do `useState`) leria `navigator.geolocation` durante o render,
  que roda também no servidor.
- `app/page.tsx` — leitura de `?dw_invite=` da URL. `window.location` não
  existe no servidor; ler num inicializador daria divergência de hidratação
  justamente para quem chegou pelo link de convite. E o render extra só
  acontece quando o parâmetro está presente.

---

## O que isto NÃO cobre

Warnings continuam existindo (157), e a maioria é `@next/next/no-img-element`
e `react-hooks/exhaustive-deps` em lugares onde a dependência foi omitida de
propósito. Nenhum deles é erro; nenhum foi tocado aqui.

E vale repetir o que a varredura de 2026-08-31 já dizia: **lint verde não é
prova de nada**. A classe de defeito mais cara encontrada nesta base — estado
exposto em contexto e nunca consumido — passa em build, typecheck, teste E
lint. Foi encontrada três vezes.
