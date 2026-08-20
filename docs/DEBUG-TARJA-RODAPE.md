# Postmortem — Tarja escura no rodapé (iOS, PWA instalado)

Status: **resolvido em 20/08/2026, commit `f9a94f6`.** Oito tentativas até
achar a causa. Este documento existe para que ninguém repita as sete erradas.
Leia a seção "Se isto voltar" primeiro.

---

## Se isto voltar: comece aqui

**Não edite CSS.** Peça ao dono (admin) o texto do diagnóstico em
`components/DiagTela.tsx` — avatar → "Diagnóstico de tela" → botão "copiar".
Compare estas três linhas:

```
screen: <largura> x <ALTURA>
innerHeight: <ALTURA DA JANELA>
SOBRA DESCOBERTA EMBAIXO: <N>px
```

Se `SOBRA DESCOBERTA EMBAIXO` for maior que zero, **o app está recebendo uma
janela menor que a tela** e a faixa está FORA da página — nenhuma regra de CSS
pode alcançá-la. Vá direto para "A causa real" abaixo. Se for `0px`, aí sim a
faixa está dentro da página e vale investigar cor/geometria (o histórico
completo dessas investigações está mais abaixo).

---

## O sintoma

Uma faixa escura aparecia no rodapé do app instalado na tela de início do
iPhone (PWA), embaixo do menu flutuante. Relatada várias vezes ao longo do
projeto, "resolvida" e reaparecendo.

## A causa real: `black-translucent` encolhe a janela

`apple-mobile-web-app-status-bar-style: black-translucent` deveria dar ao app
a tela inteira, com o conteúdo passando por baixo da barra de status. O que o
iOS faz de fato é dimensionar a janela como *tela menos a altura da barra de
status*, mas posicioná-la em `y = 0` — então a diferença sobra como uma faixa
no rodapé, fora da viewport.

Medido no aparelho do dono (iPhone 16 Pro Max) com o `DiagTela`:

```
screen.height ............ 956px
window.innerHeight ....... 894px
window.screenY ........... 0     (janela colada no topo)
safe-area-inset-top ...... 62px
sobra descoberta embaixo . 62px  <- a tarja
```

A sobra bate **ao pixel** com o `safe-area-inset-top`. Essa igualdade é a
assinatura do bug — se você vir isso de novo, é isto.

E é por isso que nada antes funcionou: aqueles 62px estão **fora da página**.
Nenhuma cor de fundo, token, padding ou reserva de rodapé podia alcançá-los.
Todas as sete correções anteriores agiam dentro da viewport — consertando o
quadro quando o problema era o tamanho da moldura.

### A correção

`app/layout.tsx`, em `metadata.appleWebApp`:

```ts
statusBarStyle: "black",   // NÃO volte para "black-translucent"
```

Com `black`, o iOS dimensiona **e** posiciona a janela corretamente: ela começa
abaixo da barra de status e termina na base da tela. Não se perde área útil — a
janela já era 894px de qualquer forma —, só deixa de sobrar tela descoberta. A
barra de status fica opaca, e contra o `--app-bg` (#0F172A, azul-marinho quase
preto) a diferença é imperceptível; o `themeColor` declara essa mesma cor.

---

## Uma causa anterior, também real (commit `212a2ea`)

Antes de chegar no `black-translucent`, foi corrigida a **falta da meta tag
`apple-mobile-web-app-capable`** — um problema legítimo e independente, que
vale manter corrigido. Verificação:

```bash
curl -s https://kiteninja.vercel.app/ | grep -o 'apple-mobile-web-app-capable[^/]*/'
```

Se não retornar nada, alguém removeu a tag e o problema abaixo volta:

O Next.js 16.3.1, com `appleWebApp: { capable: true }` no `metadata` de
`app/layout.tsx`, emite **apenas** a tag padrão `mobile-web-app-capable` —
nunca a legada `apple-mobile-web-app-capable`. Confirmado lendo a fonte
instalada: `node_modules/next/dist/lib/metadata/metadata.js:603-606`.

```js
const { capable, title, startupImage, statusBarStyle } = metadata.appleWebApp;
if (capable) {
  // ... name: "mobile-web-app-capable" ...
}
```

