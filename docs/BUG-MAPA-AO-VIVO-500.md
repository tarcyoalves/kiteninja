# O mapa ao vivo do downwind nunca funcionou

**Sintoma:** `GET /api/downwind/[id]/live` devolvia **HTTP 500 para todo
mundo, o tempo todo**. A tela `app/dw-live/[id]` — a que mostra os
participantes se movendo na travessia — nunca carregou.

Isto é o coração declarado do app: *"o sentido do app é justamente monitorar
participantes no velejo."*

## A causa

A rota consultava colunas que **nunca existiram**:

| Consultado | Realidade em `lib/schema.sql` |
|---|---|
| `downwinds.origem_spot_id` / `destino_spot_id` | `spot_saida` / `spot_chegada` |
| `downwinds.distancia_estimada_km` | não existe |
| `downwind_participantes.criado_em` | `entrou_em` |
| `downwind_posicoes.velocidade_nos` | não existe |
| `downwind_posicoes.direcao_graus` | não existe |
| `downwind_posicoes.bateria_pct` | não existe |

Cinco consultas da rota, todas quebradas. A primeira delas roda antes de
qualquer outra coisa, então a rota morria na largada.

A mesma classe de erro estava em `GET /api/downwind/invite/[token]`
(`d.spot_saida_id` em vez de `spot_saida`): **abrir um link de convite de
downwind também dava 500.**

## Por que nada pegou isso

Esta é a parte que importa mais que o bug.

O defeito passou por **build, typecheck, 793 testes, 272 checks de SQL contra
Postgres real e 0 erros de lint** — todos verdes, com a rota completamente
quebrada. Para o TypeScript uma query é uma string; o nome de coluna errado só
aparece quando o Postgres recusa, em produção, no meio de uma travessia.

Os 272 checks de `scripts/verify-sql.ts` também não pegaram, e por um motivo
estrutural: **cada um cobre uma consulta escolhida a dedo.** Uma rota nova só
entra na cobertura se alguém lembrar de escrever o check — e ninguém lembrou.

## A correção do bug

`velocidade_nos`, `direcao_graus` e `bateria_pct` não foram adicionadas ao
banco, e sim **eliminadas da pergunta**:

- **Velocidade e rumo são função exata de duas posições consecutivas.**
  Guardá-los seria uma segunda fonte de verdade para um dado derivável, e
  exigiria mudar o que o celular envia. Agora saem de
  `lib/cinematicaTrilha.ts`, pura e testada.
- **`bateria_pct` não é derivável e não é coletada.** Sai da resposta em vez
  de virar um zero que a tela mostraria como "bateria 0%".
- **`distancia_estimada_km`** vira a distância em linha reta entre os spots de
  saída e chegada — o mesmo número útil, sem uma coluna a manter em dia.

Duas decisões da derivação merecem nota, porque são onde ela erraria:

- **Piso de 3 s entre pontos** (`MIN_DELTA_MS`). Abaixo disso o erro do GPS
  domina: dois fixes a 1 s com 10 m de incerteza dão "36 km/h" com o celular
  parado na areia — e esse pico viraria a velocidade máxima da travessia.
- **Teto de 60 nós** (`MAX_NOS_PLAUSIVEL`). Recorde mundial de velocidade em
  kite passa pouco de 55; acima disso é salto de GPS, não velejador. Sem o
  teto, **um** ponto ruim marca a sessão inteira.

O marcador de cada participante busca os **dois** pontos mais recentes, não
um: com um só não há de onde derivar velocidade, e quem parou de reportar —
justamente quem mais importa vigiar — ficaria sem nenhuma.

## A correção que vale mais: a varredura

`scripts/verify-sql.ts` ganhou um check que **inverte a lógica da cobertura**:

> Extrai TODO template `` sql`` `` de `app/api`, troca as interpolações por
> `NULL` e pede um `EXPLAIN` ao Postgres real.

O `EXPLAIN` valida tabelas, colunas, joins e funções sem executar nada. São
**103 consultas** hoje, e uma rota nova entra na cobertura **por existir** —
ninguém precisa lembrar de escrever o check.

Só `SELECT`: em `INSERT`/`UPDATE`/`DELETE` o `EXPLAIN` executaria de verdade.

**Verificado que o check funciona**, e não só que ele passa: o bug foi
reintroduzido de propósito, e a varredura falhou nomeando o arquivo e a
coluna (`app/api/downwind/[id]/live/route.ts: column d.origem_spot_id does not
exist`) — enquanto `tsc --noEmit` continuava limpo com o defeito presente.

## Como o bug foi encontrado

Não por uma varredura de código. Por **sondar a produção**: uma requisição
`curl` a `/api/downwind/<uuid>/live` devolveu 500 onde deveria devolver 404.

Vale como método: as verificações locais respondem "o código é coerente
consigo mesmo". Só falar com o ambiente real responde "isto funciona".
