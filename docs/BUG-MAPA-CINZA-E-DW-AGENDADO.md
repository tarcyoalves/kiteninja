# Mapa de telemetria cinza + downwind agendado sequestrando a aba Mapa

Dois defeitos sem relação entre si, relatados juntos em 02/09/2026.

---

## 1. O mapa de telemetria ficava cinza

**Sintoma:** `/dw-live/[id]` mostrava fundo cinza liso. Os marcadores (Galinhos,
Barra de Pernambuquinho) e os controles de zoom apareciam por cima, normais.
Nenhuma mensagem de erro na tela.

**Causa:** uma opção `undefined`.

`components/downwind/DownwindLiveReplayViewer.tsx` montava o tile layer à mão:

```ts
const tileConfig = MAP_TILES[mapLayer];
L.tileLayer(tileConfig.url, { /* ... */ subdomains: tileConfig.subdomains })
```

`subdomains` era **opcional** em `MapTileConfig`, e nenhum dos três estilos o
declarava. Então chegava `undefined` ao Leaflet.

O detalhe que fecha o diagnóstico está no `setOptions` do próprio Leaflet:

```js
for (var i in options) { obj.options[i] = options[i]; }
```

Ele copia a chave **mesmo valendo `undefined`** — sobrescrevendo o padrão
`'abc'` da biblioteca. E `getTileUrl` chama `_getSubdomain()` em toda montagem
de URL, mesmo quando o template não tem `{s}` (que é o caso das três URLs
deste projeto):

```js
_getSubdomain: function (tilePoint) {
  var index = Math.abs(tilePoint.x + tilePoint.y) % this.options.subdomains.length;
```

`undefined.length` → TypeError em **cada tile**. Mapa cinza, marcadores por
cima, silêncio.

**Por que só esse mapa:** dos cinco componentes que desenham mapa, dois
contornavam com `?? 'abcd'`, dois nem passavam o campo (ficando com o padrão da
biblioteca), e um passava direto. Só o último quebrava.

Ou seja: `lib/mapTiles.ts` existia justamente para ser a fonte única, e mesmo
assim cada tela tinha o seu jeito de usar. **Fonte única de dados não bastou.**

**Correção:** `subdomains` virou obrigatório, e `opcoesDeTile(estilo)` devolve o
objeto pronto para o Leaflet. Os cinco componentes passaram a usar
`{...opcoesDeTile(...)}`. É a diferença entre fonte única de DADOS e fonte
única de COMPORTAMENTO.

**Teste:** `lib/mapTiles.test.ts` reproduz o `_getSubdomain` do Leaflet
(copiado do `node_modules`, porque o Vitest roda em `environment: 'node'`, sem
DOM — foi por isso que o defeito atravessou o pipeline inteiro) e prova que
nenhum estilo estoura. Inclui a **contraprova**: com `subdomains: undefined` a
mesma função lança. Mais uma guarda de código-fonte que reprova qualquer
componente que volte a montar as opções à mão.

---

## 2. Downwind agendado tomava a aba Mapa

**Sintoma:** o dono criou um downwind marcado para 5 de setembro. Na mesma
hora, a aba Mapa deixou de mostrar o mapa e passou a mostrar a tela da
travessia, com o ponto A desenhado como se fosse hora de começar. E o Velejo
Solo ficou desabilitado, com "encerre ou saia dele antes de iniciar outra
atividade" — por causa de um compromisso de dali a três dias.

**Causa:** `aberto` e `em_andamento` eram tratados como a mesma coisa, em dois
lugares:

- `app/page.tsx`: `const emDownwind = Boolean(downwindAtivo)` — e
  `/api/downwind/ativo` devolve os dois status.
- `lib/activity.ts`: `determinarAtividadeAtual` marcava `aberto` como atividade
  em curso, com `podeIniciarOutra: false`.

Não são a mesma coisa. `aberto` quer dizer "marcado, aceitando gente". Quem
está na água é `em_andamento` — e só isso é uma atividade em curso.

A regra do produto ("ninguém navega em duas atividades ao mesmo tempo")
continua valendo. Ela só nunca quis dizer *"quem tem downwind marcado para
sexta não pode velejar na quarta"*.

**Correção:** a decisão virou função pura, `mapaMostraDownwind`, com duas
portas:

- **travessia em andamento** entra sozinha — tem gente na água, é a tela certa
  sem ninguém pedir;
- **downwind agendado** só entra **a pedido** ("Abrir downwind" / "Entrar no
  Downwind"), sinalizado por `abertoDeliberadamente` no `DownwindContext`.

Encerrado e cancelado não entram por porta nenhuma: histórico tem tela própria.

Trocar de downwind zera o pedido de abertura — o "sim, quero ver" foi dado
para *aquele* downwind, e herdá-lo traria o sequestro de volta.

E o agendado ganhou **saída**: um "voltar ao mapa" no cabeçalho, que só existe
enquanto `aberto`. Antes não precisava, porque não havia de onde sair. Em
andamento o botão some de propósito — sair da travessia é outra coisa (o botão
de segurar "Sair do downwind", que muda a participação de verdade), e uma saída
fácil ali faria o velejador achar que largou o downwind sem ter largado.

## O teste que protegia o bug

`lib/activity.test.ts` tinha:

```
it('bloqueia novas atividades quando há downwind ativo aberto ou em andamento')
```

Ele passava verde enquanto o defeito acontecia — porque descrevia a
implementação em vez do que o usuário precisa. Foi reescrito para afirmar o
contrário, que é o correto: agendado não bloqueia nada.

Vale registrar como padrão: **um teste verde não é prova de que o
comportamento está certo, só de que ele não mudou.**
