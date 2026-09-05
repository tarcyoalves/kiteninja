# Varredura do downwind: gravar → fechar → salvar → registrar

Pergunta do dono: "está tudo ok? vai gravar? quando fechar, vai salvar? vai
registrar todos os velejos?"

Resposta antes desta varredura: **não.** Quatro defeitos, todos no fim do
fluxo — a parte que só aparece depois de a pessoa já ter velejado.

## 1. O velejo era gravado com a trilha de ANTES da travessia

Três coisas conspirando:

- O Modo Navegação mede a trilha de verdade (`useTrilhaSessao`, GPS local) e
  entrega tudo em `onSair`. A tela do downwind ignorava o argumento:
  `onSair={() => setModoNavegacaoAtivo(false)}`.
- `encerrarVelejo` usava `minhaTrilha`, do poll de `GET /posicoes` — que
  **pausa enquanto o Modo Navegação está por cima**, ou seja, do início ao fim
  do velejo.
- O poll não buscava ao despausar: esperava o próximo tick de 30s.

Sair da tela preta e segurar "Encerrar velejo" leva 1,5 s. 1,5 ≪ 30. Então o
logbook recebia a trilha de antes da travessia: distância ~0, velocidade máxima
~0, mapa vazio. **Registro existindo e errado, que é pior que registro
faltando** — o errado ninguém vai procurar.

Conserto: a tela guarda o `ResumoNavegacao` e **acumula** (dá para entrar e
sair do Modo Navegação várias vezes na mesma travessia, e cada entrada monta um
`useTrilhaSessao` do zero). No encerramento, mescla com a trilha do servidor:
a local tem os pontos que o beacon não conseguiu subir num túnel de rede, a do
servidor tem os que o serviço nativo gravou com o app morto. `mesclarTrilha`
deduplica por timestamp. E o poll passou a buscar na hora ao despausar.

Detalhe que quase escapou: "Encerrar" é um toque de 1,5 s, e o handler que
dispara no fim é o que existia quando o dedo encostou. Com a busca imediata, a
resposta chega **durante** o toque — então a trilha do servidor é lida de uma
ref, não do closure.

## 2. Quem não encerrou por conta própria perdia o velejo inteiro

O mais grave, e o que responde direto à pergunta.

`GET /api/downwind/ativo` só devolve `aberto` e `em_andamento`. Quando o
organizador encerra, na varredura seguinte de cada participante o downwind vira
`null`, `mapaMostraDownwind` passa a ser `false`, o mapa ao vivo sai do ar e
volta o mapa normal. Ninguém é perguntado nada.

Numa travessia de grupo bastava o organizador encerrar primeiro — que é o
caminho normal — para **todo o resto do grupo perder o registro de 20 km de
água**, sem aviso.

Conserto: o contexto observa a transição (eu estava `navegando` e o downwind
sumiu), busca `GET /api/downwind/[id]/resumo` — que o servidor acabou de
preencher em `resumirEPurgar` — e abre o logbook preenchido.

Três travas, cada uma por um motivo:

- só para quem estava `navegando` (apoio em terra nunca chega nesse estado);
- só acima de `DISTANCIA_MINIMA_PARA_REGISTRO_KM`, para um toque acidental no
  Iniciar não virar rascunho de velejo de 40 metros;
- `encerradoPorMimRef`, porque o **último** participante a encerrar fecha o
  downwind inteiro: sem ela, a mesma ação abriria o logbook duas vezes.

## 3. `encerrarMinhaParticipacao` não tinha como mandar a trilha

A assinatura aceitava só `distanciaKm` e `velocidadeMaxNos`, e `encerrarVelejo`
não mandava nem esses. A rota PATCH aceita `trilhaReduzida` e grava em
`downwind_participantes` — nada no app enviava.

Isso **não** deixava o resumo vazio: `resumirEPurgar` calcula tudo no servidor
a partir de `downwind_posicoes` ao encerrar. O que faltava era o dado do
aparelho de quem encerra a própria participação antes disso — que é melhor,
porque inclui os pontos que o beacon não conseguiu subir.

## 4. Encerrei meu velejo e continuei "na água" para o app

`travessiaEmAndamento` olhava só o status do DOWNWIND, nunca se eu ainda fazia
parte dele. Quem chegava na praia e encerrava o próprio velejo continuava,
para o app:

- com a aba Mapa presa no mapa ao vivo do grupo, **sem saída** —
  `fecharTelaDoDownwind` não tem efeito enquanto a travessia é "em andamento";
- recebendo "Você está na água no downwind X. Encerre a sua participação antes
  de iniciar outra atividade" no botão PLAY — para alguém que tinha acabado de
  encerrar. E bloqueado de iniciar qualquer outra coisa.

Conserto na raiz: `aindaEstouNaTravessia(estado)` — `encerrado` e `desistiu`
são finais. Acompanhar o grupo que ficou continua possível, mas vira a mesma
porta do downwind agendado: **a pedido**, não imposição.

Estado ausente conta como participando, de propósito: uma resposta antiga do
servidor sem o campo não pode liberar duas navegações ao mesmo tempo.

## O que JÁ estava certo

Vale registrar, porque foi verificado e não precisa ser mexido de novo:

- **O beacon** (`lib/useDownwindBeacon.ts`) não pausa com a aba oculta, tem
  fila em `localStorage` para o que falhar, e devolve à fila o ponto recusado.
  A gravação em si é sólida.
- **`resumirEPurgar`** calcula distância, velocidade máxima e trilha reduzida
  de **todos** os participantes ao encerrar, direto de `downwind_posicoes`.
- **O cron de abandono** (`downwind-silencio`) encerra o downwind largado
  depois de 6h de silêncio e chama `resumirEPurgar` — sem ele, quem fecha o app
  na praia deixaria a travessia presa em `em_andamento` para sempre.
- **App fechado no meio da travessia**: a trilha local sobrevive
  (`lib/trilhaPersistida.ts`, validade de 12h) e o Logbook mostra "você tem um
  velejo que não chegou a ser registrado" (`AvisoVelejoNaoRegistrado`). Vale
  para o downwind também, porque é o mesmo `useTrilhaSessao`. A duração sai do
  último ponto da trilha, nunca de `Date.now()`.

## Limite conhecido, não corrigido

Se o app ficar fechado **mais de 12 horas** depois da travessia, a cópia local
expira e o velejo não é mais oferecido ao logbook — os números continuam no
resumo do downwind, acessíveis pelo card do evento, mas não viram sessão.

Fechar isso exige o servidor marcar "velejo pendente de registro" por
participante, com uma ligação entre `sessions_log` e `downwinds` que hoje não
existe. É mudança de escopo: sinalizada, não feita.
