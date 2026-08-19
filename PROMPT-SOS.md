# Tarefa: botão SOS funcional no KiteNinja

Você vai implementar um botão de socorro no KiteNinja, um app de kitesurf já em
produção (Next.js 16 App Router + Neon Postgres + Vercel). O app existe, tem 302
testes passando e usuários reais. **Leia o código antes de escrever qualquer
coisa** — as convenções abaixo não são sugestões, são o que já está no repo.

---

## 0. Regra que define esta feature

Este botão será apertado por alguém dentro da água, possivelmente se afogando.

Isso tem duas consequências que você **não pode** relativizar:

1. **O app não é serviço de resgate e a interface precisa dizer isso.** Se o
   velejador acreditar que o botão traz socorro, ele pode deixar de acionar
   Bombeiros (193) ou Marinha (185). O SOS depende de 4G na água, de bateria, de
   outro velejador estar com o app aberto e ter dado permissão de notificação —
   qualquer um desses falhando torna o alerta silencioso. Portanto o SOS mostra
   **193 e 185 com discagem em um toque, em destaque**, junto do alerta à
   comunidade, e diz em texto claro que avisa velejadores próximos mas não
   substitui socorro oficial.
2. **Nada pode bloquear o disparo.** Se a geolocalização demorar, se a rede
   estiver ruim, se o contato de emergência não existir — o alerta sai de todo
   jeito, com o que houver. É melhor um SOS sem coordenada precisa do que nenhum
   SOS. Nunca coloque uma confirmação de dois passos, um `await` sem prazo, ou
   uma validação que possa recusar o pedido.

---

## 1. Contexto real do projeto (verifique, não confie em mim)

Stack: Next.js `16.3.1` (App Router), React `19.2.8`, TypeScript, Tailwind v4,
Neon Postgres via `@neondatabase/serverless`, deploy na Vercel.

Antes de codar, leia estes arquivos:

| Arquivo | Por que importa |
|---|---|
| `lib/schema.sql` | 22 tabelas já existentes. Seu schema novo vai no fim, mesmo estilo. |
| `lib/geo.ts` | Já tem `haversineKm(a, b)` e `nearestSpot()` testados. **Reuse, não reescreva.** |
| `lib/presence.ts` | `touchPresence()` e `touchPresenceKeepingSpot()`. Já sabe quem está online. |
| `lib/auth.ts` | `requireUser()`, `requireAdmin()`, `HttpError`. |
| `lib/authz.ts` | RBAC central. Papéis: `admin`, `moderator`, `instructor`, `rider`. |
| `lib/api.ts` | `handle()`, `readJson()`, `readOptionalJson()`. Todo route handler usa. |
| `lib/validation.ts` | `str()`, `num()`, `bool()`, `oneOf()`. Não valide na mão. |
| `lib/rateLimit.ts` | `enforceRateLimit()` e o objeto `rateLimiters`. |
| `views/MapView.tsx` | Geolocalização real já funciona ali (`watchPosition`, cleanup no unmount). Siga o padrão. |
| `components/LeafletMap.tsx` | Onde os pinos são desenhados. |
| `components/BottomNav.tsx` | Navegação inferior; o SOS conversa com ela. |
| `components/InAppPushToast.tsx` | Toast in-app que já existe para mensagens de chat. Seu alerta é irmão dele. |
| `app/api/alerts/route.ts` | Modelo de rota: `handle()` + `requireUser()` + mapeamento snake_case → camelCase. |
| `app/globals.css` | Tokens de z-index (linhas ~85-98). **Use as classes, não números soltos.** |

Convenções que o repo já segue e você deve manter:

- **Queries com template tag parametrizado**: `` sql`SELECT ... WHERE id = ${id}` ``.
  Nunca concatene SQL. Nunca `sql.query()` com string montada.
- **Toda mutação em dado de usuário filtra por `user_id`** na cláusula WHERE.
  Não confie em ownership implícito.
- **Rotas devolvem camelCase**; o banco é snake_case. A conversão é explícita no
  `.map()`, como em `app/api/alerts/route.ts`.
- **Comentários em português explicam o "por quê", não o "o quê".** Olhe o estilo
  em `lib/presence.ts` — é esse tom. Não escreva `// incrementa contador`.
