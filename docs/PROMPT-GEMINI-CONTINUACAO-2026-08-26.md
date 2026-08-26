# Prompt para o Gemini — continuação do KiteNinja

Copie **todo o conteúdo abaixo** e entregue ao Gemini dentro do repositório local `C:\Users\Tarcyo Alves\kiteninja`.

---

Você vai continuar o desenvolvimento do **KiteNinja**, um aplicativo Next.js/React instalado no celular como PWA e também empacotado no Android com Capacitor. Trabalhe **diretamente no repositório local**:

```text
C:\Users\Tarcyo Alves\kiteninja
```

## 0. Regras obrigatórias antes de alterar qualquer coisa

1. Leia `CLAUDE.md` e `AGENTS.md`. Este projeto usa uma versão recente do Next.js com mudanças incompatíveis; antes de alterar APIs/convenções do Next, consulte a documentação local em `node_modules/next/dist/docs/`.
2. Leia `git status`, `git diff` e preserve **todas as alterações locais existentes**. Não use `git reset`, `git checkout --`, `git clean`, rebase ou qualquer operação destrutiva.
3. Há trabalho Android não commitado e já validado no Samsung. Não sobrescreva nem simplifique o Foreground Service, a fila SQLite ou os plugins Capacitor.
4. Não faça commit, push, deploy, publicação na Play Store nem migração destrutiva sem autorização explícita.
5. Não mostre segredos, cookies, tokens FCM, credenciais Firebase ou conteúdo de `.env`.
6. Não use mocks na funcionalidade final quando já há APIs e banco reais. Mocks são permitidos apenas em testes unitários.
7. Execute o trabalho em fases pequenas. Ao fim de cada fase rode testes direcionados, typecheck e build relevante. Se algo falhar, corrija antes de avançar.
8. Não confunda PWA com Android nativo:
   - no Android Capacitor, o Foreground Service continua rastreando com tela apagada/app minimizado/removido dos recentes;
   - no PWA/iOS, o rastreamento depende das limitações do navegador;
   - a notificação persistente do Android é obrigatória para Foreground Service e **não deve ser removida**.

## 1. Estado atual que já funciona e não pode regredir

O rastreamento Android de downwind foi reforçado e testado em aparelho real:

- Foreground Service nativo;
- fila persistente SQLite;
- drenagem FIFO;
- reenvio automático e backoff exponencial;
- recuperação quando a internet volta;
- recuperação após processo removido dos recentes;
- wake lock curto apenas durante o POST;
- limite operacional de 8h, com janela de drenagem no backend;
- limpeza terminal da fila;
- telemetria nativa;
- APK release `versionCode 2` instalado e funcionando.

Arquivos centrais que possuem alterações locais e devem ser preservados:

```text
android/app/src/main/java/br/com/kiteninja/app/RastreioDownwindService.java
android/app/src/main/java/br/com/kiteninja/app/tracking/DownwindTrackerPlugin.java
android/app/src/main/java/br/com/kiteninja/app/tracking/TrackingQueueDatabase.java
android/app/src/main/java/br/com/kiteninja/app/tracking/TrackingRetryPolicy.java
android/app/src/main/java/br/com/kiteninja/app/tracking/TrackingStateStore.java
android/app/src/main/AndroidManifest.xml
context/DownwindContext.tsx
lib/downwindTracker.ts
lib/downwindTracker.test.ts
views/DownwindAoVivoView.tsx
app/api/downwind/[id]/posicoes/route.ts
```

Antes das novas mudanças, a validação tinha:

- `npm run typecheck`: passou;
- `npm test`: 44 arquivos e 735 testes passaram;
- build Next de produção: passou;
- testes SQL/Postgres: passaram;
- `./gradlew testDebugUnitTest assembleRelease bundleRelease`: passou;
- APK instalado no Samsung sem crash.

## 2. Pedido do produto — ordem de prioridade

Implemente nesta ordem:

1. **P0 — corrigir a confirmação “Estou indo!” do SOS**, que hoje não chega ao autor do pedido de socorro.
2. **P0/P1 — simplificar a mensagem de rastreamento ao usuário**, removendo telemetria técnica da tela normal e mostrando apenas estado útil.
3. **P1 — criar um início rápido único no mapa**, com escolha entre velejo solo e downwind em grupo.
4. **P2 — permitir convidar pessoas para um velejo/downwind**, por usuário do app e por link, com notificação in-app e push.
5. Melhorar testes, acessibilidade e observabilidade de todos esses fluxos.