O WebKit só passou a **honrar** a tag padrão a partir do **iOS 17.4**. Em
qualquer iPhone com iOS anterior, sem a tag legada, o Safari não sabe que deve
abrir o ícone da tela de início em modo *standalone* (tela cheia, sem chrome
de navegador) — ele abre como uma **aba comum do Safari**, com a barra de
ferramentas do próprio navegador embaixo.

Essa barra fica **fora da página renderizada pelo app**. Nenhum CSS, nenhum
token de cor, nenhuma correção de `padding-bottom` jamais poderia alcançá-la —
ela não é HTML do KiteNinja, é interface do Safari.

### A correção

`app/layout.tsx`, dentro do objeto `metadata`:

```ts
appleWebApp: {
  capable: true,
  title: "KiteNinja",
  statusBarStyle: "black-translucent",
},
other: {
  "apple-mobile-web-app-capable": "yes",
},
```

A API tipada do `Metadata` do Next não expõe essa tag — `other` é o escape
hatch documentado para meta tags arbitrárias que a API não cobre.

### Por que reinstalar o app pode não bastar para testar

Um PWA instalado que já abre em modo "aba comum" continua abrindo pela mesma
aba/sessão do Safari até o ícone ser **removido e recriado de verdade**:
Tocar e segurar o ícone → Remover App → abrir `kiteninja.vercel.app` no
Safari → Compartilhar → Adicionar à Tela de Início → abrir pelo ícone novo.
Só fechar e reabrir, ou até fazer swipe-up para matar o processo, pode não
disparar uma nova leitura da tag.

---

## Timeline completa — o que cada commit corrigiu (e por que não bastou)

Todos na mesma sessão de trabalho, 20/08/2026, nesta ordem:

### 1. `a4ae216` — `--nav-h` não recalculava em todo evento de viewport

`--nav-h` (distância do rodapé ao topo do menu flutuante) era medido em
JavaScript (`window.innerHeight - wrapper.getBoundingClientRect().top`,
publicado via `style.setProperty`), e só era republicado por um
`ResizeObserver` no próprio elemento do menu. `ResizeObserver` dispara quando
o **elemento** muda de tamanho — não quando a **viewport** muda com o
elemento do mesmo tamanho (barra do Safari aparecendo/sumindo ao rolar,
rotação, overlay de tela cheia entrando/saindo). O valor ficava congelado.
Corrigido republicando também em `resize`, `orientationchange` e eventos de
`visualViewport`.

**Por que não bastou:** tratava mais um evento faltando, não a causa
arquitetural — sempre haveria algum evento não coberto.

### 2. `da703ab` — eliminação do JavaScript

A pílula do menu tem altura fixa (`h-[58px]`) e o wrapper tem offset fixo
(`bottom-1.5` = 6px); a única parte variável, `env(safe-area-inset-bottom)`,
o próprio navegador já recalcula a cada repaint. `--nav-h` virou CSS puro:
`calc(var(--bottom-nav-height) + env(safe-area-inset-bottom, 0.5rem))`. As 85
linhas de medição em `components/BottomNav.tsx` foram removidas.

**Por que não bastou:** eliminou a *desatualização* de `--nav-h`, mas não era
essa a causa do sintoma que persistia.

### 3. `242ddac` — cinco fórmulas divergentes de rodapé, uma fonte única

Conviviam cinco fórmulas independentes para "quanto o menu ocupa" (`.app-scroll`,
`.map-card-bottom`, `.pb-above-nav`, `.publish-fab-bottom`, `.feed-pad-bottom`),
algumas somando `env(safe-area-inset-bottom)` **depois** de `var(--nav-h)` — que
já continha o inset —, contando a safe-area em dobro. Unificado numa cadeia
única: `--nav-pill-h`/`--nav-pill-gap` → `--nav-h` → tudo deriva de `--nav-h`,
e `--safe-b` é o único ponto do arquivo autorizado a ler
`env(safe-area-inset-bottom)`. Travado por `app/globals.layout.test.ts`.

**Por que não bastou:** geometria correta não resolve uma cor errada nem uma
barra de navegador que está fora da página.

### 4. `e53cada` — cor de fundo divergente entre shell e body

