# Quanto detalhe a trilha pode ter nos planos livres

Pedido: analisar os limites dos planos livres (Vercel, Neon, GitHub) e deixar a
trilha o mais detalhada possível dentro deles.

## O achado que mudou a solução

A trilha era guardada e trafegada com o MESMO orçamento de pontos — 200. E o
`GET /api/feed` devolve **15 velejos por página, com a trilha embutida em cada
um**.

Ou seja, o número tinha que ser pequeno por causa do pior caso (a listagem),
e quem pagava era o mapa em tela cheia do detalhe do velejo, que aguentaria
muito mais.

Separar os dois orçamentos resolve os dois lados de uma vez.

## As contas, medidas

Um ponto em JSON — `[-5.123456,-36.789012,1757000000000]` — ocupa **~38 bytes**.
O teste em `lib/simplificarTrilha.test.ts` mede isso e falha se o formato mudar,
para os números abaixo não virarem folclore.

| | Antes | Agora |
|---|---|---|
| Guardado por velejo | 200 pontos (~7,6 KB) | **1200 pontos (~46 KB)** |
| Mandado no feed (15 velejos) | 200 cada → **~114 KB** | 80 cada → **~45 KB** |
| Detalhe do velejo | 200 pontos | **1200 pontos** |

**A trilha ficou 6× mais detalhada e a página do feed ficou 60% mais leve.**

Isso não é truque: o card do feed desenha uma miniatura de ~350px de largura.
Oitenta pontos já saturam a resolução daquele espaço — o pixel não tem como
mostrar mais. Mandar 200 para lá sempre foi desperdício invisível.

## Os limites, e o que de fato aperta

- **Neon (livre) — 0,5 GB de armazenamento.** A 46 KB por velejo, são mais de
  **dez mil velejos** só de trilha. Não é o que aperta.
- **Vercel (Hobby) — banda e invocações.** A trilha do feed CAIU, então este
  eixo melhorou. Invocações não mudaram: nenhuma requisição nova foi criada.
- **Corpo da requisição que salva o velejo** — 46 KB, ordens de grandeza abaixo
  do teto de uma função serverless.
- **GitHub** — não entra na conta: guarda código, não dado de usuário. O
  repositório não cresce com velejo nenhum.

**O que aperta de verdade não é plano nenhum: é o 4G da praia.** Meio megabyte
de trilha por rolagem de feed seria ruim com qualquer plano pago, e é por isso
que o corte no feed veio junto com o aumento no armazenamento.

## O limite que NENHUM orçamento resolve

A trilha nunca fica melhor que o dado de origem:

| Trilha | Origem | Resolução real |
|---|---|---|
| Logbook / feed | GPS local, ~1 Hz | densa — **é aqui que os 1200 rendem** |
| Downwind ao vivo | beacon, 1 posição/45s | ~500 m entre pontos a 40 km/h |

Subir o orçamento da trilha do downwind ao vivo não faria diferença: **não há
medição para gastar orçamento**. Aquele traçado só melhora com o beacon
enviando mais vezes, e aí o custo é bateria do velejador e invocação de
servidor — decisão de produto.

Por isso os limites do downwind (`LIMITE_TRILHA_RESUMO`,
`MAX_PONTOS_TRILHA_PROPRIA`) NÃO foram mexidos. Mudar o que não aperta só
adiciona risco.

## Onde os números moram

- `PONTOS_TRILHA_GUARDADOS` (lib/trilhaSessao.ts) — o que se guarda.
- `PONTOS_TRILHA_FEED` (app/api/feed/route.ts) — o que a listagem manda.

Os testes leem as constantes em vez de repetir o número: um teste que fixa 200
à mão quebra a cada ajuste de orçamento sem que nada esteja errado — foi o que
aconteceu nesta mudança, com dois testes antigos.

Se um dia a trilha precisar de mais, o caminho é subir
`PONTOS_TRILHA_GUARDADOS` e **refazer a conta de armazenamento** — o teste de
orçamento avisa se ela deixar de fechar.