- **Testes com Vitest** ao lado do módulo: `lib/geo.test.ts`, `lib/chat.test.ts`.
  Lógica pura fica em `lib/` e é testada sem banco.
- Nada de segredo com prefixo `NEXT_PUBLIC_`.

---

## 2. Decisões já tomadas pelo dono do produto

Não reabra estas escolhas:

1. **Entrega**: Web Push (VAPID, sem serviço pago) + alerta imediato e sonoro em
   quem está com o app aberto. Sem WhatsApp/SMS nesta etapa.
2. **Raio dinâmico com escalada**: começa em **5 km**; se ninguém confirmar em
   **2 minutos**, amplia para **15 km**; após mais 2 minutos sem confirmação,
   **50 km**. Um pedido não pode morrer sem resposta em praia vazia.
3. **193 e 185 em destaque** no painel de SOS, com aviso explícito de que o app
   não é serviço de resgate.
4. **Contato de emergência opcional no perfil** (nome + telefone), que recebe um
   link com a última posição.

---

## 3. O que construir

### 3.1 Schema (adicione ao fim de `lib/schema.sql`, estilo idempotente)

Quatro coisas novas. Justifique cada decisão em comentário, como o resto do arquivo.

**`sos_alerts`** — o pedido de socorro:
- `id UUID PK DEFAULT gen_random_uuid()`
- `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `lat`/`lng` `NUMERIC(9,6)` **nullable** — o SOS sai mesmo sem GPS
- `accuracy_m NUMERIC(7,2)` — precisão relatada pelo navegador; 2km de erro muda
  a interpretação de quem vai ajudar
- `spot_id TEXT REFERENCES spots(id) ON DELETE SET NULL` — spot mais próximo,
  calculado no servidor
- `message TEXT` — opcional; ninguém digita se afogando, mas serve para
  "prancha quebrada, sem vento, derivando"
- `status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','em_atendimento','resolvido','cancelado','falso_alarme'))`
- `radius_km NUMERIC(6,2) NOT NULL DEFAULT 5` — raio atual da escalada
- `escalated_at TIMESTAMPTZ` — última ampliação
- `resolved_at TIMESTAMPTZ`, `resolved_by UUID REFERENCES users(id) ON DELETE SET NULL`
- `resolution_note TEXT`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

**`sos_responders`** — quem viu e quem vai:
- PK composta `(sos_id, user_id)` — **sem coluna `id`**, o repo já usa esse padrão
  em `favorites`, `post_likes` e `event_registrations`
- `sos_id UUID NOT NULL REFERENCES sos_alerts(id) ON DELETE CASCADE`
- `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `state TEXT NOT NULL CHECK (state IN ('notificado','a_caminho','no_local','nao_posso'))`
- `distance_km NUMERIC(6,2)` — distância no momento da notificação
- `lat`/`lng` `NUMERIC(9,6)` — posição de quem responde, para o pedinte ver a ajuda chegando
- `notified_at`, `responded_at TIMESTAMPTZ`

**`push_subscriptions`** — inscrições de Web Push:
- `id UUID PK`
- `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `endpoint TEXT NOT NULL UNIQUE` — o endpoint é o identificador natural; UNIQUE
  evita duplicar a mesma inscrição a cada reload
- `p256dh TEXT NOT NULL`, `auth TEXT NOT NULL`
- `user_agent TEXT` — para o usuário reconhecer "meu celular" numa lista
- `created_at`, `last_used_at TIMESTAMPTZ`
- `failure_count INT NOT NULL DEFAULT 0` — endpoint que falha várias vezes está
  morto (usuário desinstalou); limpe em vez de tentar para sempre