Não faça tudo em um único arquivo ou um componente monolítico.

---

# FASE 1 — Corrigir o SOS “Estou indo!”

## 3. Bug reproduzido e causa já confirmada

Com dois celulares:

1. usuário A dispara SOS;
2. o alerta abre corretamente no celular do usuário B;
3. B toca **“Estou indo!”**;
4. o banco provavelmente grava a resposta, mas A não recebe mensagem/aviso imediato.

Causa no código atual:

- `components/SosIncomingAlert.tsx`, em `handleRespond`, chama `onRespond(...)` sem `await`;
- a prop `onRespond` está tipada como retorno `void`, embora a implementação seja assíncrona;
- `context/KiteDataContext.tsx::respondToSos` captura e só registra erro no console, não devolve sucesso/falha para a UI;
- `app/api/sos/[id]/respond/route.ts` grava `sos_responders`, atualiza `sos_alerts.status`, mas **não envia push ao autor do SOS** e não cria um evento in-app específico;
- o autor só descobre via polling de `/api/sos/active` a cada 12s, e mesmo assim não existe uma confirmação visual interruptiva dizendo quem está indo.

## 4. Comportamento obrigatório do SOS

Ao tocar **“Estou indo!”**:

### No celular do socorrista

- o botão deve aguardar a Promise real;
- impedir toque duplo enquanto envia;
- obter localização atual quando possível, com timeout curto e sem bloquear a resposta se GPS falhar;
- enviar `{ state: 'a_caminho', lat?, lng? }`;
- mostrar confirmação clara: `Resposta enviada. <autor> foi avisado.`;
- fechar/diminuir o modal apenas depois do sucesso, ou oferecer `Ver no mapa`;
- em falha, manter o alerta aberto e mostrar erro legível com opção de tentar novamente;
- `Não posso` também deve aguardar o servidor antes de dispensar.

### No celular do autor do SOS

Receber imediatamente, por todos os canais aplicáveis:

1. **push FCM Android**;
2. **Web Push PWA**;
3. **aviso in-app interruptivo/toast**, mesmo com o app aberto;
4. atualização do painel SOS/mapa via revalidação imediata e polling como fallback.

Mensagem recomendada:

```text
<Nome> está a caminho
Alguém respondeu ao seu SOS. Acompanhe no mapa e mantenha contato com 193/185.
```

Se a pessoa tocar `Não posso`, não precisa enviar push ao autor, salvo se ela era o último responsável vivo e o SOS voltou ao estado `ativo`; nesse caso o autor pode receber um aviso in-app discreto de que o atendimento ficou sem responsável.

## 5. Implementação recomendada do SOS

### Backend

Alterar `app/api/sos/[id]/respond/route.ts` para, depois da escrita transacional lógica:

- quando `state === 'a_caminho'` ou `state === 'no_local'`, chamar `sendPushToUsers([sosAuthorId], payload)` de `lib/push.ts`;
- `title`: `${user.name} está a caminho` ou `${user.name} chegou ao local`;
- `body`: mensagem curta e segura;
- `tag`: `sos-resposta-${sosId}`;
- `url`: `/?tab=mapa&sos=${sosId}`;
- `requireInteraction: true`;
- push é best-effort: falha de FCM/Web Push **não pode desfazer** a resposta gravada;
- registrar sucesso/falha em `logSos`, sem dados sensíveis;
- manter idempotência: repetir exatamente o mesmo estado não deve gerar rajada infinita de push. Sugestões aceitáveis:
  - consultar estado anterior e notificar apenas na transição para `a_caminho`/`no_local`; ou
  - criar uma chave de deduplicação/evento; ou
  - usar coluna/tabela de evento com constraint única.

### Evento in-app

A tabela `notifications` atual só suporta tipos sociais e exige `session_id/comment_id`. Não force SOS dentro de tipos sociais improvisados.

Escolha uma arquitetura explícita:

**Opção recomendada:** criar uma tabela/event stream separada, por exemplo `sos_events`:

