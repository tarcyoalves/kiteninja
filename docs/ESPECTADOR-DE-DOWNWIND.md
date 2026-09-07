# Só assistir um downwind — e o "entrei num dw e não prestou"

Dois pedidos numa sequência só, e eles se explicam um ao outro.

## 1. "Tentei entrar num dw e não prestou"

O servidor gravava a entrada certinho. Quem falhava era a tela.

`abertoDeliberadamente` era um booleano, e o contexto o **zerava sempre que o
id do downwind ativo mudava** — para o "sim, quero ver" de um downwind não ser
herdado por outro. A intenção estava certa. A implementação se atropelava.

Entrar num downwind faz duas coisas na mesma continuação assíncrona:

```ts
await recarregar();               // id vai de null para o novo
setAbertoDeliberadamente(true);   // "quero ver este"
```

O React junta as duas. Aí o zerador — que roda **durante o render**, não num
efeito (ver `lib/useAoMudar.ts`) — vê o id mudando de `null` para o novo,
conclui "trocou de downwind" e desliga o pedido que acabara de ser ligado.

Para quem usa: você toca em **Entrar no Downwind**, é levado para a aba Mapa, e
o mapa é o normal. Como se o toque não tivesse feito nada.

Só quebrava em downwind **agendado** (`aberto`) — travessia em andamento toma a
tela por outro caminho — e só na **primeira** entrada, porque quem já era
participante não tem troca de id para o zerador reagir. Por isso passou.

**A correção** é guardar *para qual* downwind o pedido foi feito, em vez de um
booleano mais um zerador (`pedidoDeAberturaVale` em `lib/activity.ts`). Trocar
de downwind deixa de casar sozinho: ninguém precisa desligar nada, e não há
corrida entre quem liga e quem desliga. É o mesmo formato de `encerradoPorMimRef`.

### A segunda causa, encontrada porque o relato voltou

Corrigida a corrida, o dono testou de novo: **continuou não abrindo**. Havia um
segundo defeito, independente, no mesmo caminho.

`GET /api/downwind/ativo` devolvia **um** downwind, escolhido por
`ORDER BY ... LIMIT 1`. Quem está em mais de um — e quem cria downwinds para
testar fica em vários, porque nada fecha os antigos sozinho — recebia sempre o
mesmo. E a ordem escolhia mal: `iniciado_em DESC NULLS LAST, previsto_para ASC`
elege, entre agendados (todos com `iniciado_em` nulo), o de data **mais
antiga** — o downwind de teste esquecido de duas semanas atrás ganhava do que a
pessoa acabou de criar.

O efeito é o mesmo sintoma por outro mecanismo: o app pedia a tela do downwind
X, o servidor respondia com o Y, o pedido não casava com o downwind ativo e era
descartado **em silêncio**. Nenhum erro, nenhuma mensagem, a aba Mapa comum.

Duas correções:

- a rota aceita `?id=`, e `entrarNoDownwind` manda o id em que acabou de
  entrar. Quem entra num downwind sabe em qual entrou — não há por que
  adivinhar;
- sem id, a ordem passa a ser: travessia **em andamento** na frente de tudo
  (tem gente na água agora, isso vence qualquer plano), depois o downwind em
  que a pessoa entrou por último.

### E o verificador que deixou passar

Escrevendo o comentário dessa ordenação eu pus o nome das colunas entre crases,
por hábito de Markdown — dentro de um comentário `--` de um template `` sql`` ``.
A crase **encerra o template literal ali mesmo**. É a armadilha que este repo
documenta, e o `verify-sql.ts` dizia cobrir as duas da família.

Não cobria. Ele procurava a crase *dentro dos templates já extraídos*, e
`extrairTemplatesBrutos` corta os templates exatamente na crase — a linha
ofensora nunca chegava a fazer parte de "um template" para ser inspecionada. O
verificador dava tudo certo enquanto o arquivo nem compilava. Agora a busca é
no texto bruto do arquivo, e a contraprova (crase de volta) reprova.

Um teste meu também leu comentário como se fosse código: afirmava que
`previsto_para ASC` não aparecia mais, e falhava contra o código já corrigido
porque a string sobrevivia no comentário `--` que explica a ordem antiga. O
stripper do teste agora tira comentário SQL também.

### A terceira causa — e a lição de método

O relato voltou uma terceira vez. As duas primeiras causas eu deduzi **lendo o
código**, e as duas eram defeitos reais — mas nenhuma era a que o dono estava
vivendo. Deduzir de novo teria sido o terceiro chute.

