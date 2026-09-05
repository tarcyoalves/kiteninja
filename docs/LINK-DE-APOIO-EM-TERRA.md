# Link de apoio em terra

Verificação pedida: "veja se os links para apoio no carro estão funcionando em
dw e velejo individual".

**Downwind funcionava. Velejo solo não existia — e foi construído.** A primeira
metade deste documento é o levantamento; a última seção descreve o que passou a
existir.

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

## O que foi construído (decisão do dono: construir de verdade)

Os quatro itens acima, com duas decisões que definem o custo:

**A transmissão nunca liga sozinha.** Nenhum velejo solo manda posição ao
servidor a menos que a pessoa toque em "Convidar apoio". Isso responde de uma
vez ao custo (quem não usa não paga bateria nem invocação) e à privacidade
(ninguém é rastreado por um padrão que não escolheu). A constante
`ACOMPANHAMENTO_NUNCA_LIGA_SOZINHO` existe em `lib/apoioSolo.ts` para ser lida,
e tem teste protegendo a decisão.

**Nenhum GPS novo.** `useApoioSoloBeacon` recebe o último ponto que
`useTrilhaSessao` já mediu — o `watchPosition` do Modo Navegação continua sendo
um só. O custo real é uma requisição a cada 45s, e nem essa quando a pessoa
está parada (o beacon não reenvia ponto já enviado).

### As peças

| Peça | O que faz |
|---|---|
| `velejo_apoio_sessoes` / `velejo_apoio_posicoes` | Tabelas próprias. Reusar `downwinds` teria feito o velejo solo tomar a aba Mapa, contar como atividade em curso e aparecer na agenda. |
| `POST /api/velejo-apoio` | Abre ou **reaproveita** a sessão. Devolve o token em claro uma vez. |
| `DELETE /api/velejo-apoio` | Encerra TODAS as sessões abertas do usuário. |
| `POST /api/velejo-apoio/posicoes` | O velejador manda a própria posição. Responde 409 quando não há sessão — é o que desliga a transmissão sozinha. |
| `GET /api/velejo-apoio/[token]` | Leitura pública. Devolve nome, avatar, trilha e última posição. Nada mais. |
| `/velejo-apoio/[token]` | A página de quem acompanha. Sem providers do app, como a do motorista de downwind. |

### Decisões que valem reler antes de mexer

- **Reaproveita a sessão aberta.** Sem isso cada toque geraria um link novo
  apontando para outra sessão, e quem recebeu o primeiro veria uma trilha
  parada para sempre enquanto a pessoa velejava. É o defeito que o botão
  "Convidar" do downwind teve, com consequência pior.
- **`panTo`, não `setView`.** O mapa acompanha o velejador sem desfazer o zoom
  que quem está no carro acabou de dar para achar o acesso à praia.
- **Sem fila offline no beacon.** Diferente do downwind, isto NÃO é segurança:
  subir trinta pontos velhos de uma vez atrapalharia quem quer saber onde a
  pessoa está agora.
- **Mapa próprio (`TrilhaAoVivoMapa`), não `DownwindMapa`.** Aquele carrega N
  participantes, papéis, cores por pessoa e apoio vinculado — domínio que não
  existe nesta tela. Reusar amarraria as duas: mexer no mapa do downwind
  passaria a poder quebrar a página do amigo no carro.
- **A guarda de autorização (`lib/authz.test.ts`) pegou duas coisas certas** e
  foram corrigidas em vez de viraram exceção: os UPDATEs passaram a filtrar por
  `user_id` na própria query, e a rota pública ficou declarada com o porquê.

### Limite conhecido

O acompanhamento vive enquanto o Modo Navegação estiver aberto. Com o app
fechado, o serviço nativo de rastreio em segundo plano só reporta para
downwind — estender isso ao velejo solo é trabalho no app Android, não aqui.
