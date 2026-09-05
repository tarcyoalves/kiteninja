# "A velocidade máxima estava acima de 43 e o app marcou 23,9"

Relato do dono, depois de gravar um velejo de teste.

## O número estava certo

23,9 × 1,852 = **44,3 km/h**. É exatamente o "acima de 43 km/h" que ele viu na
tela enquanto velejava. A conta nunca esteve errada — `lib/trilhaSessao.ts` usa
`NOS_POR_MPS = 1.94384`, que é a definição.

## O app é que se contradizia

A MESMA medida aparecia em duas unidades, sem dizer:

| Tela | Mostrava |
|---|---|
| `ModoNavegacao` (a tela que ele olhava velejando) | **km/h** |
| `DownwindResumoModal` | **km/h** |
| Card do feed | **nós** |
| Detalhe da sessão | **nós** |
| Formulário do logbook | rótulo "(nós)" |
| `DownwindLiveReplayViewer` | nós em destaque, km/h miúdo embaixo |

Duas telas diziam 44,3 e duas diziam 23,9 sobre a mesma travessia. Do lado de
cá isso não se lê como "unidades diferentes" — se lê como **"o app errou a
conta"**, e foi essa a conclusão. Estava certo em toda parte e errado como
produto.

Pior: o formulário perguntava em nós. Quem quisesse corrigir o próprio recorde
à mão digitaria o 44 que acabou de ver na tela num campo que guardaria 44 nós —
81 km/h, um recorde mundial de kitesurf com folga.

## A decisão, agora num lugar só

`lib/velocidadeVelejo.ts`. **Velocidade do velejador em km/h; vento em nós.**
São duas grandezas diferentes por convenção do esporte, não a mesma coisa em
duas unidades — e a decisão já existia no código, escrita duas vezes em dois
arquivos. O que faltava era ela valer em toda tela.

O ARMAZENAMENTO CONTINUA EM NÓS: `lib/trilhaSessao.ts` calibra os limiares de
GPS em nós (deslocamento mínimo, salto impossível, teto contra o recorde
mundial), a coluna é `max_speed_knots` e a validação da rota é em nós. A
conversão acontece só na borda.

No visualizador ao vivo — que é tela de análise e mostrava as duas — as duas
continuam, com os papéis invertidos: km/h em destaque, nós miúdo.

## A guarda

O defeito não foi uma conta errada, foi a mesma conta escrita em dois arquivos
e faltando em outros dois. Nada disso é visível para tipo, lint ou teste de
unidade: `${x.toFixed(1)}nós` compila, passa no lint e está correto isolado. Só
olhando duas telas lado a lado é que aparece.

Então a regra virou estrutura, em `lib/velocidadeVelejo.test.ts`: toda tela que
menciona uma velocidade E escreve uma unidade tem de importar de
`lib/velocidadeVelejo`, e nenhuma pode multiplicar por 1,852 na mão.

Dois detalhes que a primeira versão do teste errou, e valem para o próximo
teste de varredura de código deste repositório:

- **`\bnós\b`, não `includes('nós')`.** Sem a fronteira de palavra,
  "diag**nós**tico" casa, e a tela do downwind ao vivo — que calcula velocidade
  mas não exibe nenhuma — era cobrada de importar um formatador que não usa.
- **Proibir `* 1.852`, não `1.852`.** A divisão significa outra coisa: km para
  milha náutica, ou km/h para nós num cálculo interno. Proibir as duas
  reprovaria código correto — e um teste que reprova código correto é apagado
  na primeira vez que incomoda.

A guarda foi verificada contra os dois jeitos de o defeito voltar (rotular em
nós de novo; reescrever a conversão na mão). Reprova nos dois.
