# Mega-prompt para o Antigravity

Cole o bloco abaixo inteiro como primeira mensagem. Ele é autossuficiente:
não depende deste chat. O agente deve ler `HANDOFF.md` no repo como
complemento (diagnósticos completos e medições).

---

Você vai assumir o desenvolvimento do **KiteNinja**, um app mobile-first de
condições para kitesurf (vento, maré, ondas, eventos, comunidade,
marketplace, chat), **fechado por convite**. O app está no ar em
https://kiteninja.vercel.app e o repositório é `tarcyoalves/kiteninja`
(branch `master`, commit base `cd06bd2`).

**Primeiro passo obrigatório: leia `HANDOFF.md` na raiz do repo.** Ele traz o
inventário completo (17 tabelas, 26 rotas), as causas-raiz já diagnosticadas
dos bugs, as medições feitas e as armadilhas do ambiente. Leia também
`AGENTS.md`: esta versão do Next tem breaking changes e você deve consultar
`node_modules/next/dist/docs/` antes de escrever código de framework, em vez
de confiar na sua memória de Next 14/15.

## Contexto de produto

Pense como o velejador que "checa tudo com um olhar enquanto se prepara na
praia". Se a informação exige dois toques para aparecer, está no lugar errado.
Regra de negócio confirmada: **18 nós ou mais já é vento bom para velejar**.

## Stack

Next.js 16.3.1 (App Router) · React 19.2.8 · TypeScript · Tailwind v4 ·
Neon Postgres (`@neondatabase/serverless`, driver HTTP) · sessão própria em
cookie httpOnly + bcryptjs 12 rounds · Open-Meteo sem chave
(`gfs_seamless`) · Leaflet · Vitest (**230 testes passando**) · Vercel.

## Suas quatro tarefas

Faça na ordem **B → C → D → A**: B e C são bugs que o usuário vê agora; A é a
maior e fica melhor sobre base sem defeito aberto.

### B) A animação de vento pisca e morre

Sintoma: "quando clica, aparece rapidamente a animação e some logo".

**A causa já está localizada, não perca tempo procurando.** Em
`components/WindParticleLayer.tsx`, `projetarSpots()` só é chamado dentro de
`iniciar()` (linha ~163), e `projetados` é a única fonte do campo de vento.
Os dados de vento chegam **assíncronos depois do mount**, então a projeção
acontece com lista vazia; com ela vazia, `campoDeVento()` retorna
`{vx:0, vy:0, forca:0}` (`lib/windVector.ts:51`), as partículas não se
deslocam, o véu translúcido apaga o rastro e o campo morre. `spotsRef.current`
é atualizado a cada render (linha 44) mas **ninguém reprojeta** quando muda —
esse é o furo. Medido: o canvas é criado 2× e removido 1× num ciclo de troca
de aba, ou seja o efeito remonta e a projeção não acompanha.

Corrija reprojetando quando o conteúdo de `spots` mudar, **sem** repovoar as
partículas a cada chegada de dado (repovoar faz piscar); não deixe o loop
girando com campo vazio; e garanta que alternar a camada
(`activeLayer !== 'ondas'` em `LeafletMap.tsx:330`) não mate a animação.
Não desfaça o que já foi corrigido: o loop não inicia com a aba oculta (o
`rAF` pedido nesse estado é suspenso e nunca reagenda) e há um
`ResizeObserver` que repovoa quando o container ganha área.

**Armadilha de verificação:** o painel de preview do editor **não compõe
frames** — `document.hidden` fica `true`, `rAF` não é servido e o canvas lê 0
pixels *mesmo funcionando*. Já houve uma conclusão errada por causa disso. Para
verificar: intercepte `requestAnimationFrame`, enfileire os callbacks, bombeie
~40 frames à mão e conte pixels com alpha > 0 via `getImageData` (com o campo
correto isso deu 20.506 pixels). Melhor ainda: teste no iPhone real.

### C) Previsão avança de dia pelo scroll

Ao rolar a previsão, deve emendar no próximo dia sozinho, sem clicar no botão
de "amanhã".

