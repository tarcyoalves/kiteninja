# Prompt para pedir auditoria externa (Antigravity)

Cole o bloco abaixo. Ele foi escrito depois das auditorias de 02/09/2026, em que
boa parte dos achados descrevia código que não existia — ver
`docs/AUDITORIA-EXTERNA-2026-09-02.md`. As travas de evidência são a correção
disso.

---

Você vai auditar o KiteNinja, um PWA de kitesurf em produção. Antes de qualquer
coisa, leia as regras de evidência — elas valem mais que a extensão do relatório.

## REGRA 1 — Nenhum achado sem prova no código

Todo item do relatório precisa de `caminho/arquivo.ts:linha` e do trecho real
colado. Se você não abriu o arquivo, o achado não existe. Não infira
comportamento por nome de função, por convenção de framework, nem por como
projetos parecidos costumam ser.

Auditorias anteriores deste mesmo app relataram como bug: um cache que já era
compartilhado, rotas que já tinham autorização, e campos que já eram validados.
Isso custa mais tempo do que a auditoria economiza.

## REGRA 2 — Esta NÃO é a Next.js que você conhece

O projeto roda **Next.js 16 com React 19 e React Compiler**. Muita coisa mudou.
Antes de apontar qualquer erro de framework, leia o guia relevante em
`node_modules/next/dist/docs/`. Se um padrão parecer errado, confirme na doc
local ou no código de `node_modules/next/dist/` antes de escrever.

Especificamente, **não** relate como bug: `await cookies()`, `await params`,
ausência de `useMemo`/`useCallback` (o React Compiler cuida), ou `fetch` com
`next: { revalidate }` em rota dinâmica (verificado em `patch-fetch.js`, é
válido e intencional).

## REGRA 3 — Separe o que você verificou do que você supôs

O relatório termina com duas listas obrigatórias:
- **Verifiquei rodando**: o que você executou e o que deu.
- **Não consegui verificar**: o que ficou como hipótese, e o que faltou.

Prefiro cinco achados provados a trinta plausíveis. Achado sem prova, marque
como HIPÓTESE no título.

## Contexto real (não invente em cima disto)

- PWA Next.js 16 + React 19 + Postgres (Neon, driver HTTP `@neondatabase/serverless`).
- Android é Capacitor com `server.url` apontando para a web — o APK é uma casca.
- **~5 usuários, ainda não publicado na Play Store.** Achado de escala só
  interessa se explicar o gatilho concreto ("a partir de N, acontece X").
- Não sugira monetização, paywall ou plano Pro. É decisão de produto já tomada:
  fica para depois do lançamento.
- Funções críticas de segurança: SOS georreferenciado e rastreio de downwind ao
  vivo. Dado perdido aí é gente sem socorro — priorize isso acima de tudo.

## Comandos (rode todos e cole a saída)

```
npm run typecheck
npm run lint
npm run test          # ~890 testes
npm run test:sql      # ~284 checks de SQL contra o schema real
npx tsx scripts/verify-sos.ts
npm run build
```

Se todos passam e você tem um achado, explique **por que nenhum deles pegou**.
Essa explicação costuma valer mais que o achado.

## Foco 1 — PAINEL ADMIN (prioridade alta)

Superfície completa:

- Telas: `app/admin/page.tsx`, `AdminDashboard.tsx`, `UserManager.tsx` (537 li),
  `IntroVideoManager.tsx` (775 li), `InviteManager.tsx`, `ChamadosManager.tsx`.
- Rotas: `app/api/admin/{users,users/[id],invites,invites/[id],chamados,chamados/[id],intro-video,push-diag}`.
- Guardas: `requireAdmin()` em `lib/auth.ts`; a página usa `getSessionUser()` +
  `redirect`. Não há `middleware.ts` — o app confia na checagem por rota.

Perguntas que quero respondidas com evidência:

1. **Alguma rota admin (ou verbo dentro dela) escapa do `requireAdmin`?** Confira
   verbo por verbo, inclusive os que estão no meio do arquivo. `intro-video`
   tem GET, POST, PATCH e DELETE.
2. **Escalonamento de privilégio:** `PATCH /api/admin/users/[id]` aceita `role`.
   O último admin pode se rebaixar, se desativar, ou promover alguém e perder o
   controle? Existe proteção de auto-rebaixamento — ela cobre todos os caminhos?
3. **Sessão após mudança de papel:** rebaixar ou desativar um usuário derruba a
   sessão dele de fato (`invalidateAllUserSessions`), ou ele continua admin até
   o cookie vencer?
4. **Vazamento de dado no admin:** as respostas devolvem hash de senha, token de
   convite, e-mail de terceiros ou segredo? `push-diag` afirma não devolver
   valor de segredo — confirme lendo.
5. **Upload em `intro-video`:** limite de tamanho, tipo de arquivo validado no
   servidor (não só no cliente), e o que acontece com arquivo malformado.
6. **Sem rate limit nas rotas admin** (`lib/rateLimit.ts` é usado em login, SOS,
   downwind, mas não aqui). Isso importa, ou é ruído dado que exige sessão
   admin? Quero seu argumento, não a regra genérica.
7. **Zero teste automatizado toca o painel.** `lib/authz.test.ts` cobre a regra
   pura, mas nenhum teste exercita as rotas. Qual é o teste de maior valor por
   linha escrita aqui?

## Foco 2 — Registro que não pode se perder

O defeito recorrente desta base é **medir o dado certo e perdê-lo depois**. Já
aconteceu seis vezes em lugares diferentes. Procure a sétima:

- Marcar velejo: `lib/useTrilhaSessao.ts`, `lib/trilhaPersistida.ts`,
  `components/SessionLoggerModal.tsx`, `components/AvisoVelejoNaoRegistrado.tsx`.
- Downwind ao vivo: `lib/useDownwindBeacon.ts`, `lib/filaPosicoes.ts`,
  `app/api/downwind/[id]/posicoes/route.ts`, `lib/downwindSilencio.ts`.
- SOS: `app/api/sos/*`, `lib/sosCandidates.ts`, `lib/push.ts`.

Pergunta central: existe caminho em que o usuário faz a coisa certa e o dado
**não** chega ao banco nem fica recuperável? Rede caindo, app fechado no meio,
aba trocada, GPS negado depois de concedido, relógio do aparelho errado.

## Foco 3 — Banco

`lib/schema.sql` tem 42 tabelas e 77 rotas de API. O driver HTTP do Neon
**não compõe fragmentos SQL** — `sql` aninhado vira valor de parâmetro, não
SQL. Já foi bug real aqui. Procure:

- Query sem índice que a acompanhe, em caminho chamado com frequência.
- `UPDATE`/`DELETE` sem `RETURNING` cujo resultado é interpretado como sucesso
  (o Neon devolve `[]` nesse caso, o que já enganou código nesta base).
- Escrita sem transação onde a falha no meio deixa estado inconsistente.

## Formato de saída

Por achado:

```
[P0|P1|P2] Título curto
Arquivo: caminho:linha
Trecho: (código real colado)
Como reproduz: (passos concretos, ou HIPÓTESE se não reproduziu)
Impacto: (o que o usuário perde — não "é má prática")
Correção sugerida: (mínima, no estilo do código existente)
Por que os testes não pegam: (obrigatório)
```

Ordene por dano real ao usuário, não por severidade teórica. P0 é reservado
para: perda de dado de quem está na água, SOS que não chega, ou dado de um
usuário exposto a outro.

Se não achar nada de P0, diga isso claramente. É uma resposta aceitável e útil.
