# Máquina de estados do SOS

Contrato do subsistema de socorro. Escrito **antes** da correção dos P0 de
2026-08-23, porque mudar o comportamento de escalada exige acordo explícito
sobre o que cada estado significa.

Princípio que resolve qualquer dúvida de projeto aqui:

> Um SOS só pode parar de procurar socorro quando existe **alguém de verdade
> indo socorrer**, ou quando um humano autorizado o encerrou.

## Estados de `sos_alerts.status`

| Estado | Significado | Escalada |
|---|---|---|
| `ativo` | Ninguém assumiu o resgate. | **roda** |
| `em_atendimento` | Existe ao menos um socorrista com `a_caminho` ou `no_local`. | pausada |
| `resolvido` | Encerrado: o velejador está seguro. | terminal |
| `cancelado` | Encerrado pelo próprio autor (falso toque, resolveu sozinho). | terminal |
| `falso_alarme` | Encerrado pela moderação. | terminal |

`em_atendimento` **não é terminal**. Essa é a mudança central.

## Estados de `sos_responders.state`

| Estado | Significado |
|---|---|
| `notificado` | Foi avisado pelo sistema. Não respondeu ainda. |
| `a_caminho` | Assumiu o resgate e está se deslocando. |
| `no_local` | Chegou onde o velejador está. |
| `nao_posso` | Recusou ou desistiu. |

Chamamos de **responsável vivo** qualquer socorrista em `a_caminho` ou
`no_local`. É esse conceito — não o campo `status` — que decide se a escalada
para.

## Transições

```
                    ┌──────────────────────────────────────┐
                    │                                      │
   criação ──────► ativo ──────────────────────────► em_atendimento
                    │   ▲   1º responsável vivo             │
                    │   │                                   │
                    │   └───────────────────────────────────┘
                    │       último responsável vivo desistiu
                    │       (reinicia o relógio da escalada)
                    │
                    └──► resolvido / cancelado / falso_alarme  (terminal)
                          autor ou moderação, a qualquer momento
```

### `ativo` → `em_atendimento`

Disparada quando um socorrista **autorizado** marca `a_caminho` ou `no_local`.

### `em_atendimento` → `ativo` (nova)

Disparada quando o **último** responsável vivo passa para `nao_posso`. O SOS
volta a procurar socorro.

Antes desta correção isso não existia: `em_atendimento` era um poço sem saída
(`lib/sos.ts` retornava `false` para qualquer status diferente de `ativo`). O
cenário de abandono — socorrista aceita, marca `a_caminho`, some — deixava o
velejador com o alerta congelado em 5 km e a escalada morta para sempre.

**Antiflapping.** O motivo original daquele congelamento era real: um
socorrista alternando `a_caminho`/`nao_posso` disparava rajadas de push a cada
volta. A solução aqui não é congelar, é **reiniciar o relógio**: ao voltar para
`ativo`, gravamos `escalated_at = NOW()`. O SOS volta a escalar, mas só depois
de esperar um estágio inteiro (2 min), nunca instantaneamente. Recuperação sem
tempestade de notificações.

### qualquer não-terminal → terminal

Só o autor do SOS ou moderação/admin (`canResolveSos`). Já estava correto em
`app/api/sos/[id]/route.ts`.

## Quem pode responder a um SOS

Regra de negócio (a ausência disso é o P0-2 do relatório de auditoria):

Pode responder quem satisfaz **ao menos uma** das condições:

1. **Foi notificado.** Existe linha em `sos_responders` para `(sos_id, user_id)`.
   É o caminho normal: o sistema escolheu essa pessoa por proximidade.
2. **Está comprovadamente dentro do raio atual.** Chegou na praia depois do
   disparo e abriu o app. A posição usada é a de `user_presence` **gravada pelo
   servidor**, nunca a que o cliente mandou no corpo do pedido.
3. **É moderação ou admin.** Coordenação de resgate.

E, em todos os casos:

- o SOS precisa existir;
- o SOS não pode estar em estado terminal;
- o autor não pode responder ao próprio SOS.

### Por que a condição 2 não reabre o vazamento

A autoenrolagem por proximidade parece recriar o furo, mas não recria: para
entrar por proximidade o atacante precisa **já estar fisicamente perto** das
coordenadas do SOS — que é exatamente a informação que ele tentava descobrir.
A verificação é feita contra a presença que o servidor gravou, então não há
como declarar uma posição falsa no mesmo pedido e passar.

Sem a condição 2, um velejador que chega na praia depois do disparo ficaria
impedido de ajudar. Num sistema de vida, fechar o caminho legítimo de resgate
para fechar um vazamento seria trocar um problema por um pior.

## Privacidade

Continua valendo, e a correção não afrouxa: coordenada exata só para quem foi
notificado, o autor, ou moderação (`canSeePos` em `app/api/sos/active/route.ts`).

Distinção que o código precisa manter explícita:

- **"o SOS existe"** — informação de baixo risco;
- **"onde a pessoa está"** — informação sensível.

Um usuário fora do raio pode saber que existe uma emergência; não pode saber
onde.

## Escalada é responsabilidade do servidor

Estágios: 5 km → (2 min) → 15 km → (2 min) → 50 km → fim.

A progressão **não pode** depender de alguém ter o app aberto. Antes desta
correção o único gatilho era `GET /api/sos/active`, então um SOS num spot vazio
nunca escalava. O gatilho passa a ser server-side e o endpoint de escalada é
idempotente: rodar duas vezes no mesmo minuto não escala duas vezes, porque o
`UPDATE` é condicionado ao raio que foi lido.