Fui aos **logs de produção**. Eles contaram a história inteira em dez linhas:

```
20:30:14  POST /downwind/fa41cc2d.../entrar   200
20:30:28  POST /downwind/fa41cc2d.../entrar   200
20:30:45  POST /downwind/2f0348d5.../posicoes 200   <- OUTRO downwind
20:31:32  POST /downwind/2f0348d5.../posicoes 200   ... a cada 47s, sem parar
20:48:52  POST /downwind/fa41cc2d.../entrar   200
20:49:12  POST /downwind/fa41cc2d.../entrar   200
20:49:32  POST /downwind/fa41cc2d.../entrar   200
20:49:36  POST /downwind/fa41cc2d.../entrar   200
20:50:10  POST /downwind/fa41cc2d.../entrar   200
```

**Sete toques em "Entrar", todos 200.** E entre eles, o beacon de um downwind
*diferente* transmitindo posição sem parar — um downwind antigo, de um teste
que nunca foi encerrado, ainda `em_andamento`.

O app só sabe segurar **um** downwind ativo, e sempre prefere o que está em
andamento. Então a entrada acontecia de verdade, a tela pedia o novo, e a
revalidação seguinte — `recarregar()` sem id, disparado por `focus` ou
`visibilitychange` — trazia o velho de volta. Sete vezes, com zero mensagem na
tela. O servidor respondia "deu certo" e a pessoa via que não deu.

Duas correções, e a segunda importa mais que a primeira:

1. **O pedido passou a sobreviver.** `recarregar()` sem argumento consulta o
   último downwind pedido, em vez de aceitar o palpite do servidor. Se o
   downwind pedido deixar de valer (encerrado, cancelado, saí dele), o pedido
   morre e a escolha volta a ser do servidor.

2. **Entrar em outro downwind com um em andamento passou a RECUSAR, dizendo o
   nome do que está travando** (`podeEntrarEmOutroDownwind`, 409):

   > Você ainda está no downwind "Teste de terça", que está em andamento.
   > Encerre sua participação nele antes de entrar em outro.

   Deixar trocar seria pior: trocaria o beacon de downwind e abandonaria a
   gravação de uma travessia possivelmente real. A invariante do produto é uma
   navegação por vez — mas ela só vale alguma coisa se a pessoa **souber** qual
   é a que está em curso. Era isso que faltava, e é a diferença entre um app
   que recusa e um app que ignora.

Espectador não bloqueia: quem só assiste não está em travessia nenhuma.

E de novo a asserção falsa: o teste "a rota aplica a regra" passou com o
`throw` removido, porque o nome da função continuava no arquivo. Terceira vez
nesta base que um guarda de código-fonte passa vendo só o nome. A asserção
agora exige a linha do `throw`.

### A quarta causa — a armadilha de três portas

O print resolveu de uma vez. No card do downwind "Guamare / saturno":
`Downwind AO VIVO — entrar`, `0 riders confirmados`, e o aviso vermelho
*"Este downwind está em andamento — encerre ou cancele a travessia antes de
apagar o evento."*

O dono tinha **encerrado a própria participação** naquele downwind. E aí três
portas se fecharam ao mesmo tempo:

1. `'encerrado'` era estado **terminal** (`encerrado: new Set([])`), e
   `POST /entrar` só revivia `'desistiu'`. Tocar em "entrar" gravava **200** e
   não mudava absolutamente nada.
2. `GET /api/downwind/ativo` filtra `estado IN ('confirmado','navegando')` —
   devolvia vazio, `downwindAtivo` ficava `null`, e a tela do downwind nunca
   abria. **O app ia para o mapa comum**, que é o relato literal.
3. Sem essa tela não há botão de encerrar a **travessia** — as ações de
   encerrar/cancelar só existiam lá dentro. E apagar o evento é recusado
   enquanto ela está `em_andamento`. **"Tentei apagar e não apagou."**

Não havia saída: não dava para entrar, não dava para encerrar, não dava para
apagar.

**Correção 1 — `'encerrado'` volta para `'confirmado'`.** Não é só uma válvula
de escape: é o que acontece na praia. A pessoa chega, encerra o velejo,
descansa, e volta para a água enquanto o grupo ainda atravessa. O modelo antigo
dizia que isso era impossível. Volta para `'confirmado'` e não para
`'navegando'` — reentrar não é estar na água, para isso existe o botão Iniciar
— e volta a contar no quórum, que é o comportamento seguro. `encerrou_em` é
limpo junto, senão a linha diria que a pessoa terminou numa hora em que ela
está de volta.

