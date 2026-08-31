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
| V-03 | Viewer ao vivo baixa o histórico inteiro a cada 5s, sem teto nem cursor | Média — custo | ❌ Aberto |
| V-04 | `latestIncomingDm` populado e nunca consumido | Baixa | ❌ Aberto |
| V-05 | Poll do sininho baixa a lista inteira só para ler um número | Baixa — custo | ❌ Aberto |

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

## V-03 — Viewer ao vivo baixa o histórico inteiro a cada 5 segundos

**Aberto.** Precisa de decisão antes de mexer.

`components/downwind/DownwindLiveReplayViewer.tsx` faz poll a cada 5s, e
`GET /api/downwind/[id]/live` devolve **todas** as posições da travessia toda
vez — sem `LIMIT`, sem cursor.

Conta de uma travessia de 3h com 10 velejadores reportando a cada 45s:
~2.400 linhas por resposta, 720 respostas por hora **por espectador**. E o
payload cresce ao longo da travessia — fica maior justamente no fim, quando
mais gente está assistindo.

O que chama atenção: a rota irmã `GET /api/downwind/[id]/posicoes` **já
resolve isso** — tem cursor `desde` e `LIMIT`. O viewer novo reimplementou o
mesmo problema sem reaproveitar a solução que estava ao lado.

**Recomendação:** cursor incremental igual ao da rota irmã — carga inicial
amostrada (`amostrarTrilha`, que já existe em `lib/trilhaDownwind.ts`) e
delta a cada poll. Mexe no viewer também, por isso não entrou nesta rodada.

---

## V-04 — `latestIncomingDm` populado e nunca consumido

**Aberto.** O watcher de DM preenche `latestIncomingDm` no contexto a cada
ciclo, e **nenhum componente lê**. Efeito prático: mensagem no chat geral
mostra toast (`InAppPushToast`), DM não mostra — só incrementa o badge.

É a terceira ocorrência desta mesma classe nesta base
(`statusTrackingNativo` e `zerarNotificacoesNaoLidas` foram as outras).
**Expor no contexto não é entregar ao usuário** — vale como checagem de rotina.

Duas saídas honestas: criar o toast de DM, ou remover o estado morto. A
segunda é legítima — o que não pode é ficar como está, parecendo que existe.

Se um toast de DM for criado, ele precisa nascer com a trava de "exibe uma vez
por id" (`lib/toastMensagem.ts`), senão reintroduz o bug do popup repetido
documentado em `docs/BUG-TOAST-MENSAGEM-REPETIDO.md`.

---

## V-05 — Poll do sininho baixa a lista inteira para ler um número

**Aberto.** O watcher chama `GET /api/notifications` a cada 20s e usa
**apenas** `body.naoLidas`. A rota devolve a lista completa de notificações
junto.

Custo desnecessário multiplicado por usuário logado, e
`docs/ANTIGRAVITY-AUDIT-2026.md` aponta compute do Neon como o maior custo do
projeto (resposta 20).

**Recomendação:** `GET /api/notifications?apenasContagem=1` devolvendo só o
número, ou um `HEAD` com o total num cabeçalho. Mudança pequena e isolada.

---

## O que esta varredura sugere sobre o processo

Três dos cinco achados são **estado exposto e não consumido** ou **função
definida e nunca chamada**. Nenhum deles quebra build, typecheck, teste ou
lint — todos passam verdes com o defeito presente.

Vale como varredura periódica barata:

```bash
# campo do contexto sem nenhum consumidor fora do próprio arquivo
grep -rn "<campo>" components/ views/ app/ lib/
```

E vale como regra de revisão: **ao expor algo num contexto, mostrar na mesma
mudança quem consome.** Se ainda não há consumidor, o valor não deveria estar
exposto — ele vira uma promessa que a UI não cumpre, e quem vier depois assume
que funciona.
