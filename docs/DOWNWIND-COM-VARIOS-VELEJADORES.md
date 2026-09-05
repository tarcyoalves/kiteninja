# Downwind com vários velejadores, cada um no seu aparelho

Varredura pedida: simular um DW de grupo real — organizador, N velejadores,
apoio em terra — e conferir o que cada tela faz.

## Primeiro, uma correção minha

No turno anterior eu afirmei, e escrevi no commit `3880e05`, que "bastava o
organizador encerrar primeiro para todo o grupo perder o registro". **Isso está
errado.** `podeEncerrarDownwindComoUsuario` recusa com 409 enquanto houver
velejador na água: *"Ainda há N velejador(es) na água. O downwind só encerra
quando todos saírem."* O organizador não consegue encerrar por cima de
ninguém.

A correção que eu fiz continua valendo — mas por outro motivo, e a investigação
correta revelou o buraco de verdade, que é o cancelamento.

## 1. Cancelar apagava a travessia do grupo inteiro

Como encerrar exige quórum, **cancelar é o único caminho que tira do ar um
downwind com gente ainda em `navegando`** (`podeCancelarDownwind` não exige
quórum de propósito — é a válvula para "o grupo desistiu antes de sair da
praia").

E o ramo de cancelamento não chamava `resumirEPurgar`. Então:

- `distancia_km`, `velocidade_max_nos` e `trilha_reduzida` ficavam NULL para
  **todos** os participantes;
- a purga preguiçosa apaga `downwind_posicoes` de downwind **cancelado** depois
  de 7 dias.

Uma semana depois de um cancelamento, a travessia do grupo tinha sumido do
servidor sem nunca ter sido resumida. O motivo de cancelar é banal — o vento
morreu no meio, alguém se machucou, o organizador tocou no botão errado — e o
grupo velejou 15 km de qualquer jeito.

Agora resume antes de sumir, e só quando havia travessia (`em_andamento`).

## 2. "Sem sinal" gritava por quem nem tinha chegado na praia

A faixa contava como sem sinal todo participante sem report recente, excluindo
só quem já encerrou ou desistiu. `estadoSinal(null, agora)` devolve `sem_sinal`
— corretamente, porque não há como saber.

No grupo real: dez confirmam na véspera, quatro entram na água às 8h, seis ainda
estão tomando café. Desde o primeiro instante a faixa anunciava **"6 sem
sinal"**, em vermelho. O apoio em terra, que nunca reporta posição porque não
navega, entrava na conta também.

Alarme falso em indicador de segurança é pior que indicador nenhum: ensina o
grupo a ignorar a faixa, inclusive na hora em que ela estiver certa.

`contarSemSinal` só conta quem disse que está na água. Sobram as duas situações
que são alarmantes de verdade: quem reportava e parou, e quem tocou Iniciar e
nunca conseguiu reportar (GPS que não subiu).

## 3. O organizador encerrando a participação de outro

`podeMudarEstadoDeParticipante` permite ao organizador marcar outro como
`encerrado`. É recurso legítimo e necessário: o velejador chegou na praia com o
celular morto, e sem isso o downwind inteiro trava por causa do quórum.

Para quem era marcado, porém, acontecia em silêncio total. O servidor não
guarda os números dele nessa transição (o resumo por participante só é aceito
de quem encerra a PRÓPRIA participação), e a tela o solta do mapa ao vivo sem
uma palavra. Restava só o aviso do Logbook, que depende de ele ir procurar em
12h.

Agora o aparelho dele — que ainda tem a medição inteira — oferece o registro na
hora.

## O que foi verificado e está CERTO

Vale registrar para não ser reinvestigado:

- **Um GET serve todo mundo.** `GET /posicoes` devolve participantes + última
  posição num único `LEFT JOIN LATERAL`, e só a trilha do próprio solicitante.
  Nunca uma requisição por participante. Com 20 riders a 30s, é 0,7 req/s.
- **Participante que nunca reportou aparece na lista** (lat nulo) em vez de
  sumir — é o `LEFT JOIN LATERAL` em vez de `DISTINCT ON`. É o que faz "quem
  ainda não entrou" ser visível.
- **Cor por pessoa é determinística** (hash FNV-1a do `userId` sobre 12
  matizes), então a mesma pessoa tem a mesma cor no aparelho de todo mundo, e
  não troca quando alguém entra ou sai da lista.
- **Corrida do "Iniciar"**: vários tocando ao mesmo tempo é resolvido no banco
  (`UPDATE ... WHERE status = 'aberto'`), e só o vencedor dispara o aviso aos
  seguidores — sem trava em JavaScript.
- **SOS chega ao grupo inteiro** independente de distância, com texto próprio
  para companheiro de travessia e para o apoio em terra, e funciona **sem GPS**
  (o SOS sem coordenada avisa o grupo do downwind mesmo assim).
- **Posição de quem saiu da água não é servida a ninguém**, nem à própria
  pessoa.
- **Limite de envio de posição é por usuário** (120/min), então um rider em
  laço de erro não afeta os outros.
- **Quórum de encerramento** conta `confirmado` como bloqueante de propósito: o
  velejador que entrou na água sem marcar 'navegando' é justamente o que mais
  precisa ser contado.

## Limite conhecido

Quem tem a participação encerrada por outra pessoa **com o app fechado** não vê
a oferta de registro. O velejo continua recuperável pelo aviso do Logbook
enquanto a cópia local vale (12h). Depois disso, os números só existem no resumo
do downwind.
