# A escalada de SOS precisa de um scheduler externo

**Estado:** o cron do GitHub Actions funciona, mas roda a cada **~4,3 horas**
em vez dos 5 minutos configurados. Para emergência isso é insuficiente.

## A medição

Depois de destravar o agendamento (ver `docs/VARREDURA-2026-08-31.md`), o
workflow passou a rodar — e a rodar com sucesso. Mas a frequência real,
medida em 21,5 h de produção com `*/5 * * * *` configurado:

| De | Para | Intervalo |
|---|---|---|
| 31/08 19:15 | 31/08 23:14 | 4,0 h |
| 31/08 23:14 | 01/09 01:50 | 2,6 h |
| 01/09 01:50 | 01/09 06:55 | 5,1 h |
| 01/09 06:55 | 01/09 12:23 | 5,5 h |
| 01/09 12:23 | 01/09 16:48 | 4,4 h |

**Esperadas: 259 execuções. Reais: 6.** Uma a cada ~52 agendadas.

O GitHub trata `schedule` em repositório gratuito como trabalho de baixa
prioridade e o posterga sob carga da plataforma. A documentação deles é
explícita: não há garantia de horário. O comentário do workflow já avisava
que podia atrasar "vários minutos" — a realidade medida é **horas**.

## Por que isso importa

A escalada amplia o raio de busca aos 2 minutos: 5 km → 15 km → 50 km. Ela
existe porque **um pedido de socorro não pode morrer sem resposta em praia
vazia**.

Com varredura a cada 4,3 h, um SOS disparado às 17h só teria a primeira
ampliação por volta das 21h. Na água, isso é o mesmo que não ter escalada.

O alerta de silêncio de downwind tem limiar de 5 minutos e sofre do mesmo
problema: quem parou de reportar posição — exatamente quem mais importa
vigiar — só seria notado horas depois.

## O que JÁ está confirmado funcionando

Não é o código que está errado. Foi tudo verificado por execução real:

- O workflow dispara e conclui com **sucesso** (6 de 6 execuções).
- Os dois `curl` respondem 2xx — o que prova que **`CRON_SECRET` está
  corretamente configurado nos Secrets do GitHub Actions** (com `--fail`, um
  401 derrubaria o step).
- As rotas `/api/cron/sos-escalada` e `/api/cron/downwind-silencio`
  funcionam em produção.

O que falta é **frequência**, e ela não depende do nosso código.

## A solução: cron-job.org (grátis, ~5 minutos para configurar)

Roda no minuto certo, sem depender do GitHub.

1. Criar conta em https://cron-job.org (grátis, sem cartão).
2. **Create cronjob** → aba *Common*:
   - **Title:** `KiteNinja — escalada de SOS`
   - **URL:** `https://kiteninja.vercel.app/api/cron/sos-escalada`
   - **Schedule:** *Every 2 minutes* (ou "Custom" → `*/2 * * * *`)
3. Aba **Advanced** → *Headers* → adicionar:
   - **Name:** `Authorization`
   - **Value:** `Bearer <o mesmo CRON_SECRET que está na Vercel>`
4. **Create**.
5. Repetir para o segundo job:
   - **Title:** `KiteNinja — silêncio de downwind`
   - **URL:** `https://kiteninja.vercel.app/api/cron/downwind-silencio`
   - Mesmo header, mesma frequência.

**Como conferir que ficou certo:** o painel do cron-job.org mostra o
histórico de execuções com o status HTTP. Tem que ser **200**. Se aparecer
**401**, o header está errado (confira o prefixo `Bearer ` com espaço). Se
aparecer **503**, o `CRON_SECRET` não chegou àquele deploy da Vercel.

> ⚠️ O `CRON_SECRET` dá acesso às rotas de varredura. Cole-o só no campo de
> header do cron-job.org, nunca na URL — URL vai para log de servidor e para
> o histórico do painel.

### Alternativas

- **Upstash QStash** — mesma ideia, camada gratuita generosa, com retry
  automático em falha. Melhor se você já usa Upstash.
- **Vercel Pro** — libera cron `* * * * *` nativo, e aí `vercel.json` resolve
  sozinho, sem serviço externo. É a opção mais limpa, e é paga.

## O que fazer com o workflow do GitHub

**Deixar ligado.** Ele não atrapalha e serve de rede de última instância se o
scheduler externo cair. As duas vias chamam a mesma função idempotente (o
`UPDATE` é condicionado ao raio lido), então rodar as duas ao mesmo tempo
**não escala em dobro** — isso está provado em `scripts/verify-sos.ts`,
seção 3.

## Para o próximo agente

Este achado tem a mesma forma dos outros desta base: **nada estava quebrado**.
O workflow estava correto, o segredo configurado, as rotas respondendo 200, e
todas as execuções verdes. O defeito estava na diferença entre o que o
agendamento **promete** (`*/5`) e o que ele **entrega** (4,3 h) — e essa
pergunta nenhum teste, lint ou build faz.

A lição é a mesma: **medir no ambiente real.** "O job passou" não responde
"o job passou com que frequência".