```text
id UUID PK
sos_id UUID FK
recipient_id UUID FK
actor_id UUID FK
kind TEXT CHECK ('responder_a_caminho','responder_no_local','responder_desistiu')
created_at TIMESTAMPTZ
read_at TIMESTAMPTZ NULL
UNIQUE(sos_id, actor_id, kind) quando adequado à deduplicação
```

Ou estenda `notifications` com `sos_id` e novos tipos, mas faça migração idempotente correta, atualize CHECK, types, API e UI. Não deixe `lib/schema.sql` divergente da migração real.

O endpoint `/api/sos/active` já entrega `responders`; garanta que o autor veja imediatamente os novos dados. No cliente, após push/deep link ou evento in-app, executar `fetchActiveSos()`.

### Frontend

- mudar a assinatura de `onRespond` em `components/SosIncomingAlert.tsx` para:

```ts
(sosId: string, state: 'a_caminho' | 'nao_posso') => Promise<{ ok: boolean; error?: string }>
```

ou lançar erro e retornar `Promise<void>`, mas o contrato deve ser realmente assíncrono;
- `await onRespond(...)`;
- estado separado de `respondingState`, erro e sucesso;
- não ocultar erro no `console.error` apenas;
- atualizar `context/KiteDataContext.tsx::respondToSos` para devolver resultado;
- criar aviso in-app para o autor quando algum responder muda para `a_caminho`/`no_local`, sem reabrir repetidamente o mesmo aviso em cada polling;
- deduplicar pelo par `sosId + responderId + state/respondedAt`.

### Segurança e privacidade

- preserve `podeResponderSos` e todas as regras existentes;
- nunca aceite `sosAuthorId` vindo do cliente;
- a coordenada do socorrista enviada no body é opcional e deve continuar validada;
- não exponha coordenadas do autor a quem não estiver autorizado;
- push nunca deve incluir latitude/longitude cruas;
- SOS continua funcionando mesmo sem push configurado.

### Testes obrigatórios do SOS

Adicionar/atualizar testes para:

1. `a_caminho` grava estado e muda SOS para `em_atendimento`;
2. envia push ao **autor**, não aos outros responders;
3. payload contém nome, URL e tag corretos;
4. repetição idempotente não duplica push;
5. falha de push não transforma resposta em erro HTTP;
6. `nao_posso` não envia confirmação falsa;
7. último responsável desistindo volta SOS para `ativo`;
8. usuário não autorizado continua recebendo 403;
9. frontend aguarda Promise e mostra erro;
10. autor recebe atualização in-app sem esperar 12s, com polling como fallback.

---

# FASE 2 — Status de localização simples e útil

## 6. Problema de UX atual

Em `views/DownwindAoVivoView.tsx`, após a faixa de ações, existe um card grande com frases como:

```text
Rastreamento nativo ATIVO: enviando posição com tela apagada, minimizado e app fechado.
Fila offline: 0 pts
Último envio: ...
Status: ...
Descartes...
Rastreio encerrado...
```

Isso é telemetria de desenvolvedor e não precisa ocupar a tela do usuário durante o velejo. Também há no `ModoNavegacao` o rótulo em caixa alta `RASTREAMENTO ATIVO/EM RISCO`, que pode ser simplificado.

## 7. Novo comportamento visual

Substituir o card técnico por um **indicador compacto**, próximo ao topo/faixa de sinal ou integrado ao mapa, com no máximo uma linha principal e uma linha de detalhe quando necessário.

Estados de produto:

### Verde — enviando

```text
● Localização sendo compartilhada
Último envio agora
```

Condição sugerida:

- serviço nativo rodando;
- envio recente dentro do limite saudável;
- sem erro terminal.

### Amarelo — offline, mas protegido

```text
● Sem internet — posições salvas no aparelho
Serão enviadas quando a conexão voltar
```

Condição sugerida:

- serviço rodando;
- `pendingCount > 0` ou erro temporário de rede;
- não tratar offline como falha fatal.

### Vermelho — interrompido

```text
● Localização não está sendo enviada
Toque para tentar novamente
```

Condição sugerida:

- serviço deveria estar rodando, mas `isServiceRunning === false`;
- permissão negada;
- erro terminal/token inválido;
- último envio excessivamente atrasado e nenhuma fila segura confirmada.

