# "As linhas dos trajetos estão muito retas"

Relato do dono: as trilhas no mapa saíam praticamente retas, e ele queria ver
as curvas reais que o GPS mediu.

## A causa: o orçamento de pontos era gasto ao contrário

Toda redução de trilha do app usava **decimação uniforme** — guardar 1 ponto a
cada N, contando índices:

```ts
for (let i = 0; i < pontos.length; i += passo) saida.push(pontos[i]);
```

Isso ignora o FORMATO do percurso, e o efeito é o pior possível nos dois
extremos:

- **Numa curva**, os pontos que definem a curvatura são descartados junto com
  todos os outros. Sobram dois pontos distantes ligados por uma reta.
- **Numa reta longa**, dezenas de pontos redundantes são preservados para
  desenhar o que uma linha de dois pontos desenharia igual.

Numa trilha de velejo — pernadas longas ligadas por jibes fechadas — isso
significa gastar o orçamento inteiro nas retas e chegar nas curvas sem nada.
Exatamente o "praticamente retas" do relato.

## A correção: Douglas-Peucker

`lib/simplificarTrilha.ts`. O algoritmo pergunta, para cada ponto, *"se eu te
apagar, o traço muda de forma?"* — mantém quem responde sim e descarta quem
responde não. Com o MESMO número de pontos, as curvas ficam curvas e as retas
param de gastar orçamento.

**Não é suavização.** Nada é inventado nem arredondado: todo ponto devolvido é
uma leitura real do GPS, na coordenada em que foi medida. Uma trilha tremida
continua tremida — é isso que o GPS mediu e é isso que o velejador quer ver.

Douglas-Peucker trabalha com uma TOLERÂNCIA em metros, não com uma contagem.
Como o que existe é um orçamento de pontos, a tolerância é encontrada por busca
binária: a menor que ainda cabe no limite, ou seja, a trilha mais fiel que o
orçamento permite.

Trocado em todos os pontos de redução: trilha do logbook (a que o feed e o
detalhe desenham), resumo do downwind, trilha do participante, carga inicial do
mapa ao vivo e página de acompanhamento do velejo solo.

### Duas decisões de implementação

- **Pilha explícita, não recursão.** Uma trilha de milhares de pontos quase
  colineares leva a recursão à profundidade `n`, e cinco mil quadros de pilha
  estouram no navegador do celular — justamente o aparelho que precisa
  aguentar.
- **A projeção limita ao SEGMENTO, não à reta infinita.** Sem o clamp, um ponto
  muito além da ponta apareceria como "em cima da reta" e seria descartado por
  engano.

## O teste que quase mediu a coisa errada

A primeira versão do teste comparou os dois algoritmos sobre um **arco
perfeito** — e a decimação uniforme ganhou (4,1 m de erro contra 5,8 m).

Não é bug: numa curvatura constante, pontos igualmente espaçados são quase
ótimos. **O arco é o melhor caso da decimação uniforme.** Testar com ele
mediria exatamente a situação em que o problema não existe.

O teste foi refeito com a forma de um velejo de verdade — pernadas retas
ligadas por curvas fechadas — que é onde a decimação uniforme falha e onde o
relato nasceu. Aí Douglas-Peucker ganha com folga.

Lição para o próximo teste de comparação neste repositório: **o cenário do
teste é metade do teste.** Um número verde sobre o cenário errado não prova
nada.

## O que isto NÃO conserta

A qualidade da trilha nunca passa da qualidade do dado de origem:

| Trilha | Origem | Resolução |
|---|---|---|
| Logbook / feed | GPS local, ~1 Hz | densa — aqui a correção rende muito |
| Downwind ao vivo | beacon, 1 posição a cada 45s | ~500 m entre pontos a 40 km/h |

No mapa ao vivo do downwind, **nenhum algoritmo inventa curva onde não há
medição**. Deixar aquele traçado mais fiel exige o beacon enviar com mais
frequência — o que custa bateria do velejador e invocação de servidor, e é
decisão de produto, não de código.

Se a trilha do logbook ainda parecer pouco detalhada, o próximo passo é subir o
orçamento de 200 pontos. Com Douglas-Peucker cada ponto rende muito mais que
antes, então 300 já daria bastante — ao custo de ~50% a mais no tamanho da
trilha guardada e trafegada no feed.