Um teste existente afirmava que `'encerrado'` era terminal. Ele descrevia o
desenho antigo com fidelidade; foi reescrito dizendo por que o desenho mudou —
e mantendo o que continua valendo (`encerrado` não vai direto para `navegando`
nem para `desistiu`).

**Correção 2 — encerrar e cancelar a travessia direto do card**, para o
organizador, quando o downwind está `em_andamento`. Essas ações não podem morar
só numa tela que pode não abrir: é justamente quando ela não abre que elas
fazem falta.

## 2. "Quero opção de apenas visualizar os velejadores"

Só existiam dois lugares para estar num downwind: na água (`velejador`) ou no
carro de apoio (`apoio_terra`). E **quem cria o downwind entra como velejador**
(`app/api/events/route.ts`).

Consequência que o dono ia encontrar no primeiro downwind que criasse sem
poder ir: ele fica contado como gente na água. O quórum de encerramento espera
por ele. O grupo inteiro chega na praia e **não consegue fechar o downwind**,
porque o organizador está em casa e o app acha que ele ainda está no mar.

### Por que não reaproveitar `apoio_terra`

Apoio em terra é o **carro**. Qualquer participante com esse papel pode ser
escolhido como carro de apoio de um velejador (`apoioValido`). Colocar quem só
assiste nessa lista prometeria um carro na praia que não existe — e essa é
justamente a promessa que ninguém pode quebrar num downwind.

### O terceiro papel

`espectador`. Vê tudo, não interfere em nada:

| | espectador |
|---|---|
| entra no quórum de encerramento | não — `velejadores()` já filtra `velejador` |
| transmite posição | não — `podeReportarPosicao` recusa com 403 |
| vira marcador no mapa dos outros | não — `apareceNoMapa` |
| aparece no resumo/ranking | não |
| pode ser carro de apoio | não |
| pode iniciar a travessia | não |
| candidato a socorro no SOS | **não** — ver abaixo |
| vê o mapa ao vivo | **sim**, é para isso que ele existe |

Na tela: um botão **"Só assistir (não vou velejar)"** no card do evento, e uma
linha dizendo "Você está só assistindo este downwind" para a escolha não sumir
sem retorno.

### A decisão do SOS, que é a única polêmica aqui

Espectador **não entra na lista de socorristas**. Uma lista de resgate inflada
com gente que não pode chegar é pior que uma lista curta e verdadeira: ela faz
parecer que muita gente foi avisada e está a caminho. Quem só assiste continua
vendo o mapa ao vivo e pode acionar salvamento por fora; o que ele não faz é
ocupar uma vaga na lista de quem vai buscar.

Se o dono discordar, é uma linha em `lib/sosCandidates.ts` — mas discordar tem
que ser uma decisão, não um efeito colateral.

## 3. O botão do mapa ao vivo que ninguém via

Achado no caminho. A trava do botão "Acompanhar de terra" exigia
`visibilidade === 'comunidade'` — e com isso **escondia o botão de quem
participa de um downwind privado, inclusive de quem o criou**. Essas pessoas
sempre puderam ver o mapa (`podeVerReplayAoVivo` libera participante e
moderador); só não tinham por onde chegar nele. O evento agora carrega
`downwindMeuPapel`, e o botão aparece para quem de fato pode ver.

## Os testes, e o que quase escapou

`lib/espectadorDownwind.test.ts` e `lib/entrarNoDownwind.test.ts`. Cada guarda
foi verificada reintroduzindo o defeito:

- `transmitePosicao` devolvendo `true` para todos → 2 vermelhos;
- `podeReportarPosicao` sem a guarda de papel → 1 vermelho;
- `souParticipanteDaAgua` ignorando o papel → 2 vermelhos;
- SOS voltando a aceitar espectador → 1 vermelho;
- `entrarNoDownwind` voltando ao booleano → 2 vermelhos.

## O que muda no banco

Uma constraint, aplicada sozinha no deploy (`scripts/migrate-on-build.ts`):

```sql
ALTER TABLE downwind_participantes DROP CONSTRAINT IF EXISTS downwind_participantes_papel_check;
ALTER TABLE downwind_participantes ADD CONSTRAINT downwind_participantes_papel_check
  CHECK (papel IN ('velejador', 'apoio_terra', 'espectador'));
```

Nenhum dado existente muda de papel. Ninguém precisa rodar nada à mão.
