# Varredura da lógica de registro — velejo e downwind

Pedido: *"analise o código atual, e faça uma vasta varredura em toda a lógica
das funcionalidades... principalmente ao marcar o velejo, e marcar o
downwind, precisa registrar tudo."*

**Resultado: dois defeitos graves, os dois na mesma forma — o dado era
medido, e depois se perdia.** Nenhum deles quebrava nada visivelmente. As
verificações passavam todas verdes.

---

## O ponto de partida: a verificação estava com metade do corpo de fora

Antes de procurar defeito, conferi a própria rede de proteção. A varredura de
esquema criada na sessão anterior valida todo `` sql`` `` de `app/api` contra
Postgres real — mas **só os `SELECT`**, porque `EXPLAIN` num `INSERT`
executaria o comando de verdade.

Isso deixava **107 de 215 consultas sem validação nenhuma** — justamente as
que **registram** as coisas.

`PREPARE` resolve: valida tabelas, colunas e tipos e não executa nada
(verificado: a tabela continua vazia depois de preparar um `INSERT`). A
varredura passou a cobrir 106 escritas.

Um detalhe custou uma iteração e vale registrar: o primeiro filtro pegava só
templates que **começam** com `INSERT`/`UPDATE`/`DELETE`, e a gravação da
sessão de velejo é uma CTE (`WITH nova_sessao AS (INSERT ...)`). O INSERT
mais importante do app ficava de fora justamente do check feito para
protegê-lo. Só descobri porque reintroduzi um erro de propósito e o teste
passou verde. **Teste que nunca falhou não provou nada.**

Hoje: 108 leituras + 106 escritas, e o erro reintroduzido falha nomeando
arquivo e coluna, enquanto `tsc --noEmit` segue limpo.

---

## Achado 1 — a travessia que ninguém encerrou não deixava registro

**Evidência em produção, não hipótese.** Sondei o downwind real
"Pernambuquinho x fortaleza":

```
iniciado: 31/08 12:10 UTC
status  : em_andamento   (sondado em 02/09 00:19 UTC)
```

**Quase 36 horas "na água".** Ninguém velejou 36 horas.

### A cadeia

O resumo da travessia — distância, velocidade máxima, trilha reduzida — é
calculado por `resumirEPurgar`. E `resumirEPurgar` só é chamado em dois
lugares: quando alguém aperta encerrar, e quando o último participante sai.

Ninguém encerra. O velejador chega na praia, guarda o equipamento e fecha o
app.

Enquanto o downwind fica preso em `em_andamento`:

| Consequência | Onde se vê no código |
|---|---|
| `distancia_km`, `velocidade_max_nos`, `trilha_reduzida` seguem NULL — **a travessia não fica registrada** | `resumirEPurgar` filtra `distancia_km IS NULL` |
| as posições nunca são purgadas | a purga só olha `status IN ('encerrado','cancelado')` |
| a lista mostra "Na água agora" indefinidamente | `ROTULO_STATUS.em_andamento` |
| os tokens de rastreio seguem válidos | revogação só no encerramento |

### A correção

`encerrarAbandonados`, rodando junto da varredura de silêncio — é a mesma
pergunta em outro horizonte: *"faz minutos que ESTE participante não
reporta"* (alerta de segurança) e *"faz horas que NINGUÉM neste downwind
reporta"* (a travessia acabou e ninguém avisou).

Duas decisões mereceram função pura e testada (`lib/downwindAbandono.ts`):

**Limiar de 6 horas, não menos.** O rastreio em segundo plano no Android é a
parte frágil deste app. Um limiar curto encerraria a travessia de quem está
na água e só perdeu o beacon — apagando do mapa alguém que talvez precise de
socorro. Errar esperando demais custa um resumo atrasado; errar para o outro
lado custa a vigilância de quem está na água.

