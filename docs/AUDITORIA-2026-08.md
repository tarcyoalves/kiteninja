# Auditoria forense pré-produção — KiteNinja

Data: 2026-08-23 · Base auditada: `b7b5e39` · Estado reavaliado sobre: `5da4a7a` (`master`)
Produção: https://kiteninja.vercel.app

Escopo: 186 arquivos versionados, 39 rotas de API, 25 tabelas, 24 arquivos de teste
(360 testes). Cada achado é **CONFIRMADO** (prova de execução ou evidência direta),
**PROVÁVEL** ou **POSSÍVEL**. Nada aqui é hipótese apresentada como bug.

> **Nota de processo.** Durante esta auditoria, outra sessão trabalhou no mesmo repo e
> corrigiu parte dos achados de forma independente (14 commits). Os itens A1, A2 e C2
> foram resolvidos lá — a solução deles para A1 é melhor que a minha (extraíram
> `lib/sosCandidates.ts`, reaproveitado pelas duas rotas, cobrindo também quem só
> declarou um spot sem GPS fresco), então descartei minha versão e adotei a delas.
> Este documento marca o que **eu** corrigi, o que **já estava corrigido**, e o que
> **segue aberto**.

---

## 1. Mapa da arquitetura

**Stack:** Next.js 16.3.1 App Router · React 19.2.8 · TypeScript 5 · Tailwind v4 ·
Neon Postgres (`@neondatabase/serverless`, driver HTTP) · Vercel (Node 24.x) ·
Vitest 4 + PGlite para validação de SQL em Postgres real, sem rede.

```
app/api/        39 rotas (7 públicas, 32 autenticadas, 5 exclusivas de admin)
lib/            auth · authz · rateLimit · weather · sos · sosCandidates · push · chat
components/ views/ context/
scripts/        migrate · seed · verify-sql (PGlite, 92 checagens) · verify-db (Neon)
```

**Fluxos:** convite uso único → sessão em cookie httpOnly (30d) · `GET /api/spots` →
Open-Meteo com cache e dois fallbacks · `POST /api/sos` → grava alerta → busca presenças
próximas (bounding box + Haversine) → notifica → escala raio 5 → 15 → 50 km · chat com
presença por heartbeat, posts, marketplace, eventos.

**Segurança verificada e correta:** tokens de sessão/convite/reset como SHA-256, nunca em
claro · bcrypt 12 rounds · login timing-safe com `DUMMY_HASH` · consumo de convite
resolvido no banco (`UPDATE … WHERE used_at IS NULL`) · `handle()` nunca vaza stack ·
zero `dangerouslySetInnerHTML`/`eval` · nenhum segredo hardcoded ou em `NEXT_PUBLIC_`
(só a chave VAPID pública, que é o desenho correto) · as 5 rotas de admin aplicam
`requireAdmin()` no servidor · sem IDOR: todo UPDATE/DELETE de dado de usuário filtra por
`user_id`, com a exceção de moderação de chat documentada e correta · SQL sempre
parametrizado por template tag · teste automatizado proíbe `SELECT *` em `users`.

---

## 2. Achados P0 — corrigidos

### A1 · `INTERVAL` com parâmetro interpolado — CONFIRMADO · corrigido em `da81983` (outra sessão)
`AND last_seen_at >= NOW() - INTERVAL '${JANELA_PRESENCA_MS} milliseconds'`

O `${}` dentro de **string literal** SQL não se torna parâmetro: o banco recebia
`INTERVAL '$1 milliseconds'` com 1 parâmetro para um statement que declara 0.

Prova de execução (Postgres real):
```
FORMA ATUAL (INTERVAL '$1 ms'): FALHOU -> bind message supplies 1 parameters,
                                          but prepared statement "" requires 0
FORMA CORRETA (corte como parâmetro): OK
```

**Impacto:** a busca de socorristas lançava exceção — num SOS real, **nenhum velejador
próximo era notificado**, e a escalada de raio falhava igual. Era o pior defeito do
produto: caminho de segurança de vida.

### A2 · `lib/schema.sql` divergente da produção — CONFIRMADO · corrigido em `da81983`
`user_presence.lat/lng/pos_updated_at` existiam **só no banco de produção**, fora do
schema versionado. Prova em banco criado do schema: `column "lat" does not exist`.
Qualquer ambiente recriado (staging, dev novo, recuperação de desastre) subia com o
socorro quebrado.

### A3 · `INSERT` de socorristas sem `ON CONFLICT` — CONFIRMADO · **corrigido nesta auditoria**
`app/api/sos/route.ts` · `app/api/sos/active/route.ts`

