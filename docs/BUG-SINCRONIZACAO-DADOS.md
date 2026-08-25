# Bug — usuários vendo versões diferentes dos mesmos dados

Relato do dono (25/08/2026): *"apaguei dois downwinds que havia feito teste, e
criei um novo, porém o outro usuário não viu meu dw novo, apenas os dois
antigos, tipo ele ficou numa versão e eu em outra. Eu estava usando via PWA, e
ele no app nativo no Android."*

Parcialmente corrigido. O que falta está no fim.

## Não era "versão diferente do app"

Essa foi a primeira hipótese e ela está errada — vale registrar porque é a
conclusão intuitiva e leva a caçar o problema no lugar errado (build, deploy,
cache de bundle da Play Store).

Os dois estavam no mesmo código. O que estava velho era o **estado em memória**
do outro usuário: uma lista de eventos carregada em algum momento e nunca mais
atualizada.

## Causa 1 (principal) — nada revalidava mudança feita por outra pessoa

Downwinds aparecem para os outros através de `GET /api/events` (a linha em
`downwinds` é ligada ao evento por `event_id`). No cliente,
`loadFeedAndEvents()` do `KiteDataContext` era chamado em exatamente dois
tipos de momento:

1. ao logar / montar o provider;
2. logo depois de uma ação **do próprio usuário** (criou sessão, apagou
   evento, se inscreveu…).

Não havia **nada** disparado por mudança de terceiros: sem polling, sem
revalidação ao retomar o app, sem realtime. Quem estivesse com o app aberto
ficava congelado no snapshot de quando carregou — para sempre.

Contraste que deixa o buraco evidente: chat, DM, SOS e posição de downwind
**têm** poll de fundo. Feed, eventos, alertas e sessões **não tinham nada**.

O `DownwindContext` tinha o mesmo furo, e ali é pior: um downwind
**cancelado ou encerrado pelo organizador** continuava na tela do participante
como se estivesse rolando — segurando o Wake Lock e mandando posição para uma
travessia que já tinha acabado.

### Por que atingiu mais o app nativo que a PWA

No Android o processo do app fica vivo em memória por dias entre um uso e
outro. O estado velho sobrevive muito mais tempo. Numa aba de navegador é
comum a página ser recarregada em algum momento e "consertar" sozinha por
acidente — o que explica por que o dono (na PWA) via certo e o outro (no app)
via errado. O bug era dos dois; só se manifestava mais de um lado.

## Causa 2 (contribuinte) — nenhuma resposta de API dizia `no-store`

`handle()` em `lib/api.ts` devolvia `NextResponse.json(...)` sem
`Cache-Control` nenhum. Resposta sem diretiva de cache fica à mercê do cache
heurístico do navegador, e a WebView do Android é notoriamente mais agressiva
que o Chrome de desktop.

O cliente também não pedia `no-store`: o helper `api()` fazia `fetch` cru.
Detalhe revelador — os watchers de chat e DM **já passavam `cache: 'no-store'`
na mão**. Alguém topou com cache velho antes e resolveu no ponto, em vez de na
base.

Sozinha essa causa não explicaria o sintoma (que durou muito mais que
qualquer janela heurística), mas ela faz o refetch da Causa 1 poder voltar
com corpo velho — ou seja, atrapalharia a própria correção.

## O que foi corrigido

| Arquivo | Mudança |
|---|---|
| `lib/api.ts` | `Cache-Control: no-store, must-revalidate` em **toda** resposta de API, no envelope. |
| `context/KiteDataContext.tsx` | `cache: 'no-store'` no helper `api()`. |
| `context/DownwindContext.tsx` | idem. |
| `context/KiteDataContext.tsx` | Revalida feed/eventos/alertas/sessões ao voltar ao primeiro plano (`visibilitychange` + `focus`), com janela mínima de 30s. |
| `context/DownwindContext.tsx` | Revalida o downwind ativo ao voltar ao primeiro plano. |

O `no-store` fica no envelope, e não rota a rota, porque "esqueceram de pôr
no-store nessa rota nova" é o tipo de erro que não aparece em teste nenhum e
só se manifesta no aparelho de outra pessoa. `manifest.webmanifest` é o único
que quer cache de verdade e não passa por `handle()`.

### Por que revalidar na retomada, e não polling

O `visibilitychange` cobre o caso real — abrir o app e ver o que mudou — sem
somar mais uma requisição de fundo a cada X segundos. O projeto já paga poll
de chat, SOS e downwind, e `docs/ANTIGRAVITY-AUDIT-2026.md` (resposta 20)
aponta compute do Neon como maior custo. A janela de 30s evita rajada quando o
usuário alterna de app várias vezes seguidas.

## O que isso resolve e o que NÃO resolve

**Resolve:** o cenário relatado. O outro usuário, ao voltar para o app, passa
a ver a lista atualizada — sem precisar deslogar nem reinstalar.

**Não resolve:** os dois com o app **aberto ao mesmo tempo**, um criando e o
outro olhando a lista parada. Nesse caso a tela do segundo só atualiza quando
ele sair e voltar ao app. Para o downwind — em que combinar a travessia é o
ponto — isso ainda é pouco.

## Pendente — para decidir depois

Em ordem de custo/benefício:

1. **Puxar para baixo para atualizar** (pull-to-refresh) nas telas de lista.
   Barato, resolve o "estou olhando e quero ver agora" sem custo de fundo, e é
   o gesto que todo mundo já tenta por instinto.
2. **Poll leve só na aba de eventos**, enquanto ela estiver visível (ex.: 60s).
   Escopo estreito de propósito: não faz sentido pagar poll de eventos com o
   usuário no mapa.
3. **Invalidação por push.** Já existe Web Push (VAPID) neste projeto: quando
   um downwind é criado, cancelado ou encerrado, mandar uma mensagem silenciosa
   para os interessados dispararem revalidação. Mais eficiente que qualquer
   poll, e reaproveita infra que já está de pé. Depende da ponte FCM para
   alcançar o app nativo — ver `docs/PLANO-APP-NATIVO.md`.
4. **SSE/WebSocket** (item 7 do roadmap Antigravity). Resolve de vez, mas é o
   mais caro e provavelmente prematuro para o tamanho atual.

Recomendação: 1 e 2 agora, 3 junto com a ponte FCM do plano do app nativo. O 4
só quando o volume justificar.

## Nota sobre "apagar" downwind

`DELETE /api/events/[id]` apaga a linha em `downwinds` de verdade
(`app/api/events/[id]/route.ts`), então não é caso de registro
soft-deleted continuar aparecendo. Foi conferido durante esta investigação —
o dado sumiu do banco na hora; o que sobrou foi cópia velha na tela do outro
usuário.