### Cinza — iniciando

```text
● Ativando localização…
```

## 8. Regras do status

- não mostrar `downwindId`, token, nome de classe, “nativo”, “Foreground Service”, contadores internos, `lastStopReason` cru ou stack trace;
- não dizer “app fechado” na UI normal;
- telemetria completa pode ficar atrás de uma seção **Diagnóstico técnico** acessível apenas em admin/debug, nunca no fluxo principal;
- mostrar o atalho de bateria apenas quando realmente necessário e de maneira discreta, por exemplo em `Ajuda`/`Configurar bateria`, não como card permanente;
- preservar `role="status"` e acessibilidade;
- não remover a notificação persistente Android: em `RastreioDownwindService.java`, o texto atual `Sua localização está sendo compartilhada com o grupo` já é adequado;
- a notificação Android deve continuar com ação/parada segura conforme já implementado;
- PWA/iOS deve mostrar uma mensagem honesta diferente quando não puder garantir background.

Centralize a derivação em função pura testável, por exemplo:

```ts
type EstadoCompartilhamento =
  | { kind: 'iniciando'; titulo: string }
  | { kind: 'enviando'; titulo: string; detalhe?: string }
  | { kind: 'offline'; titulo: string; detalhe: string }
  | { kind: 'interrompido'; titulo: string; detalhe?: string; podeTentar: boolean };
```

Não espalhe condicionais de telemetria pelo JSX.

---

# FASE 3 — Um único botão “INICIAR” no mapa

## 9. Objetivo de produto

Hoje `views/MapView.tsx` tem um botão flutuante **INICIAR** que entra diretamente no `ModoNavegacao` como velejo solo. Já o downwind nasce pela tela `Eventos & Ocorrências`, com formulário mais demorado.

Novo fluxo:

1. usuário toca **INICIAR** no mapa;
2. abre um bottom sheet/modal rápido chamado, por exemplo, `IniciarAtividadeSheet`;
3. mostra escolhas grandes e claras:

```text
Velejo solo
Rastrear minha sessão agora

Downwind em grupo
Criar/entrar numa travessia com mapa compartilhado

Entrar por convite
Abrir um link/código recebido
```

Se já existir downwind ativo para o usuário, a opção principal deve ser:

```text
Continuar downwind
```

Nunca permita duas atividades simultâneas.

## 10. Arquitetura recomendada

Criar componentes focados:

```text
components/activity/IniciarAtividadeSheet.tsx
components/activity/IniciarVelejoSoloSheet.tsx
components/activity/CriarDownwindRapidoSheet.tsx
components/activity/ConvidarVelejadoresSheet.tsx
lib/activity.ts              # máquina/decisões puras
```

Ou nomes equivalentes em português, mantendo coesão.

O `MapView` deve apenas controlar abertura e receber callbacks; não coloque formulário, requests e lógica de convites diretamente nele.

## 11. Velejo solo rápido

Ao escolher **Velejo solo**:

- iniciar imediatamente o `ModoNavegacao` existente;
- usar o spot mais próximo/selecionado como contexto, sem exigir formulário antes de entrar na água;
- ao finalizar, continuar usando `ResumoNavegacao`, `paraPrefillLogbook` e `SessionLoggerModal`;
- transformar o formulário final em “completar dados”, mantendo distância/duração/velocidade/trilha medidas pelo GPS;
- permitir `Salvar rápido` com defaults reais do perfil/último equipamento, mas nunca preencher números fictícios como se fossem medidos;
- não criar registro público antes de o usuário confirmar ao final.

## 12. Downwind rápido

Ao escolher **Downwind em grupo**, oferecer:

### A. Continuar/entrar em downwind existente

- mostrar downwinds abertos/em andamento relevantes ao usuário;
- se foi convidado, mostrar convite pendente primeiro;
- entrar com confirmação simples;
- não mostrar downwinds encerrados como ingressáveis;
- corrigir a inconsistência atual em `views/EventsAndAlertsView.tsx`: o botão genérico `Quero Participar` de `event_registrations` não deve aparecer para downwind encerrado/cancelado. `Ver Resumo` pode permanecer.

### B. Criar downwind rápido

Pré-preencher:

