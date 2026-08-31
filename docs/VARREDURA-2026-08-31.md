# Varredura — 31/08/2026

Caça a defeitos ainda não vistos. O método foi deliberado: em vez de reler o
app inteiro (a auditoria Antigravity já fez isso), procurei **as classes de
defeito que já se provaram reais neste repositório**. Onde um erro apareceu
uma vez, a chance de aparecer de novo é maior que a média.

## Resultado

| # | Achado | Gravidade | Situação |
|---|---|---|---|
| V-01 | `/api/downwind/[id]/live` expunha trilha GPS de downwind **privado** | **Alta — privacidade** | ✅ Corrigido |
| V-02 | Badge do sininho não zerava, e o poll o ressuscitava | Média — UX | ✅ Corrigido |
| V-03 | Viewer ao vivo baixa o histórico inteiro a cada 5s, sem teto nem cursor | Média — custo | ✅ Corrigido |
| V-04 | `latestIncomingDm` populado e nunca consumido | Baixa | ✅ Corrigido |
| V-05 | Poll do sininho baixa a lista inteira só para ler um número | Baixa — custo | ✅ Corrigido |

Classes varridas que vieram **limpas**: `UPDATE`/`DELETE` sem `RETURNING`
usados como contagem (o defeito de `trackingToken`, não reincidiu);
composição de fragmento `sql` (o teste `sqlComposicao.test.ts` cobre); rotas
de API sem nenhuma checagem de autenticação além das públicas conhecidas.

---

## V-01 — Trilha GPS de downwind privado exposta a quem tivesse o UUID

**O mais grave, e o mais fácil de não ver.**

`GET /api/downwind/[id]/live` não tinha checagem nenhuma. Devolvia, para
qualquer visitante:

- nome e avatar de todos os participantes;
- a **trilha GPS completa** da travessia — cada posição, com hora, velocidade,
  direção e nível de bateria.

O detalhe que torna isto um defeito e não uma decisão: a rota **lia**
`d.visibilidade`, devolvia o valor no payload… e nunca o verificava.

O app já tinha o controle de privacidade funcionando:

- `components/activity/CriarDownwindModal.tsx` tem o seletor privado/comunidade;
- a coluna nasce `'privado'` (`lib/schema.sql`) e o modal vem com `privado`
  pré-selecionado;
- `GET /api/events` **respeita** a escolha (`WHERE ... d.visibilidade =
  'comunidade' OR d.criado_por = ...`).

Só esta rota ignorava. Ou seja: **o organizador escolhia "privado" e não
ganhava privacidade nenhuma.** É o pior formato de falha de segurança — a
interface promete uma proteção que não existe, então ninguém procura o
problema.

### Por que passou pela auditoria anterior

Duas razões, e as duas valem registrar:

1. A rota **não existia** quando a auditoria Antigravity rodou. Ela responde
   "a localização está protegida? **Sim**" (pergunta 7), e isso era verdade
   naquele momento. Auditoria tem data de validade.
2. `lib/authz.test.ts` tinha uma justificativa registrada para a rota:
   *"consulta pública/espectador das posições e telemetria"*. A frase descreve
   a intenção e passa a impressão de decisão consciente — então um revisor
   seguinte pularia a rota. **Uma exceção documentada é um lugar onde ninguém
   olha de novo.** A justificativa foi reescrita dizendo o que a rota de fato
   faz e o que ela deixava de fazer.

### Correção

`podeVerReplayAoVivo` em `lib/downwindAcesso.ts` (função pura, 8 testes em
`lib/replayAoVivo.test.ts`):

- `comunidade` → espectador aberto, sem sessão. É para isso que a opção existe.
- `privado` → exige sessão E participação (ou moderação).
- Quem não pode ver recebe **404**, não 403 — mesma regra do resto do domínio:
  a resposta não confirma que o downwind existe.

A trava fica **antes** de qualquer query de posição: daí para baixo tudo que se
lê é rastro de gente real.

Convidado do link de 12h continua enxergando só o downwind ao qual foi
escopado.

> **UUID não é credencial.** Não é adivinhável por força bruta, mas também não
> é segredo: aparece em link compartilhado, histórico do navegador, print de
> tela e cabeçalho `Referer`. Tratar "só quem tem o id" como autorização é
> confundir identificador com senha.

---

## V-02 — Badge do sininho não zerava, e o poll o trazia de volta

`zerarNotificacoesNaoLidas` existia no contexto, com comentário explicando que
serve para "zerar o contador na hora que a central abre (otimista)" — e
**nunca era chamado por ninguém**.

Consequência: você abria as notificações, o servidor marcava tudo como lido, e
o badge continuava aceso por **até 20 segundos** (o intervalo do poll).

Havia uma segunda camada, pior: se a resposta do poll já estivesse **em voo**
quando o `POST` de "marcar como lidas" chegou, ela trazia a contagem antiga e
**acendia o badge de novo** — depois de já ter apagado.

### Correção

