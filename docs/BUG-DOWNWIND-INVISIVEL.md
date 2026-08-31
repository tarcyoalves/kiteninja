# O downwind que não aparecia para ninguém — nem para quem o criou

**Relato do dono, 31/08/2026:**

> "um velejador criou um evento ou dw, e nao funcionou, olhei direto pelo app
> wpa e nao apareceu evento algum... ele compartilho o link e nao esta ok.
> isso nao pode acontecer."

## O que realmente aconteceu

Sondando a produção com o link real que ele mandou:

| Sonda | Resposta | Conclusão |
|---|---|---|
| `GET /api/downwind/invite/<token>` | **200** com os dados | O link **funciona** |
| `GET /api/downwind/<id>/live` sem sessão | **404** | O downwind é `privado` |
| `GET /api/downwind` | **405 Method Not Allowed** | **Não existe rota de listagem** |

O downwind existe, está `em_andamento`, chama-se "Pernambuquinho x fortaleza"
e foi criado pelo Jefferson. O link de convite está perfeito.

**O problema é que nada o lista.**

1. `GET /api/downwind` não existia — só `POST`. Nenhuma tela do app jamais
   pediu "quais downwinds existem".
2. Um downwind `privado` **não cria evento** (só o `comunidade` cria, em
   `app/api/downwind/route.ts`). Então ele também não aparecia na aba Eventos.
3. O único caminho de descoberta era `/api/downwind/ativo`, que devolve
   apenas o downwind em que **você já é participante**.

Resultado: quem criou um downwind privado não conseguia ver o que criou. Do
ponto de vista do app, ele não existia. A única forma de outra pessoa entrar
era receber o link individualmente — e mesmo assim ela nunca veria o downwind
numa lista depois.

**Não era um bug de código quebrado. Era uma funcionalidade que faltava
inteira**, e por isso nenhum teste podia pegá-la: não havia nada errado para
falhar.

## O que foi feito

### `GET /api/downwind` — a lista que faltava

Devolve os downwinds que o velejador pode ver, com nome, trajeto, status,
visibilidade, criador e contagem de participantes. **Nenhuma posição** — ver
onde as pessoas estão é outra decisão, tomada por `podeVerPosicoes` /
`podeVerReplayAoVivo` nas rotas de item.

Quem entra na lista está em `podeListarDownwind` (`lib/downwindAcesso.ts`),
puro e testado. Três portas:

- **criador** — quem criou sempre vê o que criou. *Esta é a que faltava e a
  que causou o relato.*
- **participante** — quem entrou continua vendo, inclusive depois de encerrar.
  É o histórico da travessia dele.
- **comunidade** — downwind aberto aparece para todos. É o que torna o app um
  lugar onde se *descobre* uma remada, não só onde se confirma uma para a qual
  já te chamaram.

O que **não** abre porta: ser moderador. Moderação age sobre um downwind
específico; uma lista que despejasse todos os downwinds privados do app na
tela de um moderador seria vigilância, não moderação.

O convidado do link de 12 h continua vendo só o downwind ao qual foi escopado
— sem isso, um link de apoio em terra viraria uma janela para a lista inteira.

### A tela

`components/activity/ListaDownwinds.tsx`, na aba Eventos. O cartão mostra a
**visibilidade** de forma explícita ("Comunidade" / "Só por convite") — era
exatamente a informação que faltava para entender por que "não apareceu nada".
Um downwind privado é privado de propósito, mas quem o criou precisa ver isso
escrito, não deduzir do silêncio.

Quem criou ganha um botão **Convidar** que gera e copia o link num toque.
Downwind em andamento ganha **Ver ao vivo**.

## A trava que vale mais que a correção

Este defeito pertence a uma classe que **já apareceu quatro vezes** nesta
base: `statusTrackingNativo`, `zerarNotificacoesNaoLidas`, `latestIncomingDm`
e agora `downwinds`.

> **Um valor exposto num contexto que nenhuma tela consome.**

Nada acusa isso. O campo tem tipo, é preenchido, é devolvido no `value` do
provider. Build, typecheck, teste e lint passam **todos verdes**. O único
sintoma é a funcionalidade não existir na tela, e ninguém descobre até um
usuário reclamar.

`lib/contextoConsumido.test.ts` agora lê a interface do contexto e exige que
cada campo seja **desestruturado de `useKiteData()`** em algum arquivo fora do
próprio contexto.

**A primeira versão deste teste era inútil e foi corrigida.** Ela procurava a
palavra em qualquer lugar do projeto, e `downwinds` "passava" porque aparecia
como nome de prop num componente que ninguém tinha ligado. O teste dava verde
com o defeito presente — o mesmo pecado dos testes que ele existe para
substituir. Só depois de exigir o *destructuring do hook* ele passou a falhar
de verdade quando o consumo é removido (verificado nas duas direções).

### O que a trava já encontrou

Cinco campos expostos e nunca consumidos, todos removidos da interface
pública:

| Campo | Situação |
|---|---|
| `setUnreadChatCount` | setter cru de estado que o contexto gerencia sozinho |
| `setMyActiveSos` | idem — e expor o setter de um SOS ativo deixa qualquer tela zerá-lo por engano |
| `isNewAlertOpen` + `setIsNewAlertOpen` | par inteiro morto; `setIsNewAlertOpen` era desestruturado no `SidebarDrawer` e **nunca chamado** |
| `isHydrated` | resíduo |
| `clearUnreadChat` | chamado só dentro do próprio contexto |

## Para o próximo agente

1. **Ao expor algo num contexto, mostre na mesma mudança quem consome.**
   `lib/contextoConsumido.test.ts` vai cobrar. Não silencie o teste
   adicionando exceção — ou a tela usa, ou o campo não deveria estar exposto.

2. **Uma funcionalidade que falta inteira não falha em teste nenhum.** Perguntar
   "isto está quebrado?" não encontra "isto nunca existiu". A pergunta que
   encontra é *"um usuário consegue fazer o caminho completo?"* — do criar ao
   outro velejador ver.

3. **Sonde a produção.** Este bug e o do mapa ao vivo
   (`docs/BUG-MAPA-AO-VIVO-500.md`) foram os dois encontrados com `curl`
   contra o ambiente real, não com varredura de código. As verificações locais
   respondem "o código é coerente consigo mesmo"; só o ambiente real responde
   "isto funciona".

## Pendências relacionadas, ainda abertas

- **`ORDER BY e.event_date ASC`** em `app/api/events/route.ts` ordena uma
  coluna `TEXT` que guarda data por extenso em português ("31 de agosto de
  2026"). A ordenação é alfabética, portanto errada. Não faz sumir nada — o
  cliente só exibe a string, nunca a reparsa — mas coloca os eventos fora de
  ordem. Consertar exige uma coluna de data real.
- **A varredura de 5 em 5 minutos nunca rodou** — ver a nota sobre a branch
  default em `docs/VARREDURA-2026-08-31.md`.
