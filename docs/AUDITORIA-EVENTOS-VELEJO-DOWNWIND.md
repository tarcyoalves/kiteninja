# Auditoria de eventos, velejo e downwind (2026-09-04)

Varredura pedida com simulação de usuário real: primeiro toque, toque duplo,
toques rápidos, abrir/fechar/voltar, salvar, apagar, recarregar, sair e voltar.
Sete defeitos, e **seis deles são a mesma história**: um botão que dispara
trabalho de rede sem trava e sem sinal na tela.

## O padrão que apareceu seis vezes

Um botão chama uma função `async`. Enquanto a resposta não volta:

- nada gira, nada desabilita, nada muda de cor;
- o dedo repete — no 4G da praia, sempre repete;
- cada toque vira outra requisição.

O sintoma que o usuário relata é "cliquei e não respondeu", ou "precisei clicar
de novo". A causa nunca é o clique perdido: **o clique foi recebido, e o app não
disse nada.** Por isso nenhum dos consertos aqui é `setTimeout`, `debounce` ou
handler duplicado — um temporizador esconderia o toque repetido e deixaria a
divergência de estado exatamente onde estava.

A forma do conserto é sempre a mesma, e vale para o próximo botão que alguém
escrever:

1. **Guarda no início do handler.** O estado do React não muda antes do fim do
   clique atual, então dois toques muito rápidos chegam os dois com o botão
   ainda habilitado. `if (emVoo) return;` é a trava de verdade.
2. **`disabled` no botão.** É o que a pessoa enxerga. Sem isso, a trava é
   invisível e o botão parece morto.
3. **O rótulo NÃO muda.** Trocar "Iniciar" por "Iniciando..." mexe na largura do
   botão embaixo do dedo — foi assim que o chat perdeu toques (ver
   `VARREDURA-CHAT.md`). Quem gira é o ícone.
4. **A falha aparece.** `catch {}` é o mesmo defeito com outra roupa.

## Os defeitos

### 1. CRÍTICO — o velejo do dono ficava sem foto nenhuma

Regressão do commit `14ca2f9`. O logger passou a mandar `fotoUrls` e o INSERT
continuou gravando `${photoUrl || null}` em `sessions_log.photo_url`, que virou
NULL em todo velejo novo. O feed lia `session_photos` e mostrava tudo; o logbook
e o detalhe liam só a coluna legada e não mostravam nada. **A mesma pessoa via o
próprio velejo completo na aba Comunidade e vazio na aba dela.**

Consertado nos dois lados: o INSERT grava a primeira foto como capa, e os dois
GET agregam `session_photos` com `COALESCE` para a capa legada. O COALESCE não é
decoração — a gravação em `session_photos` acontece **depois** do INSERT da
sessão e dentro de `try/catch` (um velejo nunca cai por causa de foto), então
existe um caminho real em que só a capa foi gravada.

Família recorrente nesta base: o dado é registrado direito e não chega a lugar
nenhum. Já apareceu em `event_registrations` (só contada, nunca listada), em
`photo_url` (gravada, nunca selecionada no feed) e agora aqui, ao contrário.

### 2. ALTO — confirmar presença podia deixar tela e banco em desacordo

`POST /api/events/[id]/register` era um alternador cego: apaga; se nada saiu,
insere. Atômico no banco, mas atômico em cima da pergunta errada. Dois toques
mandavam dois POSTs que se desfaziam, e **a resposta que voltasse por último
decidia a tela** — que podia então discordar do banco para sempre, sem erro em
lugar nenhum.

A raiz não é o segundo clique, é o cliente não poder dizer o que quer. Agora
manda a intenção (`participar: true|false`), o que torna repetir inofensivo:
inserir o que já existe e apagar o que não existe são idempotentes.

A rota **mantém a alternância quando o corpo não vem**. Não é indecisão: um PWA
instalado roda o JS da versão anterior por dias depois do deploy, e quebrar a
confirmação de presença para essa gente seria pior que o defeito.

### 3. ALTO — "Iniciar" travessia ficava mudo por segundos

O botão mais importante do app. `iniciarDownwind()` faz duas idas ao servidor
(POST de status + recarregar). Durante todo esse tempo, nada na tela mudava, na
hora exata em que a pessoa está entrando na água.

### 4. MÉDIO — excluir velejo falhava em silêncio

`deleteSession` engolia o erro e chamava `loadSessions()`: a linha reaparecia
sozinha, sem uma palavra. Do lado de cá da tela isso é indistinguível de "o app
apagou e desapagou". Agora devolve `{ok, error}` como `deleteEvent` — as duas
exclusões do app se comportam igual — e o botão trava durante a ida (antes, o
segundo toque abria um segundo `confirm()` da mesma linha).

A restauração passou a usar a lista anterior em vez de recarregar: recarregar
custa uma volta na rede que **acabou de falhar**, e ainda apagaria um velejo
recém-criado que só existe no cliente.

### 5. MÉDIO — "Convidar" criava um token por toque

`INSERT INTO downwind_user_invites` a cada chamada, sem reaproveitar nada. Dois
toques = dois convites válidos, e a área de transferência com o último enquanto
o primeiro segue por aí sem ninguém saber. A falha era muda (`catch {}` mais um
`return` no `!res.ok`): sem rede, tocar não fazia absolutamente nada.

Quando o convite é criado mas a cópia falha (contexto não seguro), a mensagem
diz isso — senão a pessoa acha que não gerou e toca de novo, criando outro.

### 6. BAIXO — "Tentar de novo" do rastreamento descartava o resultado

Botão que existe justamente para quando a rede está ruim, sem trava, sem sinal,
e jogando fora o `{ok, error}` que recebia.

### 7. MELHORIA — tocar em quem confirmou não abria o perfil

Em todo o resto do app (feed, busca, notificações, detalhe do velejo), tocar num
velejador abre o perfil. Na lista de confirmados, não abria nada: a resposta
para "quem é esse que vai?" era o nome e mais nada.

A linha inteira virou alvo, não só o avatar — é dedo em praia com sol. A folha
fecha antes de abrir o perfil: as duas são sobreposições, e empilhar travaria o
scroll do fundo duas vezes.

## O que NÃO foi mexido, e por quê

- **Caixa de comentário do feed da Comunidade** (`views/FeedView.tsx`,
  `handleSendComment`): mesmo padrão do item 5 — otimista, sem trava, Enter e
  botão dão dois caminhos para o mesmo envio duplicado. Fica fora porque o feed
  de posts não é eventos, velejo nem downwind, e o brief pede sinalizar antes de
  ampliar escopo. **É o próximo candidato.**
- **Entrar no Modo Navegação sem esperar a rede.** Hoje o "Iniciar" espera as
  duas idas ao servidor antes de abrir o Modo Navegação. Abrir na hora e deixar
  o POST correr atrás seria melhor para quem está entrando na água, mas muda
  comportamento de uma tela de segurança — decisão do dono, não minha.
- **`VISIBILIDADE_PADRAO = 'privado'`.** Continua fechado por omissão. Ver o
  bloco no topo de `lib/downwindVisibilidade.ts`.

## Verificação

`tsc --noEmit`, `eslint .` (0 erros), 974 testes, `verify-sql.ts` (313 checks
contra Postgres de verdade), `verify-sos.ts` (59) e `next build` — a cada um dos
três commits, não só no fim.
