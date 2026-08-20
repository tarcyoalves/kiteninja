# Postmortem — Tarja escura no rodapé (iOS, PWA instalado)

Status: **resolvido em 20/08/2026, commit `212a2ea`.** Este documento existe para
que, se o sintoma voltar, quem investigar não repita as sete tentativas
anteriores. Leia a seção "Se isto voltar" primeiro.

---

## Se isto voltar: comece aqui

```bash
curl -s https://kiteninja.vercel.app/ | grep -o 'apple-mobile-web-app-capable[^/]*/'
```

Se isso **não** retornar nada, é a causa raiz descrita abaixo, de volta —
alguém removeu ou quebrou a tag. Corrija e pare por aqui.

Se retornar normalmente, a causa é outra. **Não comece pelo CSS.** Sete
tentativas nesta mesma investigação corrigiram bugs reais de CSS/geometria/cor
sem eliminar o sintoma — porque a causa real nunca esteve lá. Antes de editar
`globals.css`, `BottomNav.tsx` ou qualquer componente de tela cheia, peça ao
usuário os números do diagnóstico em `components/DiagTela.tsx` (menu do
avatar, só admin vê): `innerHeight`, `visualViewport`, e os quatro insets de
safe-area. E peça uma foto da tela — a cor exata da faixa (preto puro? um tom
de azul-marinho?) diz muito sobre qual mecanismo é.

---

## O sintoma

Uma faixa escura aparecia no rodapé do app instalado na tela de início do
iPhone (PWA), embaixo do menu flutuante. Relatado várias vezes ao longo do
projeto, "resolvido" e reaparecendo.

## A causa real

Faltava a meta tag `apple-mobile-web-app-capable`.

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

## A lição, para além dos detalhes técnicos

Depois de duas ou três correções **verificadas e corretas** na mesma família
de hipótese (aqui: CSS, cor, geometria) sem o sintoma mudar no dispositivo
real, a causa provavelmente está **fora** dessa categoria — continuar
refinando a mesma hipótese é o erro, não a falta de mais um ajuste.

"O PWA não está abrindo em modo standalone" é candidato sério para qualquer
bug visual em iOS que sobreviva a correções de CSS, porque por definição está
fora do alcance delas. Vale checar isso **cedo**, não como último recurso,
quando o sintoma for "uma faixa/barra que não vai embora" num app instalado
via tela de início.
