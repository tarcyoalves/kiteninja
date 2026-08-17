# Plano — Chat por spot

Status: **plano, nada implementado.**

## O que o velejador precisa de verdade

O caso de uso não é "conversar". É resolver quatro perguntas que só quem está lá
responde:

1. **"Tá entrando?"** — A previsão diz 18 nós às 14h. Quem está na praia às 13h50
   sabe se entrou, se está rajado, se está mais oeste do que o modelo diz.
   Previsão erra; olho na água não.
2. **"Alguém indo?"** — Velejar sozinho em spot com corrente é risco. Combinar
   presença é segurança, não sociabilidade.
3. **"Tá seguro?"** — Água-viva, bancada mudada, entulho na areia, corrente
   forte hoje.
4. **"Alguém tem uma bomba/barra de reserva?"** — Socorro logístico imediato.

Isso muda o desenho: **não é WhatsApp com tema de kite.** É um mural efêmero de
condição, ancorado em spot e em tempo.

## Decisão central: mensagem expira

**Mensagens somem em 12 horas.** Esse é o ponto mais importante do plano.

Por quê:
- "Tá entrando forte na ponta" é verdade por 2 horas, mentira em 2 dias. Chat
  permanente vira arquivo de informação errada que engana quem chega depois.
- Histórico permanente exige moderação permanente, e um app de nicho não tem
  moderador de plantão.
- Menos dado retido = menos exposição em caso de vazamento.
- Resolve automaticamente o problema de "conversa de ontem poluindo a de hoje".

Implementação: coluna `expires_at` + filtro na query. Limpeza física por
`DELETE FROM spot_messages WHERE expires_at < NOW()` chamado no cron da Vercel
(1x/dia) — não confiar só no filtro, porque dado retido é passivo.

Exceção: **alerta de segurança** (`safety_alerts`, que já existe) é permanente.
Chat é efêmero; alerta é registro.

## Modelo de dados

```sql
CREATE TABLE spot_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spot_id      VARCHAR(80) NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body         VARCHAR(500) NOT NULL,
  kind         VARCHAR(20) NOT NULL DEFAULT 'conversa',
               -- conversa, condicao, indo_velejar, cuidado, socorro
  -- Preenchidos só quando kind='condicao': o relato vira dado comparável.
  knots_now    SMALLINT CHECK (knots_now IS NULL OR knots_now BETWEEN 0 AND 80),
  -- Só quando kind='indo_velejar': a que hora pretende estar na água.
  arriving_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '12 hours'),
  deleted_at   TIMESTAMPTZ,
  CONSTRAINT kind_valido CHECK (kind IN ('conversa','condicao','indo_velejar','cuidado','socorro')),
  CONSTRAINT corpo_nao_vazio CHECK (length(btrim(body)) > 0)
);

CREATE INDEX idx_spot_msg_ativas ON spot_messages (spot_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE spot_presence (
  spot_id      VARCHAR(80) NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       VARCHAR(20) NOT NULL,   -- na_agua, na_praia, indo
  note         VARCHAR(140),
  expires_at   TIMESTAMPTZ NOT NULL,   -- presença dura no máx. 6h
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (spot_id, user_id),      -- chave composta: um estado por pessoa por spot
  CONSTRAINT status_valido CHECK (status IN ('na_agua','na_praia','indo'))
);

CREATE TABLE message_reports (
  message_id   UUID NOT NULL REFERENCES spot_messages(id) ON DELETE CASCADE,
  reporter_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason       VARCHAR(40) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, reporter_id)
);
```

`spot_presence` usa chave composta sem coluna `id` — mesmo padrão de
`favorites`/`post_likes`, então o toggle/upsert resolve no banco com
`ON CONFLICT (spot_id, user_id) DO UPDATE`.

## Tipos de mensagem (o que diferencia de um chat comum)

O seletor de tipo é o que transforma conversa em informação utilizável:

| Tipo | Uso | Efeito extra |
|---|---|---|
| `condicao` | "Entrou, 22 nós, rajado" | Pede os nós num campo numérico; aparece no card do spot como "relato de rider há 15 min", ao lado da previsão |
| `indo_velejar` | "Chego 15h" | Entra na contagem de presença; outros veem quem vai |
| `cuidado` | "Água-viva na entrada" | Fixa no topo por 3h, destaque âmbar |
| `socorro` | "Preciso de bomba" | Destaque, notifica quem marcou presença hoje |
| `conversa` | resto | Sem tratamento especial |

O ganho de `condicao`: o card do spot passa a mostrar **previsão do modelo E
relato humano lado a lado**. É exatamente a informação que decide a sessão, e
nenhum app de previsão tem.

