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

## 5. O SOS sem GPS — o segundo silêncio (corrigido em 2026-08-23)

Defeito da mesma família do item 4: falha sem erro, sem log, com o app dizendo
que deu certo.

A escolha de quem notificar era feita **só por raio geográfico**. Isso exige a
coordenada do pedinte, obtida por `getCurrentPosition` com timeout de 3s. Quando
ela não vinha — celular molhado, permissão negada, GPS lento embaixo d'água — o
SOS era gravado no banco e a lista de candidatos vinha **vazia**. Ninguém era
avisado. A tela mostrava "pedido enviado" e o velejador esperava um socorro que
nunca foi acionado.

Hoje `lib/sosCandidates.ts` une **duas fontes independentes**:

| Fonte | Depende de GPS do pedinte? | Filtra por distância? |
|---|---|---|
| Proximidade (posição fresca ou spot declarado) | sim | sim, pelo raio atual |
| Companheiros de downwind `em_andamento` | **não** | **não** |

A segunda existe justamente para sobreviver à ausência de coordenada. E ela não
filtra distância de propósito: num downwind o grupo se espalha por dezenas de km
ao longo da costa, então exigir proximidade excluiria exatamente quem combinou
de navegar junto e sabe que você está na água.

Quem é avisado pelo downwind:

- `estado` em `confirmado` ou `navegando` — está na água;
- `papel = 'apoio_terra'` **sempre**, mesmo com estado `encerrado`: ele nunca
  navega, e em resgate real quem está em terra costuma ser quem consegue acionar
  a autoridade (tem carro, telefone e sabe onde o grupo entrou na água).

Quem **não** é avisado: quem `desistiu`, e todo participante de downwind
`aberto` (plano futuro, ninguém na água). Ruído em canal de emergência treina as
pessoas a ignorar o alerta.

O socorrista recebe **por que** foi chamado (`motivo` em `sos_responders`:
`proximidade`, `downwind`, `downwind_apoio`), porque isso muda a decisão dele.
Quando não há como medir a distância, ela vem `null` e a UI diz "do SEU
downwind" em vez de inventar um número — número errado em resgate é pior que
número nenhum.

## 6. As autoridades nunca ficam atrás do nosso fluxo

`lib/emergencia.ts` é a fonte única dos números (193 Bombeiros, 185 Marinha, 192
SAMU, 190 Polícia) e da mensagem de WhatsApp para o contato de emergência.
Antes, 193/185 estavam copiados em cinco arquivos e apareciam **somente quando o
POST do SOS falhava**.

Dois problemas nisso: um número errado numa das cópias só apareceria numa
emergência real; e o app escondia a autoridade — que tem barco e mandato — atrás
de um fluxo nosso que pode falhar. Hoje os botões vivem no menu (Segurança &
Emergência), sempre acessíveis. `tel:` funciona sem internet, basta sinal de voz.

Quando o POST falha, o texto diz explicitamente que **a comunidade não foi
avisada** (`TEXTO_FALHA_REDE`). Meia verdade aqui custa vida.

## 7. Como verificar

```bash
npx tsx scripts/verify-sos.ts   # 53 checagens adversariais (escalada, sem-GPS, contrato)
npx tsx scripts/verify-sql.ts   # 220 checagens de schema e isolamento
npx vitest run                  # 663 testes
```

Em produção, depois de configurar `CRON_SECRET`:

```bash
# deve responder 401 sem o header (prova que está fechado)
curl -i https://kiteninja.vercel.app/api/cron/sos-escalada
```

Não cole o valor do segredo em chat, log ou issue.

## 8. O que ainda não foi provado em produção

Honestidade sobre os limites da verificação feita:

- o fluxo SOS ponta a ponta **com dois aparelhos reais** não foi testado;
- entrega de push em iPhone (PWA instalado) não foi confirmada;
- a varredura por cron nunca rodou, porque `CRON_SECRET` não existe ainda.

Os três dependem de acesso ao aparelho e ao painel da Vercel.