- nome: `Downwind em <spot/data>` editável;
- saída: spot selecionado/mais próximo;
- chegada: opcional;
- horário: agora ou escolha rápida `Agora`, `Em 30 min`, `Escolher horário`;
- visibilidade: `Somente convidados` por padrão para segurança, ou `Comunidade` se o modelo atual exigir evento público;
- papel do criador: `velejador`, `eh_organizador=true`.

Fluxo ideal em duas etapas curtas:

1. **Dados essenciais**: saída, chegada opcional, horário;
2. **Convidar**: pessoas do app, copiar link, compartilhar pelo sistema.

Depois de criar:

- entrar automaticamente no downwind;
- se horário for “Agora”, oferecer `Iniciar travessia` com confirmação;
- não iniciar GPS para convidados que ainda não confirmaram/não estão navegando;
- preservar máquina de estados `aberto -> em_andamento -> encerrado/cancelado`.

## 13. Backend da criação rápida

O fluxo atual cria downwind em `POST /api/events` e exige permissão `requireDownwindOrganizer()`. Não duplique regras em duas rotas divergentes.

Escolha uma destas soluções:

### Solução recomendada

Extrair `createDownwindEvent` de `app/api/events/route.ts` para um service server-only, por exemplo:

```text
lib/downwindCriacao.ts
```

E reutilizá-lo tanto na rota de Eventos quanto numa eventual rota dedicada `/api/downwind`.

O service deve:

- validar autorização;
- validar spots/data;
- criar evento + downwind + organizador;
- fazer compensação se qualquer passo falhar, como o código atual já tenta fazer;
- retornar `eventId` e `downwindId`;
- não deixar evento órfão.

Antes de abrir criação a todo rider, decida explicitamente a política. Hoje existe `users.pode_organizar_downwind` e `requireDownwindOrganizer()`. Não remova a autorização silenciosamente. Se o produto quer que qualquer usuário crie um grupo privado, crie uma regra distinta e segura para **downwind privado**, sem conceder capacidade de criar evento público oficial.

Sugestão:

- `visibility = 'privado' | 'comunidade'`;
- qualquer rider ativo pode criar `privado` com rate limit;
- apenas roles/permissão atual podem criar `comunidade`;
- atualizar schema, authz e testes.

---

# FASE 4 — Convites para velejo/downwind

## 14. Casos de uso

O organizador deve poder convidar:

1. **usuário já cadastrado**, pesquisando por nome/rider ID;
2. **por link**, para usuário autenticado abrir e aceitar;
3. opcionalmente compartilhar o link pelo Web Share API/Android share sheet;
4. **apoio em terra sem conta**, preservando o link especial de 12h já existente.

Não misture o convite de velejador autenticado com o link de apoio sem conta.

## 15. O que já existe e deve ser reaproveitado

Já há:

```text
app/api/downwind/[id]/convites/route.ts
app/api/downwind/convite/[token]/entrar/route.ts
app/dw-motorista/[token]/...
downwind_convites
app/api/riders/search/route.ts
lib/push.ts::sendPushToUsers
fcm_tokens
push_subscriptions
```

Mas `downwind_convites` hoje é usado principalmente para apoio em terra sem conta e cria conta guest. Para velejador cadastrado, implemente um fluxo autenticado separado ou estenda o modelo de forma explícita.

## 16. Modelo recomendado para convite de usuário

Criar tabela idempotente, por exemplo:

```text
downwind_user_invites
- id UUID PK
- downwind_id UUID FK CASCADE
- inviter_id UUID FK
- invitee_id UUID FK
- role TEXT CHECK ('velejador','apoio_terra')
- status TEXT CHECK ('pendente','aceito','recusado','cancelado','expirado')
- token_hash TEXT UNIQUE NULL       # preenchido quando também há link
- expires_at TIMESTAMPTZ
- responded_at TIMESTAMPTZ NULL
- created_at TIMESTAMPTZ
- UNIQUE(downwind_id, invitee_id) para convite ativo, conforme regra escolhida
```

Requisitos:

- convite só pode ser criado por organizador do downwind/moderação;
- não convidar o próprio usuário;
- não convidar quem já participa;
- aceitar é operação do `invitee_id`, nunca por ID arbitrário do cliente;
- recusar/cancelar é auditável;
- expiração real;
- aceitar insere/atualiza `downwind_participantes` idempotentemente;
- convite para downwind encerrado/cancelado não pode ser aceito;
- link não guarda token em claro no banco; usar `hashToken`;
- rate limit para criação e aceite.