**Colunas novas em `users`** (via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`,
porque a tabela já existe em produção):
- `emergency_contact_name TEXT`
- `emergency_contact_phone TEXT`

**Índices** (siga a nomenclatura `idx_*` já usada):
- `idx_sos_active` em `sos_alerts (created_at DESC) WHERE status IN ('ativo','em_atendimento')`
  — parcial, porque 99% das consultas querem só os ativos
- `idx_sos_user` em `sos_alerts (user_id, created_at DESC)`
- `idx_sos_responders_sos` em `sos_responders (sos_id)`
- `idx_push_user` em `push_subscriptions (user_id)`

### 3.2 Lógica pura em `lib/sos.ts` (com `lib/sos.test.ts`)

Toda a matemática e regra de decisão fica aqui, **sem tocar no banco**, para ser
testável. Isto é o coração da feature e é onde os bugs doem.

```ts
/** Estágios da escalada: raio em km e quanto esperar antes de subir. */
export const ESTAGIOS_RAIO = [
  { raioKm: 5,  esperaMs: 2 * 60 * 1000 },
  { raioKm: 15, esperaMs: 2 * 60 * 1000 },
  { raioKm: 50, esperaMs: Infinity },
] as const;

/** Presença mais velha que isso não conta como "está por perto agora". */
export const JANELA_PRESENCA_MS = 15 * 60 * 1000;

export function proximoRaio(raioAtual: number): number | null;

/** Deve escalar? Só se ninguém assumiu e o prazo do estágio venceu. */
export function deveEscalar(args: {
  raioKm: number;
  criadoEm: Date;
  escaladoEm: Date | null;
  agora: Date;
  temResponsavel: boolean;
}): boolean;

/** Ordena candidatos por quem chega primeiro. */
export function ordenarCandidatos<T extends { distanciaKm: number; ultimaPresenca: Date }>(
  candidatos: T[],
  agora: Date
): T[];

/** Texto curto para push — cabe na notificação e diz o essencial. */
export function textoDoAlerta(args: {
  nome: string;
  distanciaKm: number;
  spotNome: string | null;
  temCoordenada: boolean;
}): { titulo: string; corpo: string };
```

Casos de teste que **exijo** ver cobertos:

- `deveEscalar` retorna `false` quando alguém já está `a_caminho`, mesmo com prazo
  vencido — ampliar o raio depois de haver resgate a caminho só gera pânico
- `deveEscalar` respeita `escaladoEm` e não `criadoEm` quando já houve escalada
- `proximoRaio(50)` devolve `null` (não existe estágio acima)
- `ordenarCandidatos` coloca o mais perto primeiro, e desempata pela presença
  mais recente
- `textoDoAlerta` sem coordenada não mente sobre localização — deve dizer algo
  como "posição não confirmada"
- **Antimeridiano e equador**: `haversineKm` já é testado, mas garanta que a
  filtragem por raio funciona em `lng` perto de ±180 e `lat` 0. Se você usar um
  bounding box para pré-filtrar no SQL (recomendado, por performance), ele
  **quebra ao cruzar o antimeridiano** — trate ou documente por que não trata no
  Brasil.

### 3.3 Rotas de API

Todas com `handle()` e `requireUser()`. Nenhuma rota nova sem autenticação.

**`POST /api/sos`** — dispara o socorro.
- Corpo: `{ lat?, lng?, accuracyM?, message? }` — tudo opcional, use `num(..., { optional: true })`
- Rate limit: adicione `sos` ao objeto `rateLimiters` — **3 por hora por usuário**.
  Generoso de propósito: bloquear um SOS legítimo é pior que tolerar repetição.
  Se já existir um SOS `ativo` do mesmo usuário criado há menos de 5 min,
  **atualize a posição dele em vez de criar outro** (o velejador apertando várias
  vezes em pânico não deve gerar 5 alertas).
- Servidor calcula `spot_id` com `nearestSpot()` a partir dos spots do banco.
  Nunca aceite `spot_id` do cliente.
- Seleciona candidatos: usuários com presença em `user_presence` dentro de
  `JANELA_PRESENCA_MS`, com `at_spot_id` conhecido ou última posição conhecida,
  dentro do raio. Insere em `sos_responders` com `state='notificado'`.
- Grava em `audit_logs` (`action: 'sos.created'`).
- Dispara push para os candidatos. **O push falhando não pode falhar a rota** —
  envolva em try/catch e registre; o alerta in-app ainda funciona.
- Resposta: `{ sos: {...}, notificados: number }`

**`GET /api/sos/active`** — o que quem está com o app aberto consulta.
- Devolve SOS ativos relevantes para *este* usuário (onde ele é candidato, ou que
  estão no raio dele agora), com distância calculada.
- Chame `touchPresenceKeepingSpot()` aqui: consultar SOS prova que o app está aberto.
- **Aplique a escalada aqui**, de forma preguiçosa: se `deveEscalar()` for true,
  amplie o raio, notifique os novos candidatos e grave `escalated_at`. Motivo:
  Vercel não tem processo em background, e cron job de 1 minuto não existe no
  plano gratuito. Como quem está online consulta a cada poucos segundos, a
  escalada acontece naturalmente. **Documente isso em comentário** — é uma
  decisão arquitetural, não um acidente.

**`POST /api/sos/[id]/respond`** — "estou indo".
- Corpo: `{ state: 'a_caminho'|'no_local'|'nao_posso', lat?, lng? }` com `oneOf()`
- UPSERT em `sos_responders` (`ON CONFLICT (sos_id, user_id) DO UPDATE`)
- Quando o primeiro `a_caminho` chega, mude o SOS para `em_atendimento` —
  isso para a escalada.

**`PATCH /api/sos/[id]`** — encerrar.
- Quem pode: o próprio autor, ou `canModerate(role)` de `lib/authz.ts`.
  **Adicione uma função `canResolveSos()` em `lib/authz.ts`** e teste os casos
  negativos em `lib/authz.test.ts` — não espalhe `if (role === 'admin')` na rota.
- Estados: `resolvido`, `cancelado`, `falso_alarme`. Grave `resolution_note`.
- Audit log obrigatório.

**`POST /api/push/subscribe`** e **`DELETE /api/push/subscribe`**
- Guarda/remove a inscrição. `ON CONFLICT (endpoint) DO UPDATE` para não duplicar.

**`PATCH /api/profile`** (rota existente — **estenda, não recrie**)
- Aceite `emergencyContactName` e `emergencyContactPhone`. A rota já usa o padrão
  `COALESCE(${valor}, coluna)`; siga-o.

### 3.4 Web Push

- Dependência: `web-push` (versão exata, sem `^`).
- Gere as chaves VAPID e coloque em variáveis de ambiente. A pública pode ser
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY`; **a privada, jamais** — só `VAPID_PRIVATE_KEY`.
- Crie `public/sw.js` (service worker) tratando `push` e `notificationclick`.
  Notificação de SOS usa `requireInteraction: true` e `tag` própria, para não ser
  agrupada com aviso de vento.
- Crie `public/manifest.webmanifest` — **hoje não existe**, e sem ele o iPhone não
  instala o app na tela de início, o que significa **zero Web Push no iOS**. Os
  ícones já existem em `public/brand/` (`logo-192.png`, `logo-512.png`,
  `maskable-512.png`); use-os. Referencie o manifest via `metadata` no
  `app/layout.tsx`, do jeito do Next 16.
- No `POST /api/push/subscribe`, se o endpoint retornar 404/410, **apague a
  inscrição** — endpoint expirado nunca volta a funcionar.

### 3.5 Interface

**`components/SosButton.tsx`** — o gatilho.
- Fica acessível de qualquer aba. Não invente z-index: use as classes de
  `app/globals.css` (`z-chrome`, `z-modal`, `z-lightbox`). Ele precisa ficar acima
  do mapa mas não pode tapar o menu inferior nem esbarrar no relógio do iPhone
  (o projeto já usa `env(safe-area-inset-*)` — verifique como).
- **Sem confirmação de dois passos.** Um toque dispara. Para evitar toque
  acidental no bolso, use *press-and-hold de 800ms* com anel de progresso visível
  — o velejador consegue segurar, o bolso não.
- Feedback físico: `navigator.vibrate()` quando existir.
- Estado de "enviando" honesto. Se a rede falhar, mostre "não conseguimos avisar
  a comunidade — ligue 193" em vez de um spinner infinito.

**`components/SosPanel.tsx`** — o que aparece depois de disparar.
- **193 (Bombeiros) e 185 (Marinha) como `<a href="tel:193">` bem grandes, no
  topo**, acima de qualquer coisa da comunidade. Frase clara: o app avisou
  velejadores próximos, mas não é serviço de resgate.
- Lista quem está a caminho, com distância, atualizando.
- Botão de cancelar/encerrar, para o caso de falso alarme.
- Se houver contato de emergência cadastrado, ofereça compartilhar a posição com
  ele (link `https://.../sos/{id}` ou `wa.me` pré-preenchido — sem API paga).

**`components/SosIncomingAlert.tsx`** — quem recebe.
- Modal que **interrompe**, diferente do `InAppPushToast` (que é discreto de
  propósito, para chat). Aqui é vida. Som + vibração + tela cheia.
- Mostra: nome, distância, spot, precisão do GPS, há quanto tempo.
- Ações: "Estou indo", "Não posso", "Ver no mapa".
- Se não houver coordenada, **diga isso** — "posição não confirmada, último spot
  conhecido: Ponta do Mel". Não desenhe um pino falso.

**No mapa** (`components/LeafletMap.tsx`, `views/MapView.tsx`)
- Pino de SOS distinto e pulsante, com círculo de precisão (`accuracy_m`).
- Pinos de quem está a caminho, para o pedinte ver a ajuda se aproximando.
- **Só desenhe pino se houver `lat`/`lng` reais.** Nunca chute posição.

**No perfil** (`components/SidebarDrawer.tsx` ou onde o perfil é editado — veja o
que existe)
- Campos de contato de emergência.
- Botão para ativar notificações, chamando `Notification.requestPermission()`.
  **Peça permissão aqui, num momento calmo**, nunca no meio de um SOS.
- No iPhone, se não estiver instalado na tela de início, explique como instalar —
  senão o push simplesmente não existe e o usuário não sabe por quê.

### 3.6 Privacidade — trate como requisito, não como detalhe

Localização precisa é dado sensível. Regras:

- Posição de SOS só é visível para quem foi notificado naquele alerta e para
  moderação. **Não** vaza no feed nem em rota pública.
- Fora de um SOS ativo, ninguém vê coordenada exata de ninguém. A presença normal
  continua sendo "está no spot X", como já é hoje.
- Ao resolver o SOS, pare de expor a coordenada nas consultas.
- Escreva isso em comentário na rota, para o próximo agente não "otimizar"
  devolvendo lat/lng para todo mundo.

---

## 4. Verificação antes de dizer que terminou

Rode e mostre a saída real:

```bash
npx tsc --noEmit
npx vitest run
npm run build
npx tsx scripts/verify-sql.ts   # valida o schema contra Postgres real (PGlite)
```

`scripts/verify-sql.ts` já existe e roda Postgres em processo. **Adicione casos
para as tabelas novas**: CHECK de `status` rejeitando valor inválido, PK composta
de `sos_responders` impedindo duplicata, CASCADE ao apagar usuário, e a query de
seleção de candidatos por raio.

Não altere `AGENTS.md` (é gerado pelo `next dev`). Não commite `.env.local`.

Ao terminar, relate:
- o que você **verificou rodando** vs. o que só leu
- o que **não** conseguiu testar (push real precisa de dispositivo físico — diga
  isso claramente em vez de afirmar que funciona)
- qualquer decisão que você tomou e que o dono deveria revisar

---

## 5. Erros que já vi acontecerem neste repo — não repita

1. **SQL dinâmico concatenado.** Uma versão anterior gerou `spot_name = 1` em vez
   de `$1`, gravando inteiro em coluna de texto. Use sempre template tag.
2. **`SELECT id` em tabela de chave composta.** `favorites`, `post_likes` e
   `event_registrations` **não têm coluna `id`**. `sos_responders` também não terá.
   Para toggle, use `DELETE ... RETURNING` e depois `INSERT ... ON CONFLICT`.
3. **Cache de borda sem invalidação.** Uma rota com `revalidate` ficou devolvendo
   dado velho por 5 minutos e parecia bug de gravação. Rotas de SOS **nunca**
   podem ser cacheadas — sem `revalidate`, e considere `dynamic = 'force-dynamic'`.
4. **`useEffect` sem cleanup em `watchPosition`.** Vaza bateria e mantém o GPS
   ligado. `MapView.tsx` já resolve isso; copie o padrão.
5. **Afirmar que testou sem ter testado.** Se não rodou, diga que não rodou.
