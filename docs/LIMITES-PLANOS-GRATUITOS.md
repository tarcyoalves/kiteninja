# Limites dos planos gratuitos — e como o app fica dentro deles

O KiteNinja roda inteiro em plano gratuito. Esta página junta os números
**conferidos na documentação oficial em 13/11/2026** e o que no código impede
o app de estourar cada um. Os planos mudam: reconfira ao menos a cada seis
meses (links no fim de cada seção).

## Vercel (plano Hobby)

| Recurso | Incluído | Se estourar |
|---|---|---|
| Deploys por dia | 100 | espera 1 dia |
| Builds por hora | 100 | espera 1 hora |
| Builds ao mesmo tempo | 1 | os outros esperam na fila |
| **Blob: envios de arquivo ("operações avançadas")** | **2.000 por mês** | **Blob bloqueado por 30 dias** |
| Blob: espaço | 1 GB | idem |
| Blob: leituras sem cache ("operações simples") | 10.000 por mês | idem |
| Blob: tráfego | 10 GB por mês | idem |

**Blob bloqueado quer dizer todas as fotos do app sem carregar por um mês**,
não só "não dá para enviar". É o limite mais perigoso da lista.

O que o código faz:

- Cada foto enviada (velejo, relato, avatar, anúncio) gasta 1 envio. O app
  conta os envios no banco e **para de aceitar foto nova em 1.500 a cada 30
  dias**, com aviso na tela — `orcamentoMensalDoBlob` em `lib/rateLimit.ts`.
  A folga até 2.000 é para o painel do Blob (navegar lá também gasta) e para a
  migração das fotos antigas.
- Cada usuário envia no máximo 40 fotos por dia (`uploadFoto`).
- As fotos são comprimidas no celular antes de subir.
- **Abrir o painel do Blob na Vercel gasta operações.** Evite ficar navegando
  nos arquivos por lá.
- Cada `git push` vira deploy. Hoje são **seis por push** (dois projetos × três
  ramos — tarefa T03 do plano). Por isso o trabalho é juntado e publicado num
  push só. Resolver a T03 corta isso para um terço.
- Os crons do `vercel.json` rodam uma vez por dia neste plano.

Fontes: vercel.com/docs/vercel-blob/usage-and-pricing e vercel.com/docs/limits.

## Neon (plano Free)

| Recurso | Incluído | Se estourar |
|---|---|---|
| Espaço | **1 GB por projeto** | gravações falham até liberar espaço (nada é apagado) |
| Computação | 100 CU-horas por mês (≈ 400 h com o banco no menor tamanho) | **banco suspenso até o mês virar** |
| Tráfego de saída | 5 GB por mês | banco suspenso até o mês virar |
| Hibernação | após 5 min sem uso (não dá para desligar) | — |
| Restauração a um instante anterior | até 6 horas atrás | — |

Um mês tem ~730 horas e a cota cobre ~400: **o banco não pode ficar acordado
o tempo todo.** É por isso que:

- não existe (e não deve existir) consulta em laço curto com o app fechado —
  um cron externo de 1 em 1 minuto no SOS gastaria a cota (ver
  `docs/CRON-EXTERNO-SOS.md`);
- o painel admin só atualiza sozinho com a aba aberta, de 60 em 60 s;
- fotos não ficam mais no banco (V01); as antigas saem com a migração.

Os documentos antigos deste repositório dizem "0,5 GB": era o limite da época.

Fonte: neon.com/docs/introduction/plans.

## GitHub (plano Free)

| Recurso | Incluído | Se estourar |
|---|---|---|
| Actions em repositório **público** | grátis nos runners padrão | — |
| Actions em repositório **privado** | US$ 12 de uso por mês (≈ 2.000 min de Linux) | Actions bloqueado até o mês virar |
| Artefatos (ex.: APK gerado no CI) | 500 MB | uploads falham |

O que o código faz: o CI roda só em push na `main`; nenhum workflow agendado
novo; agentes não disparam workflow à mão. Runner Linux em tudo (Windows e
macOS custam mais por minuto).

Fonte: docs.github.com/en/billing/concepts/product-billing/github-actions.

## Antes de mudar qualquer coisa, pergunte

1. Isso cria arquivo no Blob? Passa pelo teto mensal?
2. Isso consulta o banco com o app fechado, ou em laço? Quantas vezes por hora?
3. Isso guarda algo grande numa coluna do banco?
4. Isso faz mais de um push, ou dispara workflow?