## 17. APIs sugeridas

```text
POST   /api/downwind/[id]/invites
GET    /api/downwind/[id]/invites
POST   /api/downwind/invites/[inviteId]/accept
POST   /api/downwind/invites/[inviteId]/decline
DELETE /api/downwind/invites/[inviteId]
GET    /api/downwind/invite/[token]
POST   /api/downwind/invite/[token]/accept
```

Os nomes podem ser em português para seguir o projeto, mas mantenha consistência.

Payload de criação por usuário:

```json
{
  "inviteeUserId": "uuid",
  "role": "velejador"
}
```

Resposta deve ser pobre em dados e nunca expor e-mail privado desnecessariamente.

## 18. Notificações de convite

Ao convidar usuário cadastrado:

- criar notificação in-app `convite_downwind`;
- enviar FCM/Web Push best-effort;
- título: `<Nome> convidou você para um downwind`;
- corpo: `<saída> → <chegada>` ou nome/data;
- URL/deep link: `/?tab=alertas&downwindInvite=<inviteId>`;
- ações na UI: `Aceitar`, `Recusar`, `Ver detalhes`;
- aceitar deve abrir/continuar o downwind;
- deduplicar push para o mesmo convite;
- não notificar novamente a cada polling.

Estenda conscientemente a central de notificações:

- `types.ts::AppNotification`;
- `lib/schema.sql` CHECK;
- migração real;
- `lib/notificacoes.ts` ou um helper específico de convite;
- `app/api/notifications/route.ts` joins/campos;
- `components/NotificationCenterModal.tsx` mensagem, ícone e navegação;
- contador de não lidas;
- testes de authz.

## 19. Link e compartilhamento

No `ConvidarVelejadoresSheet`:

- botão `Convidar no app` com busca debounced em `/api/riders/search`;
- botão `Copiar link`;
- botão `Compartilhar` usando `navigator.share` quando disponível;
- fallback para clipboard;
- mostrar validade e tipo do convite;
- não expor token em logs/analytics;
- depois de copiar/compartilhar, mostrar confirmação acessível;
- QR code pode ser fase posterior, não é obrigatório agora.

Preservar separado:

- **Convidar velejador**: conta existente ou link que exige login;
- **Convidar apoio**: link guest de 12h já existente, com escopo restrito.

---

# FASE 5 — Estados, concorrência e recuperação

## 20. Máquina de atividade única

Crie função pura que determine o CTA principal:

```ts
type AtividadeAtual =
  | { kind: 'nenhuma' }
  | { kind: 'solo_local' }
  | { kind: 'downwind_aberto'; downwindId: string }
  | { kind: 'downwind_navegando'; downwindId: string };
```

Regras:

- não iniciar solo se existe downwind `navegando`;
- não iniciar segundo downwind se já há um ativo;
- se sessão solo local estiver ativa e chegar convite, aceitar pode ficar pendente até encerrar solo;
- recarregar app deve recuperar downwind do servidor e rastreamento nativo;
- sessão solo que existe só em memória deve avisar antes de ser abandonada;
- ações devem ser idempotentes em toque duplo/rede instável;
- botões têm loading e permanecem desabilitados durante request;
- mensagens de erro devem ser visíveis, nunca apenas `console.error`.

## 21. Acessibilidade e mobile

- alvos de toque com pelo menos 44px;
- `aria-label`, foco e `role="dialog"` corretos;
- respeitar safe areas e teclado virtual;
- testar viewport de 375×812 e Android 720×1600;
- não recriar a tarja escura no rodapé: leia comentários de `app/globals.css`, `app/globals.layout.test.ts`, `ModoNavegacao` e overlays;
- bottom sheet não deve deslocar `window.scrollY`;
- sem texto técnico em caixa alta desnecessária;
- modo sol forte/alto contraste deve continuar legível.

---

# FASE 6 — Testes e validação

## 22. Testes unitários e de integração

Cobrir no mínimo:

### Rastreamento/status