**Boa parte já existe** em `components/SpotDetailModal.tsx`:
`selectedDayIndex` + `scrolledDayIndex` (~51-53), `scrollToDay()` com
`scrollIntoView` (~86-97) e `IntersectionObserver` (~105). **Verifique e
termine, não reescreva.** Cuide de: possível laço no `useEffect` de
sincronização (~76-83), que depende de `selectedDayIndex` e o altera; o
`if (dayIdx === scrolledDayIndex) return;` em `scrollToDay`, que pode
transformar o clique no botão em no-op; `prefers-reduced-motion`; e o
cabeçalho horizontal de dias (623px de conteúdo em 344px de caixa) trazendo o
dia ativo para a vista sozinho. O resultado deve ser continuidade real, sem
salto brusco e sem perder posição ao voltar.

### D) Maré e ondas divergentes do Windfinder

Precisa ser preciso: "saber que horas enche e que horas seca".

O **vento já foi resolvido**: `best_match` → `gfs_seamless`
(`lib/weather.ts:20`), erro medido contra o Windfinder caiu de 4,1 → 1,9 nó
(rajada 6,4 → 2,1), confirmado em produção. `cell_selection=sea` para vento
**piora** (3,6) — não reintroduza sem medir.

**Achado verificado sobre maré/ondas:** chamando
`marine-api.open-meteo.com` para `-4.975,-37.042` (Barra de Pernambuquinho), a
resposta volta com `latitude: -4.791664`, `elevation: 62.0` — a API deslocou a
coordenada ~20 km para **dentro do continente** e está resolvendo célula de
**terra**. `cell_selection=sea` **não corrige**. A curva oscila de forma
plausível (−0,91m a +1,21m), então a amplitude parece real, mas a **fase e a
localização são suspeitas** — e fase errada é exatamente errar a hora que
enche e seca.

Investigue nesta ordem: (1) usar coordenada marinha própria por spot
(`marine_lat/marine_lng`) deslocada para mar aberto, validando que a resposta
volte com `elevation` ~0; (2) conferir contra fonte independente — maré
astronômica é tabelada, a referência brasileira é a Marinha (DHN/FEMAR); se o
modelo não acertar a fase, considere tábua de maré por porto de referência em
vez de modelo de circulação; (3) interpolar o pico (parábola nos 3 pontos
vizinhos), porque hoje `tideTrendAt` (`lib/weather.ts:163`) compara amostras
de 1 hora e o pico real não cai no minuto cheio; (4) validar
`wave_height/direction/period` no mesmo esquema; (5) **registrar erro médio
medido antes/depois no commit** — sem número, não é melhoria. Estenda
`lib/weather.test.ts` e `lib/forecastGrid.test.ts`, não duplique.

### A) Estrutura completa de usuários — "pense em tudo"

Hoje existe: `users` (roles `admin`/`rider`, `must_change_password`,
`disciplines`, peso, nível, home spot), convite de uso único, sessão em
cookie, troca de senha, `/api/profile`, painel admin de convites.

**Antes de codar, entregue `docs/PLANO-USUARIOS.md` versionado no repo.**
Plano e progresso vão versionados, nunca só no chat: outro agente precisa
continuar sem esta conversa.

Cobrir no mínimo:

- **Ciclo de vida:** recuperação de senha (token uso único, expirável, hash no
  banco — nunca em claro), verificação de e-mail, troca de e-mail com dupla
  confirmação, desativação (soft delete) vs. exclusão com LGPD (exportar meus
  dados, apagar conta). Hoje o CASCADE apaga posts e sessões junto com o
  usuário — decida se é o desejado ou se o certo é anonimizar o autor e
  preservar o conteúdo da comunidade.
- **Identidade:** avatar (há **bug conhecido de "alterar foto"**, causa não
  localizada — investigue e conserte; decida armazenamento, Vercel Blob é o
  caminho natural, e evite base64 no Postgres), perfil público/privado, bio,
  quiver (tamanhos de kite/prancha), unidade preferida (nó/km/h), regra de
  geração e unicidade do `rider_id`.
- **Papéis:** provavelmente faltam `moderator` e talvez `escola`/`instrutor`.
  Centralize em `lib/authz.ts` (já existe com teste) — **não** espalhe
  `if (user.role === 'admin')`. Matriz de permissão explícita e testada.
- **Segurança:** **rate limit em login, aceite de convite e recuperação não
  existe hoje — é a lacuna mais séria**; lockout progressivo ou captcha;
  listar e revogar sessões por dispositivo; invalidar todas as sessões ao
  trocar senha (verifique, hoje aparentemente não invalida); rotação do cookie
  no login; log de auditoria de ação de admin.
