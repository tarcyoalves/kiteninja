# Operação do SOS — o que precisa estar ligado para o socorro funcionar

Este documento existe porque o SOS é o único recurso do KiteNinja em que uma
falha silenciosa tem custo humano. Tudo aqui é sobre **configuração de
ambiente**, não código: o código está pronto e testado, mas depende de três
coisas estarem ligadas em produção.

## Estado atual (2026-08-23)

| Item | Estado | Bloqueia o quê |
|---|---|---|
| Tabelas do SOS no Neon | OK (migradas) | tudo |
| Escalada de raio (motor único) | OK, código pronto | ampliar busca |
| `CRON_SECRET` na Vercel | **FALTA** | varredura periódica |
| Chaves VAPID (push) | **NÃO VERIFICADO** | aviso ao socorrista |

## 1. `CRON_SECRET` — obrigatório para a varredura

A rota `/api/cron/sos-escalada` **recusa toda chamada** enquanto essa variável
não existir (responde 503). Isso é deliberado: um endpoint que dispara push em
massa não pode ficar aberto porque alguém esqueceu de configurar a variável no
deploy. Falhar fechado é a escolha certa aqui.

```bash
# gere um segredo forte e configure na Vercel (produção)
npx vercel env add CRON_SECRET production
```

A Vercel envia `Authorization: Bearer $CRON_SECRET` automaticamente para os
Cron Jobs quando a variável existe no projeto.

### O limite que você precisa conhecer

`vercel.json` agenda a varredura em `0 3 * * *` — **uma vez por dia**. Não é um
descuido: no **plano Hobby a Vercel só permite cron diário**. Para uma
emergência que se mede em minutos, uma varredura por dia é praticamente
inútil.

Ou seja: hoje a escalada confiável **ainda depende** do caminho preguiçoso em
`GET /api/sos/active` (alguém com o app aberto). O cron cobre o caso residual.

Para escalada de verdade em minutos, uma das opções:

- **plano Pro** na Vercel → mude o schedule para `* * * * *` (a cada minuto);
- **acionador externo** (cron-job.org, GitHub Actions com `schedule`, Upstash
  QStash) batendo em `/api/cron/sos-escalada` com o header `Authorization`.

Qualquer das duas é segura: o motor é idempotente (ver abaixo), então cron e
poll rodando juntos escalam uma única vez.

## 2. Chaves VAPID — o push do socorro

Sem elas, `sendPushToUsers` não entrega nada e o socorrista **não é avisado**;
o SOS aparece somente para quem já estiver com o app aberto. O alerta não se
perde do banco, mas o aviso ativo — que é o ponto do sistema — não sai.

```bash
npx web-push generate-vapid-keys
# configure as três na Vercel:
npx vercel env add VAPID_PUBLIC_KEY production
npx vercel env add VAPID_PRIVATE_KEY production
npx vercel env add VAPID_SUBJECT production   # ex: mailto:voce@dominio.com
```

`VAPID_PUBLIC_KEY` também precisa estar disponível ao cliente para o registro
da inscrição — confira `lib/push.ts` antes de renomear qualquer uma.

## 3. Por que a escalada é idempotente (e por que isso importa)

O `UPDATE` da escalada é condicionado ao raio que foi lido:

```sql
UPDATE sos_alerts SET radius_km = $novo, escalated_at = NOW()
WHERE id = $id AND radius_km = $raioLido AND status IN ('ativo','em_atendimento')
```

Se duas execuções concorrerem (cron e poll no mesmo segundo), a segunda não
encontra a linha e devolve zero linhas — sem raio dobrado, sem push duplicado.
Provado em `scripts/verify-sos.ts`, seção "Escalada — o SOS que ninguém vê".

## 4. O defeito que motivou tudo isso

A escalada morava dentro de `GET /api/sos/active`, cuja consulta filtra:

```sql
WHERE sa.user_id = $eu OR sr.user_id = $eu
```

Só escalava SOS que **o usuário com o app aberto já enxergava**. Um pedido de
socorro cujos vizinhos notificados estavam todos com o app fechado — exatamente
a situação em que ampliar o raio é vital — não era varrido por ninguém e ficava
**parado em 5 km para sempre**, sem erro e sem log.

Pior: quem mais precisa da escalada é o próprio acidentado, cujo celular está
no bolso, molhado ou na areia. O desenho antigo exigia que ele mantivesse o app
aberto para que o socorro se ampliasse.

Hoje o motor é `lib/sosEscalada.ts`, com duas portas de entrada:

- `varrerEscaladas()` — varredura **global**, sem filtro por usuário (cron);
- `escalarUmSos()` — um alerta específico (poll de `/api/sos/active`).

## 5. Como verificar

```bash
npx tsx scripts/verify-sos.ts   # 36 checagens adversariais, inclui a escalada
npx vitest run                  # 648 testes
```

Em produção, depois de configurar `CRON_SECRET`:

```bash
# deve responder 401 sem o header (prova que está fechado)
curl -i https://kiteninja.vercel.app/api/cron/sos-escalada
```

Não cole o valor do segredo em chat, log ou issue.

## 6. O que ainda não foi provado em produção

Honestidade sobre os limites da verificação feita:

- o fluxo SOS ponta a ponta **com dois aparelhos reais** não foi testado;
- entrega de push em iPhone (PWA instalado) não foi confirmada;
- a varredura por cron nunca rodou, porque `CRON_SECRET` não existe ainda.

Os três dependem de acesso ao aparelho e ao painel da Vercel.