**`encerrado_em` é a última posição, nunca `NOW()`.** O cron pode passar horas
depois; carimbar a hora da varredura faria a travessia parecer ter durado 36
horas no resumo e no histórico do velejador.

Verificado contra Postgres real nas duas pontas: que sem encerrar a travessia
fica mesmo sem resumo, que a varredura acha o abandonado, que a duração
gravada fica realista, que o resumo passa a existir, e que rodar de novo não
reencerra nem recalcula.

---

## Achado 2 — fechar o app apagava o velejo inteiro

O irmão do primeiro, do lado solo.

`useTrilhaSessao` guardava a trilha do Modo Navegação em estado do React, e
só ali. Fechar o app apagava tudo.

E fechar o app não é acidente raro nesse cenário — **é o cenário**: 2 h de GPS
ativo drenam bateria, navegador de celular descarta aba em segundo plano de
forma agressiva, o celular vive molhado no bolso.

### A correção

Cópia periódica no `localStorage` (94 KB para 2 h de trilha, contra ~5 MB
disponíveis), a cada 10 s — não a cada ponto, porque `setItem` é síncrono e
bloqueia a thread principal enquanto o GPS entrega amostra a cada poucos
segundos.

**Não retoma sozinho, e essa é a decisão central.** O hook já dizia, em
comentário, que "sessão nova não herda a anterior" — e com razão: retomar por
conta própria somaria o velejo de ontem ao de hoje e colocaria distância
errada no histórico. A trilha vira um aviso — *"achamos um velejo de X km que
ficou sem registrar, retomar?"* — e quem decide é o velejador.

O que **não** é restaurado, de propósito:

- **velocidade instantânea** e **"GPS indisponível"**: descrevem o estado do
  GPS *agora*; mostrar 12 nós de uma sessão encerrada seria mentira na tela;
- **`ultimaReferencia`**: é o ponto de comparação para a *próxima* amostra, e
  ao retomar o intervalo até o primeiro ponto novo pode ser de horas — daria
  distância ou velocidade absurdas.

E o backup é apagado quando o velejo **vira registro**, só depois do `await`
do POST dar certo. Sem isso, a próxima abertura ofereceria retomar um velejo
já salvo, e aceitar criaria uma segunda sessão com a mesma distância. Apagar
antes da confirmação perderia o velejo de vez numa conexão ruim no spot.

---

## O que foi auditado e está correto

Nem tudo que olhei tinha defeito. Para não deixar a impressão errada:

| Área | Situação |
|---|---|
| `POST /api/sessions` | Sólida: valida data/hora antes da query (texto pt-BR numa coluna DATE dava 500), grava sessão e post automático na MESMA instrução (CTE) para não duplicar em retentativa, e trilha inválida vira `null` em vez de derrubar o registro |
| Rotas em produção | 15 rotas sondadas, **nenhum 500** — só 401 (exige login) e 200 |
| Encerramento por último participante | Funciona, e é idempotente (`WHERE status = 'em_andamento'`) |
| Esquema × código | 214 consultas validadas contra Postgres real, zero divergência |
| Resumo do downwind | O cálculo em si está certo, com teto de 90 nós para salto de GPS não virar recorde |

---

## Para o próximo agente

**As duas falhas tinham a mesma forma:** o dado era medido corretamente e
depois se perdia, porque o momento de gravá-lo dependia de uma ação humana
que ninguém faz — encerrar o downwind, salvar o velejo antes de o app morrer.

Isso não aparece em teste, lint ou build. Aparece quando se pergunta: *"e se
o usuário simplesmente fechar o app aqui?"*

Vale rodar essa pergunta contra todo fluxo que acumula estado antes de
persistir.


---

## Achado 3 — o velejo recuperado ficava escondido no lugar errado

Descoberto ao conferir a própria correção do achado 2, e é a mesma armadilha
do downwind invisível: **um dado salvo que ninguém encontra é um dado
perdido.**

