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
persistir. Os dois candidatos que sobraram e ainda não foram investigados:
o rascunho de post no feed, e o formulário de logbook preenchido pela metade.