- Chamada ao abrir (sininho do Header e item do menu lateral) e ao fechar.
- Guarda de corrida com o mesmo padrão que o projeto já usa (`versaoRef` em
  `DownwindContext`): o poll registra quando o pedido saiu e descarta a
  resposta se ela é anterior à leitura do usuário.

Só chamar a função não bastava — sem a guarda, a corrida continuaria.

---

## V-03 — Viewer ao vivo baixava o histórico inteiro a cada 5 segundos

**Corrigido.**

`DownwindLiveReplayViewer` faz poll a cada 5s, e `GET /api/downwind/[id]/live`
devolvia **todas** as posições da travessia toda vez — sem `LIMIT`, sem cursor.

Conta de uma travessia de 3h com 10 velejadores reportando a cada 45s:
~2.400 linhas por resposta, 720 respostas por hora **por espectador**. E o
payload crescia ao longo da travessia — ficava maior justamente no fim, quando
mais gente está assistindo.

O que chamava atenção: a rota irmã `GET /api/downwind/[id]/posicoes` **já
resolvia isso** — cursor `desde`, teto e amostragem, tudo em
`lib/trilhaDownwind.ts`. A tela nova reimplementou o problema sem reaproveitar
a solução que estava ao lado.

### O que mudou

- **Carga inicial** (sem `?desde=`): trilha completa, mas **amostrada** por
  participante. A amostragem é uniforme e preserva sempre o ponto mais
  recente, então a forma do trajeto se mantém e o payload para de crescer sem
  limite com a duração.
- **Polls seguintes**: só o delta (`?desde=<cursor>`), com teto proporcional ao
  tamanho do grupo. O viewer **mescla** em vez de substituir.
- Os helpers viraram genéricos (`amostrarPontos`, `mesclarPontos`) porque esta
  tela usa pontos de 4 elementos (`[lat, lng, velocidade, ts]`) e
  `PontoTrilha` tem 3. `amostrarTrilha`/`mesclarTrilha` passaram a delegar —
  a regra sutil de "preservar sempre o mais recente" continua existindo em um
  lugar só, em vez de virar duas cópias para divergir.

### Um bug que quase entrou junto

Tornar a rota incremental faria `ultimaPosicao` vir de um lote que só contém
quem reportou naquele intervalo. Resultado: todo participante que ficou quieto
apareceria com `ultimaPosicao: null` e **o marcador dele sumiria do mapa** — de
quem parou de reportar, que é exatamente quem mais importa vigiar numa
travessia.

A última posição passou a vir de query própria com `LEFT JOIN LATERAL`, uma
linha por participante, independente do delta — mesmo padrão que a rota irmã
já usava.

### Nota sobre resposta parcial

Quando o delta bate no teto, a resposta vem marcada como `parcial` e o cursor
**não salta** — o próximo poll continua de onde parou, sem buraco na trilha.

Chegou a existir um reagendamento imediato (300ms) para fechar o vão mais
rápido. Foi removido: `parcial` só ocorre quando um delta passa de 60 pontos
por participante (ou seja, aba fechada por muito tempo), e a implementação
exigia guardar a própria função num ref — padrão que a regra
`react-hooks/refs` do React 19 acusa, com razão. Trocar 5s de atraso num caso
raro por um padrão frágil não valia.

## V-04 — `latestIncomingDm` populado e nunca consumido

**Corrigido.**

O watcher de DM preenchia `latestIncomingDm` no contexto a cada ciclo e
**nenhum componente lia**. Efeito prático: mensagem no chat geral mostrava
toast (`InAppPushToast`), DM não — só incrementava o badge. Quem recebia uma
conversa direta com o app aberto noutra aba não via nada acontecer.

Era a terceira ocorrência desta mesma classe nesta base (`statusTrackingNativo`
e `zerarNotificacoesNaoLidas` foram as outras).

### O que mudou, e por que num componente só

O aviso de DM entrou no **mesmo** `InAppPushToast`, não num componente irmão.
Criar um segundo toast resolveria a falta, mas abriria outro problema: os dois
ocupam a mesma posição da tela e podem chegar juntos — apareceriam
sobrepostos. Um componente só escolhe o mais recente e mostra **um**.

A escolha virou função pura testada (`escolherAvisoMaisRecente` em
`lib/toastMensagem.ts`). A regra não é óbvia: compara o **horário da
mensagem**, não a ordem de chegada ao cliente. Os dois watchers fazem poll
independente, então uma DM mais nova pode chegar ao navegador **depois** de
uma mensagem de chat mais velha — ordenar por chegada mostraria a errada. No
empate exato a DM vence, por ser endereçada à pessoa e não a uma sala.

Detalhes que evitam bugs conhecidos:

- `latestIncomingDm` ganhou `createdAt`. Sem identidade estável, o toast não
  teria como saber que já mostrou aquela DM e reapareceria a cada re-render —
  exatamente o bug de `docs/BUG-TOAST-MENSAGEM-REPETIDO.md`. O id da DM é
  `dm:<remetente>:<createdAt>`, porque `/api/chat/dms` devolve a última
  mensagem da conversa, sem id próprio.