A trilha passou a sobreviver ao fechamento do app, mas o único lugar que
oferecia recuperá-la era o **Modo Navegação**. E ninguém abre o Modo
Navegação para procurar um velejo perdido — a pessoa vai ao **Logbook**,
porque é lá que o velejo deveria estar e não está.

Pior: no Modo Navegação o botão diz "Retomar", que é voltar a navegar. Quem
já saiu da água não quer navegar de novo; quer **registrar**.

### A correção

`components/AvisoVelejoNaoRegistrado.tsx`, como primeiro item do Logbook:

> ⚠️ **Velejo sem registro** — O app fechou antes de você salvar. Guardamos
> **18,4 km** e **60 min** de trilha.
> [ Registrar agora ] [ Descartar ]

"Registrar agora" abre o formulário do logbook já preenchido com a trilha.

**A sutileza que custou uma função pura** (`prefillDeTrilhaSalva`): a duração
sai do **último ponto da trilha**, nunca de `Date.now()`. O velejador pode
reabrir o app no dia seguinte, e usar o relógio de agora somaria todo o tempo
de app fechado — um velejo de 60 minutos viraria um de 14 horas no histórico.
É o mesmo cuidado de `instanteDeEncerramento` no downwind abandonado, e é a
terceira vez que essa armadilha aparece nesta base.

O card **não** apaga a trilha ao abrir o formulário. Quem apaga é o
`addSession`, depois de o servidor confirmar: se a pessoa abrir e fechar sem
salvar, ou a rede cair, o backup precisa continuar existindo.

---

## Achado 4 — fechar o formulário apagava a digitação sem perguntar

Os dois formulários que acumulam trabalho — logbook (27 campos) e post do
feed (texto + foto) — não guardam rascunho.

**O que investiguei antes de mexer:** o clique no fundo escuro **não** fecha
esses modais. Só o X fecha, e ele é um alvo pequeno no canto. O risco de
toque acidental, que era minha suspeita inicial, não existe.

Sobrou o risco real: um X sem pergunta apaga em silêncio o que a pessoa
acabou de escrever.

### Por que confirmação, e não rascunho persistido

Considerei persistir os rascunhos e **decidi contra**, por três razões:

1. O dado caro (a trilha do GPS) já está protegido em duas camadas —
   `localStorage` e o card do Logbook.
2. Um rascunho salvo do logbook **conflitaria com o preenchimento vindo do
   GPS**: com os dois presentes, qual ganha? Seria uma fonte de bug nova para
   proteger poucos minutos de digitação.
3. A foto do post é base64 e pesaria no `localStorage`, justamente onde a
   trilha precisa de espaço.

A confirmação resolve o mesmo risco sem criar estado novo.

`lib/descarteFormulario.ts` decide quando perguntar, e a regra é: **só se
houver trabalho de verdade**. Ficam de fora os campos que já nascem
preenchidos — spot padrão, disciplina, nota, tamanho de kite, e tudo que veio
do GPS. Uma confirmação que aparece sempre é uma confirmação que ninguém lê.

---

## Resumo dos quatro achados

| # | Defeito | Onde estava a falha |
|---|---|---|
| 1 | Travessia abandonada sem registro | gravar dependia de alguém apertar "encerrar" |
| 2 | Fechar o app apagava o velejo | a trilha só existia em memória |
| 3 | Velejo recuperado escondido | salvo, mas oferecido no lugar onde ninguém procura |
| 4 | Digitação descartada em silêncio | fechar não perguntava nada |

Os quatro têm a mesma raiz: **o app media o dado certo e depois o perdia**,
sempre num momento em que nenhuma verificação automática estava olhando.

E o achado 3 merece nota à parte, porque nasceu de conferir a correção do
achado 2: **corrigir um defeito é o melhor momento para encontrar o
seguinte.** A pergunta que o revelou foi "está salvo — mas a pessoa vai
encontrar?", e ela não é feita por teste nenhum.