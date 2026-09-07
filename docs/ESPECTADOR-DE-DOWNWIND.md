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