- função pura transforma telemetria em `enviando/offline/interrompido/iniciando`;
- fila pendente + serviço ativo = offline protegido, não vermelho fatal;
- permissão negada = interrompido;
- UI não contém textos técnicos antigos na tela normal;
- notificação Android/Foreground Service não foi removida.

### Início rápido

- INICIAR abre seletor;
- solo inicia `ModoNavegacao` sem formulário prévio;
- downwind ativo mostra `Continuar`;
- atividade concorrente é bloqueada;
- downwind encerrado não mostra `Quero Participar` nem CTA de entrada;
- criação rápida preenche defaults e não inventa medição GPS.

### Convites

- apenas organizador/moderação convida;
- próprio usuário e participante existente são rejeitados;
- aceitar/recusar é idempotente;
- aceitar encerrado/cancelado retorna 409;
- link usa hash e expira;
- push/in-app vai ao convidado correto;
- deep link abre a tela correta;
- guest apoio continua restrito ao próprio downwind.

### SOS

Todos os 10 casos da Fase 1.

## 23. Comandos mínimos de validação

No diretório raiz:

```bash
npm run typecheck
npm test
npm run build
git diff --check
```

Se alterar SQL/authz:

```bash
npm run verify:sql
npm run verify:sos
```

Use os scripts reais definidos em `package.json`; se o nome diferir, leia o arquivo e execute o equivalente.

Se alterar Android:

```bash
cd android
./gradlew testDebugUnitTest assembleRelease bundleRelease --no-daemon
```

Não gere nova versão Android se só mudar React/Next servido remotamente e a arquitetura do app não exigir bundle novo; confirme como `capacitor.config.ts` está configurado antes de concluir.

## 24. Teste manual obrigatório com dois celulares

Depois de implementação e deploy autorizado:

1. A dispara SOS;
2. B recebe alerta;
3. B toca `Estou indo`;
4. B vê confirmação real após resposta HTTP;
5. A recebe push mesmo com app em background;
6. com A aberto, aviso in-app aparece sem esperar 12s;
7. A abre mapa e vê B como responder;
8. B toca `Não posso`; se era o último, SOS volta a procurar ajuda;
9. repetir toque não gera notificações duplicadas.

Downwind:

1. usuário A toca INICIAR > Downwind em grupo;
2. cria privado com defaults;
3. convida B no app;
4. B recebe push e notificação in-app;
5. B aceita;
6. A e B aparecem como participantes;
7. A inicia;
8. localização mostra estado simples;
9. desligar internet: mostra `posições salvas`;
10. religar: fila drena e volta para `Localização sendo compartilhada`;
11. remover app dos recentes: Android continua rastreando;
12. encerrar limpa serviço e fila terminal.

Solo:

1. INICIAR > Velejo solo;
2. entra imediatamente no modo navegação;
3. sai com trilha real;
4. formulário final vem preenchido apenas com dados medidos;
5. salva sessão corretamente.

## 25. Entrega esperada

Ao terminar, responda com:

1. resumo objetivo do que foi implementado;
2. causa raiz do bug SOS e como foi corrigido;
3. arquivos alterados;
4. migrações/schema adicionados;
5. testes executados e resultados numéricos;
6. o que foi testado em aparelho real e o que ainda depende de teste manual;
7. riscos/pendências reais, sem dizer que está pronto se algo não foi validado;
8. `git status --short` final;
9. não faça commit/push sem autorização.

## 26. Restrições finais — não negociar

- não remover a notificação persistente Android do Foreground Service;
- não pedir `ACCESS_BACKGROUND_LOCATION` se o fluxo continua iniciando o Foreground Service com o app visível; isso aumenta risco de Play Store e não é necessário para este desenho;
- não apagar telemetria: esconda da UX normal e preserve diagnóstico técnico;
- não fingir entrega de push: banco atualizado não significa notificação entregue;
- não fechar modal de SOS antes de confirmação do servidor;
- não inventar GPS, vento, distância ou velocidade;
- não tornar todo downwind público por padrão;
- não permitir que convite contorne autorização/privacidade;
- não quebrar PWA enquanto melhora Android;
- não sobrescrever alterações locais existentes.

Comece lendo o estado atual e apresente um plano curto por fases. Em seguida implemente **primeiro a Fase 1 (SOS)** e valide antes de iniciar as demais.
