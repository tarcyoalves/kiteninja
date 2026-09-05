# "Cliquei em play, iniciar velejo solo, e voltou para o mapa sem gravar"

Relato do dono, no Android. O toque era recebido, a folha fechava, o app ia
para a aba Mapa — e nada era gravado.

## O que o código fazia

Existem **dois** botões "Velejo Solo", porque a folha `IniciarAtividadeSheet` é
montada em dois lugares:

| Onde | Quem abre | `onIniciarVelejoSolo` fazia |
|---|---|---|
| `views/MapView.tsx` | botão de iniciar dentro do mapa | `setModoNavegacaoAtivo(true)` ✅ |
| `app/page.tsx` | **botão PLAY do menu inferior** | avisava seguidores, fechava, ia para a aba Mapa ❌ |

O segundo nunca ligava o Modo Navegação. Pior: **avisava os seguidores que o
velejador tinha entrado na água** enquanto nada era gravado.

## A causa

Não foi uma linha esquecida. `modoNavegacaoAtivo` era estado **local** de
`views/MapView.tsx`:

```ts
const [modoNavegacaoAtivo, setModoNavegacaoAtivo] = useState(false);
```

De `app/page.tsx` não havia como alcançá-lo. A folha global não tinha a linha
porque não podia tê-la — o setter não existia naquele escopo.

Por que passou despercebido: o caminho que **funciona** é o de dentro do mapa,
que é o que se usa ao testar a tela do mapa. O caminho quebrado é o do menu
inferior — o que a maioria das pessoas usa de verdade.

## O conserto

O estado foi para o `KiteDataContext`, onde já moram `isSheetIniciarOpen`,
`activeTab` e `abrirTelaDoDownwind`. Um dono só, dois caminhos alcançando o
mesmo lugar. `MapView` passou a ler de lá com renomeação na desestruturação,
então o resto daquele arquivo não mudou.

De quebra, a folha global passou a receber o valor **real** em
`modoNavegacaoAtivo` (antes era `false` fixo). Isso liga o bloqueio de
`determinarAtividadeAtual`: com um velejo solo em andamento, a folha agora diz
isso em vez de oferecer começar outro.

## A guarda, e a contraprova dela

Nada disso era visível para tipo, lint, teste de unidade ou build: os dois
caminhos compilavam e um deles funcionava. Por isso a guarda em
`lib/activity.test.ts` **lê o arquivo** e confere que os dois handlers ligam o
modo, e que o estado mora no contexto.

A primeira versão da guarda era falsa: comentar a chamada
(`// setModoNavegacaoSolo(true)`) deixava o texto no arquivo e o teste passava
verde com o bug de volta. **A contraprova reprovou o teste, não o código.** A
guarda passou a remover comentários antes de conferir, e foi testada contra as
três formas de o defeito voltar — linha comentada, linha removida, estado
devolvido para dentro do MapView. Reprova nas três.

Lição já registrada em `VARREDURA-2026-08-31.md` e reforçada aqui: um teste que
prova a ausência de um defeito **não vale nada até você ver ele ficar
vermelho.**