- Fechar ou tocar no aviso **consome** o evento nos dois canais.
- A DM leva um selo "DIRETA". Sem ele o aviso seria idêntico ao do chat geral,
  e a pessoa tocaria esperando cair na conversa privada.

### Limite conhecido

Tocar no aviso de DM leva à **aba de chat**, não à conversa específica. Abrir
uma DM direto exigiria expor esse controle no contexto — hoje a sala só é
montada dentro de `views/ChatView.tsx` — e isso é mudança de outro tamanho. O
destino atual é o mesmo que o sininho já usava.

---

## V-05 — Poll do sininho baixava a lista inteira para ler um número

**Corrigido.**

O watcher chamava `GET /api/notifications` a cada 20s e usava **apenas**
`body.naoLidas`. A rota devolvia junto a lista completa de notificações, com
todos os JOINs de autor, sessão, comentário e downwind. Custo desnecessário
multiplicado por usuário logado — e compute do Neon é o maior custo apontado
em `docs/ANTIGRAVITY-AUDIT-2026.md` (resposta 20).

Agora `GET /api/notifications?apenasContagem=1` devolve só o número, com um
`COUNT(*)` e nenhum JOIN.

Parâmetro em vez de rota nova de propósito: é a mesma informação, do mesmo
dono, com a mesma autorização — separar em duas rotas duplicaria o
`requireUser` e o filtro por `recipient_id` sem ganhar nada, e criaria dois
lugares para esquecer de proteger.

---

## O que esta varredura sugere sobre o processo

Os cinco achados foram corrigidos. Mais importante que a lista é o padrão que
ela expôs.

**Três dos cinco eram estado exposto e nunca consumido, ou função definida e
nunca chamada** — `latestIncomingDm`, `zerarNotificacoesNaoLidas` e (na rodada
anterior) `statusTrackingNativo`. Nenhum deles quebra build, typecheck, teste
ou lint: **todos passam verdes com o defeito presente**. É por isso que
sobreviveram a várias rodadas de revisão automática.

Varredura periódica barata para essa classe:

```bash
# campo do contexto sem nenhum consumidor fora do próprio arquivo
grep -rn "<campo>" components/ views/ app/ lib/
```

E a regra de revisão que evitaria a maioria: **ao expor algo num contexto,
mostrar na mesma mudança quem consome.** Sem consumidor, o valor não deveria
estar exposto — vira promessa que a interface não cumpre, e quem vier depois
assume que funciona.

**Os outros dois eram desperdício silencioso** (V-03 e V-05): código correto,
resultado certo na tela, custo multiplicado por usuário e por segundo. Nenhuma
ferramenta reclama disso — só olhar o que a tela realmente precisa contra o
que a rota realmente devolve.

Nos dois casos a solução **já existia ao lado**: o V-03 reimplementou um
problema que `lib/trilhaDownwind.ts` resolvia para a rota irmã, e o V-05
baixava um payload que ninguém lia. Vale como pergunta de revisão em rota
nova: *isto já foi resolvido aqui perto?* e *quem chama usa tudo o que estou
devolvendo?*

## Uma nota sobre auditorias

O achado mais grave (V-01) estava numa rota que **não existia** quando a
auditoria anterior rodou — e aquela auditoria afirmava, corretamente para o
momento, que a localização estava protegida.

Some-se a isso o segundo motivo: a rota tinha uma **exceção documentada** no
`authz.test.ts`, e uma exceção documentada é um lugar onde ninguém olha de
novo.

As duas coisas juntas sugerem que auditoria não é evento, é rotina — e que
exceções registradas merecem releitura periódica justamente por parecerem
resolvidas.

---

## Adendo — o que a varredura seguinte encontrou no próprio CI

Depois de fechar os achados acima e zerar os 50 erros de lint do React 19
(ver `docs/REACT19-REGRAS-COMPILADOR.md`), sobrou uma pergunta óbvia que
ninguém tinha feito: **por que o CI estava vermelho?**

A resposta não tinha nada a ver com o código dos commits. Dois jobs falhavam
por conta própria, e havia tempo:

- **Build** — `next build` sem `DATABASE_URL`. O passo tinha o comentário
  "DATABASE_URL ausente = pulamos a migração", que já não valia: `lib/db.ts`
  lança no carregamento do módulo, e o `next build` importa toda rota de API
  para coletar os dados de página. Corrigido com uma connection string de
  mentira apontando para localhost — as rotas são dinâmicas, nenhuma conexão
  é aberta durante o build.
- **Android** — `NODE_VERSION: '20'`, e o CLI do Capacitor recusa NodeJS < 22
  (`[fatal] The Capacitor CLI requires NodeJS >=22.0.0`). O `cap sync` morria
  antes de compilar qualquer coisa.

O padrão vale a nota: **um CI cronicamente vermelho deixa de ser sinal.**
Enquanto os dois jobs falhavam por motivo próprio, uma regressão de verdade
em Build ou Android teria passado despercebida — não haveria mudança de cor
para reparar. E o comentário desatualizado no workflow ("pulamos a migração")
é o mesmo tipo de armadilha da "exceção documentada" citada acima: um lugar
onde alguém já explicou, e por isso ninguém olha de novo.