- **Admin:** lista de usuários com busca/filtro/paginação, suspender,
  promover/rebaixar, forçar troca de senha, reenviar convite; métricas
  básicas; denúncia de conteúdo e fila de moderação.
- **Notificações:** projete o schema de preferências por canal e tipo (vento
  bom no meu spot, resposta no meu post, novo evento), mesmo que a entrega
  fique para depois.

## Regras não negociáveis

1. **Nunca** coloque segredo em `NEXT_PUBLIC_`; `.env*` está no `.gitignore`.
2. **Nunca** cole token (GitHub/Vercel/Neon) em chat — use `gh` e `vercel` já
   autenticados na máquina.
3. Todo `UPDATE`/`DELETE` em dado de usuário **filtra por `user_id`**
   (`lib/authz.test.ts` cobre; não regrida).
4. Convite é **uso único** via `UPDATE ... WHERE used_at IS NULL` condicional,
   que resolve a corrida no banco. Não troque por `SELECT` + `UPDATE`.
5. `favorites`, `post_likes`, `event_registrations` e `listing_favorites` têm
   **chave composta e não têm coluna `id`** — `SELECT id` nelas explode.
   Toggle correto: `DELETE ... RETURNING`; se não removeu, `INSERT ... ON
   CONFLICT DO NOTHING`.
6. PATCH parcial usa `COALESCE(${valor}, coluna)`, nunca SQL concatenado.
7. Params de rota dinâmica são Promise:
   `ctx: { params: Promise<{ id: string }> }`.
8. Connection string do Neon **precisa ser a pooled** (host com `-pooler`).
9. Overlay em tela cheia usa `.overlay-safe-top`/`.overlay-safe-bottom`
   (`app/globals.css`), senão colide com o relógio do iPhone.
10. **Não chumbe medida de layout.** O `.bottom-nav-gap` fixava `4rem` para um
    menu de 65px e 1px bastava para engolir o toque da primeira aba; hoje o
    `BottomNav` publica a altura real em `--nav-h` via `ResizeObserver`.
11. Ações destrutivas (apagar dados, mexer em produção, migração
    irreversível): **explique o risco e peça confirmação** antes.

## Método de trabalho

Delegue em paralelo o que é independente (ler muitos arquivos, rodar suites),
mas **audite a saída dos subagentes**: nesta base eles reportaram "concluído"
três vezes com bug real dentro — SQL dinâmico gerando `spot_name = 1` (inteiro
literal em vez de `$1`) e três `SELECT id` em tabelas de chave composta.

**Meça, não deduza.** As conclusões erradas desta base vieram de dedução:
afirmar que a animação funcionava com base no preview (que não compõe frames),
e diagnosticar layout com `clientHeight: 0` quando o próprio `<html>` mede 0
no painel. Instrumente (MutationObserver, interceptar `rAF`, `getImageData`)
ou teste no aparelho. Se a mesma abordagem falhar duas vezes, pare de ajustar
na margem: diga o que deu errado e mude de estratégia.

## Comandos

```bash
npm run dev
npx tsc --noEmit
npx vitest run
npm run build
npx tsx scripts/verify-sql.ts   # Postgres real em processo (PGlite), sem rede
npx tsx scripts/verify-db.ts    # integração no Neon (precisa DATABASE_URL)
```

`verify-sql.ts` roda antes de qualquer mudança de schema/query — ele já pegou
3 bugs reais.

## Definição de pronto (toda tarefa)

`npx tsc --noEmit` limpo · `npx vitest run` com os 230 atuais passando mais os
novos · `verify-sql.ts` verde se mexeu em SQL · `npm run build` verde ·
verificado no aparelho ou por instrumentação real (não por screenshot de
preview) · commit explicando **o porquê** e com o número medido · push e
**confirmação na URL pública** (o deploy entra como Preview: promova para
produção e confirme que o artefato servido tem a sua mudança) · plano e
progresso versionados em `docs/`.

Código, comentários, commits e UI em **português do Brasil**. Comentário
explica **por que**, não o que a linha faz.

Pendências conhecidas fora das quatro tarefas, para não redescobrir:
"alterar foto" quebrado; criar anúncio e chat foram relatados como não
funcionais e **não foram confirmados ponta a ponta logado** (existem rotas e
testes); sem rate limit; `calculateKiteSize` tem condicional morta
(`(75 / weightKg) > 0`, sempre verdadeiro).

Comece lendo `HANDOFF.md`, confirme o estado com os quatro comandos de
verificação, e então ataque a Tarefa B.