`sos_responders` tem PK composta `(sos_id, user_id)` e o `INSERT` em laço não tinha
`ON CONFLICT`. Uma única duplicata **abortava a requisição inteira**: o SOS ficava gravado
sem notificar ninguém e o cliente recebia 500. O risco é maior na escalada, onde o mesmo
velejador reaparece entre os candidatos do raio ampliado.

Corrigido com `ON CONFLICT (sos_id, user_id) DO NOTHING`. Aproveitei para gravar
`distance_km`, que era calculada e descartada — é o dado que diz ao pedinte quem está
mais perto.

**Cobertura:** a busca de socorristas não tinha teste nenhum, e foi por isso que os três
defeitos passaram com `verify-sql` em 81/81. Agora são **92 checagens**, exercitando a
query real.

---

## 3. Achados P1/P2 — estado atual

| ID | Achado | Status |
|---|---|---|
| B2 | `lib/authz.ts` subutilizado: moderadores não moderavam | parcial — 3 rotas usam (era 2); `chat/messages/[id]` e `sos/active` ainda checam `=== 'admin'` inline |
| C1 | Listener `error` com arrow inline nunca removido (leak) | **corrigido nesta auditoria** (`SplashIntro.tsx`) |
| C2 | `lib/validation.ts` sem teste | corrigido pela outra sessão |
| C4 | Feeds sem `LIMIT`: `alerts`, `events`, `sessions` | **corrigido nesta auditoria** (LIMIT defensivo) |
| B1 | Rate limit em memória (`Map`) não protege em serverless | **ABERTO** — ver §4 |
| B3 | Cache de clima em memória (`Map`), mesma causa de B1 | **ABERTO** |
| B4 | Nenhuma transação no projeto | **ABERTO** — limite do driver HTTP |
| C3 | `lib/push.ts` sem teste (caminho de notificação do SOS) | **ABERTO** |
| C5 | Sem paginação em posts/sessões/alertas | **ABERTO** |
| C6 | `SELECT … FROM spots` sem LIMIT a cada SOS | **ABERTO** |
| C7 | Sem observabilidade além de `console.error` | **ABERTO** |
| D3 | `next.config.ts` vazio: sem CSP/HSTS/X-Frame-Options | **ABERTO** |
| D4 | `master` e `main` coexistem; produção sai de `main` | **ABERTO** (processo) |

---

## 4. Aberto e dependente da sua decisão

Estes mudam arquitetura ou têm risco de regressão. Apresento; **não executo sem seu aval.**

**B1 · Rate limit distribuído.** `lib/rateLimit.ts:14` usa `new Map()`. Cada instância
serverless tem seu próprio heap: com N instâncias o teto real de login é `5 × N`, e um
cold start zera o contador. A proteção contra força bruta em login, recuperação de senha
e aceite de convite é bem mais fraca do que aparenta. Ainda tem valor (barra ataque
trivial contra uma instância quente) — não é implementação ruim, é limite da arquitetura.
*Proposta:* mover o contador para o Postgres (tabela com janela deslizante), que evita
nova dependência já que o driver HTTP está no caminho.

**B4 · Transações.** `grep BEGIN|COMMIT|ROLLBACK` é vazio no projeto. O SOS faz 4+
escritas independentes; falha no meio deixa estado parcial. O driver HTTP do Neon **não
suporta** transação multi-statement — mitigar exige `neon-serverless` com WebSocket ou
tornar as operações idempotentes e reordenáveis.

**C7 · Observabilidade.** Hoje um erro em produção só existe se alguém abrir os logs da
Vercel. Sem crash reporting, um SOS que falhar passa silencioso — inaceitável para o
caminho de segurança de vida.

**D3 · Headers de segurança.** Precisa validar CSP contra Leaflet (tiles externos) e
Vercel Blob antes de ligar, senão quebra mapa e imagens.

---

## 5. Auditoria de escala

| Usuários | O que quebra |
|---|---|
| 100 | Nada estrutural. |
| 1.000 | Cache de clima em memória (B3) multiplica chamadas ao Open-Meteo. |
| 10.000 | Falta de paginação (C5) pesa; rate limit (B1) claramente insuficiente. |
| 100.000 | Exige índice geoespacial de presença, paginação obrigatória, cache externo e rate limit distribuído. |

---

## 6. O que NÃO está quebrado

Registro explícito para não gerar retrabalho: núcleo de autenticação, hashing e tokens ·
consumo atômico de convite · proteção das rotas de admin · ausência de IDOR ·
parametrização de SQL · resiliência do `weather.ts` (AbortController + 2 fallbacks) ·
cleanup de timers no `ChatView` · `handle()` sem vazamento de stack · gestão de segredos.