## Entrega em tempo real: escolha técnica

**Não usar WebSocket.** Vercel serverless não mantém conexão persistente; exigiria
serviço externo pago (Pusher, Ably) ou mudar de hospedagem.

Abordagem em duas fases:

**Fase 1 — polling condicional.** `GET /api/spots/[id]/messages?since=<ISO>`
retornando só o que é novo. Intervalo adaptativo:
- Aba visível e usuário marcou presença: 15s
- Aba visível, sem presença: 45s
- Aba oculta (`document.hidden`): pausa total

Pausar com aba oculta não é detalhe: é bateria do celular do velejador, que pode
ser o único meio de contato dele na praia.

**Fase 2 (se necessário) — SSE.** Route Handler com `ReadableStream`. Funciona na
Vercel com limite de duração de função; reconecta sozinho. Só vale se o volume de
mensagens justificar.

Começar por polling. É simples, cacheável e suficiente para dezenas de usuários
por spot.

## Regras de segurança e abuso

- **Só logado.** Rota exige `requireUser()`. Sem exceção.
- **Rate limit**: 10 mensagens / 5 min por usuário por spot. Implementar contando
  `created_at` no próprio Postgres (sem Redis).
- **Sem link na mensagem** para conta com menos de 30 dias (vetor de phishing).
  Validar no servidor.
- **Denúncia**: 3 denúncias distintas → `deleted_at` automático + fila do admin.
- **Autor apaga a própria mensagem** (`deleted_at`, soft delete, filtrado por
  `user_id`). Admin apaga qualquer uma.
- **Nunca expor e-mail** de ninguém no chat. Só nome e rider_id.
- Escapar conteúdo na renderização — React já escapa por padrão; o risco seria
  `dangerouslySetInnerHTML`, que não deve aparecer aqui.

## Privacidade da presença — ponto delicado

"Quem está na água agora" é dado de **localização de pessoa física em tempo real**.
Mal desenhado, isso é ferramenta de perseguição.

Regras:
- Presença é **opt-in explícito**, nunca automática por GPS.
- Expira em no máximo 6h, sempre.
- O usuário pode aparecer como **contagem anônima** ("7 riders na água") em vez de
  nome. Anônimo é o padrão; identificar-se é escolha ativa.
- Nunca mostrar coordenada precisa nem trajeto — só o spot.
- Botão de sair da presença sempre acessível, com efeito imediato.

## Notificações

Fase 1: nada de push. Web Push exige service worker, chave VAPID e permissão —
complexidade alta e permissão negada é o resultado mais comum quando pedida cedo.

Fase 1 mostra **badge de não lidas** no ícone do spot favorito. Suficiente.

Push só depois, e apenas para `socorro` e `cuidado` — conteúdo que justifica
interromper alguém.

## UI

- Aba de chat **dentro do `SpotDetailModal`** (onde o velejador já está vendo o
  vento), não uma seção separada. A conversa pertence ao contexto do spot.
- Composer fixo embaixo, respeitando `env(safe-area-inset-bottom)` para não ficar
  atrás da barra do iOS.
- Mensagens de `condicao` com destaque visual e os nós em número grande.
- Bloco de presença no topo: "3 na água · 2 chegando".
- Acessibilidade: lista com `role="log"` e `aria-live="polite"` para leitor de tela
  anunciar mensagem nova sem roubar o foco.
- Estado vazio útil: "Ninguém relatou condição aqui hoje. Seja o primeiro" com
  botão que já abre o composer no tipo `condicao`.

## Ordem de implementação

1. Schema + `verify-sql.ts` (constraints, expiração, chave composta de presença).
2. `GET`/`POST /api/spots/[id]/messages` com `requireUser` e rate limit.
3. UI da aba no `SpotDetailModal` + polling adaptativo.
4. Presença (opt-in, anônimo por padrão).
5. Tipos especiais (`condicao` alimentando o card do spot).
6. Denúncia + soft delete + fila do admin.
7. Cron de limpeza física.

## Riscos

- **Spot vazio parece app morto.** Comunidade pequena, chat vazio desestimula.
  Mitigação: mostrar chat só nos spots com atividade, e o estado vazio precisa
  convidar à ação em vez de constatar o vazio.
- **Relato humano errado ou malicioso** ("tá ótimo" quando está perigoso). Mitigação:
  mostrar sempre ao lado da previsão do modelo, com autor e horário — nunca como
  verdade isolada.
- **Polling custa invocação na Vercel.** Com 50 usuários ativos a 15s são ~12k
  requisições/hora. Mitigação: intervalo adaptativo, pausa com aba oculta, e
  resposta 304/vazia barata quando não há novidade.
