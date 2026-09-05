# Link de apoio em terra: funciona no downwind, não existe no velejo solo

Verificação pedida: "veja se os links para apoio no carro estão funcionando em
dw e velejo individual". Nenhum código foi alterado nesta apuração — é um
levantamento.

## Downwind: FUNCIONA, ponta a ponta

Caminho conferido inteiro:

1. **Gerar.** Botão "Convidar apoio" na tela do downwind ao vivo, visível para
   o organizador (`souOrganizador`). Chama `POST /api/downwind/[id]/convites`.
2. **Autorizar.** A rota exige organizador **DESTE** downwind ou moderação —
   não `requireDownwindOrganizer()`, que é a permissão geral. E recusa
   downwind `encerrado`/`cancelado`.
3. **Token.** 12h de validade, o claro só existe na resposta (o banco guarda o
   hash), e `max_usos` fica NULL de propósito: **vários motoristas entram com o
   mesmo link**.
4. **Abrir.** `/dw-motorista/<token>` pré-valida no servidor antes de renderizar
   qualquer coisa (`buscarConviteValido`: não revogado, não expirado, dentro dos
   usos, e downwind ainda `aberto` ou `em_andamento`). Link morto mostra a tela
   de "link indisponível", nunca um formulário que não vai funcionar.
5. **Entrar.** `POST /api/downwind/convite/[token]/entrar` cria uma conta
   convidada (`downwind_guest_of`), insere como `apoio_terra` e abre sessão de
   12h.
6. **Ver.** `podeVerPosicoes` aceita qualquer participante que não tenha
   desistido — inclusive apoio em terra. `GET /posicoes` aceita a sessão de
   convidado **escopada àquele downwind** (convidado de outro downwind recebe
   404, mesma regra de "não confirma existência").
7. **Aparecer.** O motorista também roda o beacon: o carro aparece no mapa dos
   velejadores, não só o contrário.

A página do convidado não monta os providers do app (Auth/KiteData/Downwind) —
o motorista nunca carrega spots, feed nem nada do app geral. Isso é garantido
pela árvore de componentes, não só pela autorização do servidor.

## Velejo solo: o botão existe, o link não leva a lugar nenhum

Na folha "Iniciar atividade", embaixo de Velejo Solo:

> Quer que alguém em terra acompanhe?  **[Convidar apoio]**

O que ele compartilha (`onCompartilharSoloLink`, em `views/MapView.tsx` e
`app/page.tsx`):

```js
url: window.location.origin
```

A **página inicial do app**. Quem recebe abre o KiteNinja e não vê nada sobre
aquele velejo — nem posição, nem trilha, nem aviso de que alguém está na água.

E não é só o link estar errado: **não há o que acompanhar.** Um velejo solo não
manda posição para o servidor em momento nenhum. `useTrilhaSessao` grava só na
memória e no `localStorage` do próprio aparelho; `useDownwindBeacon`, que é o
que reporta posição, exige um `downwindId`. Não existe tabela, rota nem página
de acompanhamento de velejo individual — `dw-live` e `dw-motorista` são
exclusivos de downwind.

`POST /api/velejos/inicio` é outra coisa: avisa os SEGUIDORES que a pessoa
entrou na água. É notificação, não acompanhamento.

### O que seria preciso para existir de verdade

Não é conserto, é funcionalidade nova, e o custo está quase todo no servidor:

1. Posição do velejo solo chegando ao servidor (tabela + rota, ou reaproveitar
   `downwind_posicoes` com uma sessão solo).
2. Token de acompanhamento com validade, no mesmo molde de
   `downwind_convites` — que já resolveu o problema de "link para quem não tem
   conta".
3. Página pública tipo `/velejo-apoio/<token>`, que pode reusar
   `DownwindMapa` inteiro.
4. O beacon rodando fora de downwind, com o custo de bateria e de invocação
   que isso traz para TODO velejo solo, não só os acompanhados.

Enquanto isso não existir, o botão promete o que o sistema não faz. As saídas
possíveis, em ordem de custo: trocar o texto para o que ele realmente faz
(avisar que entrou na água), esconder o botão, ou construir o item acima.
