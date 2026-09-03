# Varredura do chat — 03/09/2026

Pedido do dono: revisar a estrutura inteira do chat, checar se os botões
respondem no primeiro toque (o de enviar não respondia), e permitir chamar no
privado tocando no velejador da sala geral.

Cinco defeitos, e o mais interessante é que quatro deles são a **mesma
categoria**: código escrito para mouse, rodando num dedo.

---

## 1. O botão de enviar exigia dois toques — e não era o botão

Era o layout saindo de baixo do dedo entre o toque e o clique.

Com o teclado aberto e o campo focado:

1. o dedo encosta no botão de enviar;
2. o campo perde o foco → `focusout`;
3. `useKeyboardVisible` concluía **na hora** que o teclado fechou;
4. e três coisas se mexiam no mesmo quadro: o `BottomNav` volta a existir (ele
   retorna `null` com o teclado aberto), a folga do `.app-scroll` cresce, e a
   do compositor troca `pb-2` por `pb-above-nav`;
5. o botão sobe uns 100px — e o `click`, que só nasce quando o dedo levanta,
   cai no vazio.

O segundo toque funcionava porque aí o teclado já estava fechado e nada mais se
mexia.

**Duas correções, e as duas importam:**

- **Na raiz** (`lib/tecladoVirtual.ts` + `useKeyboardVisible`): "perdeu o foco"
  deixa de significar "teclado fechado" no mesmo instante. Espera 250 ms, e o
  fechamento é cancelado se o foco voltar para outro campo. Isso conserta todo
  botão vizinho de todo campo do app, não só o de enviar.

  250 ms é praticamente a duração da animação de recolhimento do teclado no
  iOS, então o menu inferior reaparece **junto** com o fim da animação em vez
  de antes dela — ficou melhor do que era.

- **No compositor**: os botões nem tiram o foco do campo (`onMouseDown` com
  `preventDefault`). O teclado sequer fecha, e dá para mandar três mensagens
  seguidas sem ele piscar e sem tocar no campo de novo a cada envio.

Um teste lê o trecho entre `INICIO-COMPOSITOR-CHAT` e `FIM-COMPOSITOR-CHAT` e
reprova qualquer botão sem `onMouseDown`.

---

## 2. Botões de copiar e APAGAR eram invisíveis no celular

`opacity-0 group-hover:opacity-100`. Isto é um app de celular: **não existe
hover num dedo**. Os dois botões ficavam com opacidade zero para sempre —
invisíveis, e mesmo assim clicáveis. Alvos transparentes de 11px ao lado do
horário da mensagem.

No caso do apagar, um toque errado num alvo que não se vê, com só o `confirm()`
segurando.

Agora aparecem sempre, discretos, com alvo maior. O hover ainda os destaca em
tela com ponteiro fino.

Conferido no resto do app: `NotificationCenterModal` e `VideoTrimmer` já
tratavam o toque certo (`opacity-80 sm:opacity-0 …` e `opacity-60`). O chat era
o único caso. Um teste reprova `opacity-0` sem prefixo de breakpoint junto de
`group-hover:opacity-100`.

---

## 3. Tocar no velejador da sala geral não levava a lugar nenhum

O avatar e o nome eram `div` e `span`. A pessoa via quem falou e não tinha como
chamar no privado dali: precisava sair, ir na aba Online, achar o nome e tocar.
Se o velejador não estivesse online naquele instante, **não havia caminho
nenhum**.

`openDmConversation` já existia — só não estava ligado ali. Agora avatar e nome
abrem a conversa privada. O nome é alvo maior de propósito: 32px de avatar é
pouco para um dedo.

Dentro de uma DM os dois voltam a ser enfeite — abrir o privado com quem já se
está conversando levaria à mesma sala.

---

## 4. Corrida ao trocar de conversa

`pollMessages` já verificava se a sala mudou enquanto a resposta vinha.
`buscarSala`, a carga inicial, **não**.

Trocar de conversa duas vezes seguidas — dois toques na lista de DMs, coisa de
um segundo — deixava a resposta da primeira sala chegar depois da segunda e
sobrescrever a tela: o velejador via a conversa errada, com o nome certo no
cabeçalho.

Pior que o visual: `sinceRef` também ficava com o cursor da sala errada, então o
poll seguinte pedia mensagens novas usando a marca de outra conversa.

A checagem tem que vir **depois** do `await` — o ponto é justamente o que mudou
enquanto a resposta vinha.

---

## 5. "Copiado" aparecia mesmo quando a cópia falhava

```ts
try { navigator.clipboard.writeText(text); setCopiedId(id); } catch { }
```

`writeText` devolve uma Promise. Sem `await`, a rejeição escapa do bloco e o
`catch` nunca dispara. E ela falha de verdade: contexto inseguro (http) e
permissão negada. O app dizia "Copiado" e a área de transferência continuava
vazia.

Agora tem `await`, e a falha vira uma instrução útil ("segure na mensagem para
selecionar").

---

## O que foi verificado e estava certo

- `handleSend` já protegia contra envio duplo (`if (sending) return`), já
  desfazia o rascunho na falha e já deduplicava por id na chegada.
- O parâmetro `targetRoom` do `handleSend` resolve corretamente o batching do
  React ao abrir uma DM e enviar a saudação no mesmo clique.
- `pollMessages` descarta resposta de sala trocada.
- Autorização de DM na rota (`lib/chat.ts`, `salaDireta`) e a matriz de
  permissão de apagar mensagem continuam cobertas por `lib/authz.test.ts`.
- Os botões das abas Online e Conversas não sofrem o problema do item 1: não há
  campo focado perto deles.

## A lição que vale para o resto do app

Quatro dos cinco defeitos vêm da mesma raiz: **um app de celular escrito com
suposições de mouse**. Hover que não existe, foco que muda o layout, ordem de
eventos que só vale com ponteiro fino.

Vale procurar o mesmo padrão nas outras telas antes que alguém relate.