A cor de fundo estava duplicada em quatro lugares com três valores. `app/page.tsx`
pintava o shell com `bg-[#0F172A]` (utility do Tailwind, que **vence**
`background-color` declarado em `@layer base` por não estar na mesma camada da
cascata), enquanto `body` continuava `#0B1220`. `body` é o canvas que o iOS
mostra em qualquer sobra fora do elemento `fixed`, com `viewport-fit=cover` e
status bar translúcida — shell e body em tons distintos = faixa visível, mesmo
com a geometria perfeita. Unificado num token `--app-bg` em `:root`.

**Por que não bastou:** o commit corrigiu o *shell*, mas o mesmo padrão
"utility vence `@layer base`" também estava presente no `<body>` do
`layout.tsx` — e não foi pego nesta rodada.

### 5. `d0c0524` — o mesmo bug de utility-vence-@layer, agora no `<body>`

`app/layout.tsx:81` aplicava `bg-[#0B1220]` direto no `<body>` via utility do
Tailwind. Mesmo mecanismo do item anterior: vencia `background-color:
var(--app-bg)`. O teste escrito no commit `e53cada` só verificava
`page.tsx` e passava com o bug presente — foi corrigido para cobrir também
`layout.tsx`, e o defeito foi reinjetado deliberadamente para confirmar que o
teste o pega antes de confiar nele.

**Por que não bastou:** ainda sobravam outras telas de tela cheia com o
mesmo padrão de cor antiga.

### 6. `98c7621` — placeholder pré-hidratação, LoginGate e SplashIntro

Três telas de altura cheia ainda usavam a cor antiga **e** `min-h-screen`
(equivalente a `100vh`, que no iOS inclui/exclui a faixa do indicador de home
de forma inconsistente — a mesma conta proibida documentada em `globals.css`
desde o começo desta investigação): o placeholder que `page.tsx` mostra antes
da hidratação (o primeiro pixel que o app instalado desenha), `LoginGate.tsx`
(a tela de login, o app "fechado") e `SplashIntro.tsx` (vídeo/animação de
abertura). Corrigidas para usar `bg-[var(--app-bg)]` e `flex-1`. Confirmado em
produção via `curl`: zero hex de fundo antigo, zero `min-h-screen` no HTML
servido.

**Por que não bastou:** a essa altura o CSS estava genuinamente correto —
verificado linha por linha, verificado no HTML real de produção — e o dono
reinstalou o app do zero e reportou o mesmo sintoma. Esse foi o sinal de
virada: a causa nunca esteve em CSS.

### 7. `212a2ea` — a causa real

Ver seção acima. Também aproveitado para trocar `bg-black` por
`bg-[var(--app-bg)]` no wrapper de `SplashVideo` (`components/SplashIntro.tsx`)
— mesma classe de divergência de cor, só que nova: o vídeo/poster cobrem a
tela via `object-fit: cover` na maior parte do tempo, então só ficava visível
nos ~350ms de fade de entrada/saída.

---

### 8. `f9a94f6` — a causa real

`black-translucent` trocado por `black`. Ver "A causa real" no topo deste
documento.

O que destravou: em vez de tentar a oitava correção às cegas, o `DiagTela`
(`components/DiagTela.tsx`) foi instrumentado para medir o que o aparelho
entrega de fato — `screen.height` vs `innerHeight` vs `screenY` — e o dono
mandou o texto. O número apareceu na primeira leitura. **Sete tentativas de
adivinhação custaram mais do que uma rodada de medição.**

---

## A lição, para além dos detalhes técnicos

**1. Meça antes da terceira tentativa.** Depois de duas correções
*verificadas e corretas* sem o sintoma mudar no dispositivo real, pare de
editar. O custo de instrumentar (aqui: ~40 linhas no `DiagTela` e uma rodada
de ida e volta) é muito menor que o de mais cinco correções erradas, cada uma
publicada, testada pelo dono e desmentida.

**2. Quando o sintoma sobrevive a correções corretas, a causa está fora da
categoria.** Aqui foram sete correções dentro da página (cor, geometria,
tokens, meta tags) para um problema que estava fora dela — numa área da tela
que o app sequer recebia. Continuar refinando a mesma hipótese é o erro, não
a falta de mais um ajuste.

**3. Em bug visual de PWA no iOS, desconfie cedo do tamanho da janela.**
`screen.height != window.innerHeight` num app standalone significa que existe
tela que a página não ocupa — e por definição nenhum CSS alcança essa área.
Verificar isso é uma linha de JavaScript e deveria vir antes de qualquer
investigação de layout, não depois de sete.
