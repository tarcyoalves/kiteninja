# A escalada de SOS precisa de um scheduler externo

**Estado:** o cron do GitHub Actions funciona, mas roda a cada **3 a 6 horas**
(medido de novo em 05/10/2026) em vez dos 5 minutos configurados. Para
emergência isso é insuficiente. Desde a T01 o polling dos clientes também
puxa a varredura (ver "O que mudou na T01"), e o painel admin mostra se ela
está viva; o agendador externo abaixo cobre a madrugada.

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

## O que mudou na T01 (05/10/2026): duas camadas, e o painel mostra se estão vivas

1. **Carona no polling (já no código, sem serviço externo).** Todo cliente com o
   app aberto chama `GET /api/sos/active` a cada 12 s. Essa rota agora dispara a
   varredura **global** (`varrerEscaladas`, todos os SOS abertos, não só os do
   usuário que fez a chamada) **no máximo uma vez por minuto no app inteiro**.
   Duas travas: memória da instância (não toca o banco se esta instância tentou
   há menos de 60 s) e uma linha em `app_settings` com UPSERT condicionado
   (decide entre instâncias). Código: `lib/sosVarredura.ts`. Sem ninguém com o
   app aberto, esta camada não roda — por isso existe a de baixo.
2. **Agendador externo (você cria, abaixo).** Cobre o caso "SOS no meio da
   madrugada, ninguém com o app aberto".

As duas escrevem o "último sinal de vida" na mesma linha. No painel admin
(`/admin`), o indicador **"Última varredura do SOS: há X min"** fica **vermelho
acima de 10 min**. Esse é o jeito de saber se o agendador parou.

## ⚠️ Leia antes: custo no Neon gratuito

Chamar o banco a cada minuto **o impede de hibernar**. O Neon Free hiberna
após 5 min sem uso e dá **100 CU-horas por mês** (a página de planos do Neon,
consultada em 05/10/2026, diz que isso equivale a ~400 h de uma computação de
0,25 CU). Um banco acordado 24 h por dia gasta ~180 CU-h por mês: **o limite
acabaria por volta do dia 17, e com ele o banco inteiro — o app e o SOS —
suspende até o mês virar.**

Nenhum intervalo menor que 5 min deixa o banco dormir (e um intervalo maior só
troca "acordado sempre" por "acordado 5 min a cada chamada"). Por isso:

- **Não ligue o agendador 24 h por dia sem decidir isto antes.** Opções:
  - **A) Só nas horas de kite**, por exemplo 06:00 às 18:59 (horário de
    Brasília, 13 h/dia ≈ 98 CU-h/mês — quase todo o limite, **sem folga** para
    o uso real do app). Se escolher esta, confira o consumo no console do Neon
    (Billing / Usage) na primeira semana.
  - **B) Só a carona no polling** (camada 1): não custa nada extra, porque o
    banco já está acordado quando há alguém usando o app. Não cobre a madrugada.
  - **C) Plano pago do Neon**, se a escalada 24 h for requisito.
- Esta é uma decisão **sua**. O agente que escreveu este passo a passo não tem
  acesso ao console do Neon e **não mediu** o consumo real; os números acima
  são da documentação do Neon, não de medição no seu projeto.

## Passo a passo no cron-job.org (grátis)

> Os nomes dos campos abaixo são os que o cron-job.org usa hoje; se a tela
> tiver mudado, o que importa são estes itens: **URL**, **método GET**,
> **intervalo**, **cabeçalho `Authorization`** e **alerta de falha**.

**Antes de começar:** você precisa do valor do `CRON_SECRET` (Vercel → projeto
`kiteninja` → Settings → Environment Variables). **Só você vê e cola esse valor.**
Ninguém — nem o agente que ajuda você — deve pedir, ler ou escrever o valor em
chat, commit, documento ou URL.

1. Crie a conta em https://cron-job.org (grátis, sem cartão) e confirme o e-mail.
2. **Create cronjob** → aba **Common**:
   - **Title:** `KiteNinja — escalada de SOS`
   - **URL:** `https://kiteninja.vercel.app/api/cron/sos-escalada`
   - **Execution schedule:** *Every 1 minute* (ou *User-defined* com todos os
     minutos). Se escolheu a opção A do aviso acima, restrinja as **horas**
     (06 a 18) e deixe os minutos todos marcados. Confira o **fuso horário** da
     conta (Settings → Timezone) para as horas valerem em Brasília.
3. Aba **Advanced**:
   - **Request method:** `GET`
   - **Headers** → *Add header*:
     - **Key:** `Authorization`
     - **Value:** `Bearer ` (a palavra Bearer, **um espaço**) seguida do valor do
       `CRON_SECRET`. Cole o valor só neste campo.
   - **Timeout:** 30 s.
4. Aba **Notifications:** ligue o aviso por e-mail quando a execução **falhar**
   (e quando voltar ao normal), para saber sem abrir o painel.
5. **Create.**
6. Repita para o segundo job (mesmo cabeçalho, mesmo intervalo e janela):
   - **Title:** `KiteNinja — silêncio de downwind`
   - **URL:** `https://kiteninja.vercel.app/api/cron/downwind-silencio`

**Como conferir que ficou certo:**

- No histórico do cron-job.org cada execução mostra o status HTTP: tem que ser
  **200**. **401** = cabeçalho errado (confira `Bearer` + espaço + valor).
  **503** = o `CRON_SECRET` não chegou àquele deploy da Vercel (faça redeploy).
- No painel `/admin`, clique em atualizar no indicador "Última varredura do
  SOS": deve mostrar "há menos de 1 min" / "há 1 min" e "pelo agendador
  externo". Se ficar vermelho (acima de 10 min), o agendador parou **e** ninguém
  tem o app aberto.

> ⚠️ O `CRON_SECRET` dá acesso às rotas de varredura, que disparam push. Cole-o
> só no campo de cabeçalho, nunca na URL — URL vai para log de servidor e para
> o histórico do painel. Se suspeitar que vazou, troque o valor na Vercel **e**
> no cron-job.org (e nos Secrets do GitHub, enquanto o workflow existir).

### Alternativas

- **Upstash QStash** — mesma ideia, camada gratuita generosa, com retry
  automático em falha. O custo no Neon é o mesmo (o banco acorda igual).
- **Vercel Pro** — libera cron `* * * * *` nativo, e aí `vercel.json` resolve
  sozinho, sem serviço externo. É a opção mais limpa, e é paga.

## O que fazer com o workflow do GitHub

**Deixar ligado.** Ele não atrapalha e serve de rede de última instância se o
scheduler externo cair. As vias chamam a mesma função idempotente (o `UPDATE` é
condicionado ao raio lido), então rodar várias ao mesmo tempo **não escala em
dobro** — isso está provado em `scripts/verify-sos.ts`, seção 3, e a janela de
60 s entre varreduras do polling está provada em `lib/sosVarreduraFluxo.test.ts`.

## Para o próximo agente

Este achado tem a mesma forma dos outros desta base: **nada estava quebrado**.
O workflow estava correto, o segredo configurado, as rotas respondendo 200, e
todas as execuções verdes. O defeito estava na diferença entre o que o
agendamento **promete** (`*/5`) e o que ele **entrega** (4,3 h) — e essa
pergunta nenhum teste, lint ou build faz.

A lição é a mesma: **medir no ambiente real.** "O job passou" não responde
"o job passou com que frequência".
