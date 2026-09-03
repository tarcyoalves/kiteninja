# Configuração de segredos — passo a passo

Onde pegar cada valor, onde colar, e como confirmar que funcionou.

Escrito em 25/08/2026. A referência canônica do que cada variável faz continua
sendo o `.env.example` (comentado linha a linha) — este documento é o roteiro
operacional de onde clicar.

## Estado conferido em 25/08/2026

> **Situação conferida em 03/09/2026**, na captura do painel
> (Vercel → kiteninja → Environment Variables) enviada pelo dono, com os nomes
> completos visíveis. A API da Vercel NÃO expõe variáveis de ambiente para
> agentes — `get_project` devolve nome do projeto, domínios e deploys, nada de
> `env`. Então esta tabela só se atualiza com uma captura ou com o dono
> confirmando; um agente não consegue verificá-la sozinho, e não deve afirmar
> que uma variável falta sem essa prova.

| Segredo | Onde | Situação |
|---|---|---|
| `DATABASE_URL` | Vercel | ✅ Production + Preview |
| `CRON_SECRET` | Vercel | ✅ Production (adicionado 25/ago) |
| `CRON_SECRET` | GitHub Actions | ✅ o workflow de varredura roda verde desde 31/ago |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Vercel | ✅ Production + Preview |
| `VAPID_PRIVATE_KEY` | Vercel | ✅ Production + Preview |
| `VAPID_SUBJECT` | Vercel | ✅ Production + Preview |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Vercel | ✅ Production |
| `BLOB_READ_WRITE_TOKEN` | Vercel | ✅ All Environments (upload de fotos e vídeos) |
| `APP_URL` | Vercel | ✅ Production |
| `google-services.json` | Android local | ❓ só o dono tem |
| `keystore.properties` + keystore | Android local | ❓ só o dono tem |

**Nenhuma variável falta hoje.** A linha do `CRON_SECRET` dizia
"AUSENTE — confirmado por sondagem" até esta revisão: era verdade quando foi
escrita, e deixou de ser em 25/ago. Um agente lendo a versão antiga iria caçar
um problema que não existe mais — por isso a tabela agora diz de onde veio a
informação e quando.

Como o `CRON_SECRET` ausente foi confirmado (qualquer um pode repetir):

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://kiteninja.vercel.app/api/cron/sos-escalada
```

- `503` → a variável **não existe** no ambiente. A rota recusa tudo de
  propósito (falha fechada: endpoint que dispara push em massa não pode ficar
  aberto porque alguém esqueceu a variável).
- `401` → a variável existe e a rota está pedindo o Bearer correto. **Este é
  o resultado desejado.**

Hoje as duas rotas (`sos-escalada` e `downwind-silencio`) devolvem 503. Na
prática isso significa que **a escalada de raio do SOS e o alerta de silêncio
do downwind não estão rodando** — nem pelo GitHub Actions, nem manualmente.

---

## ⚠️ A pegadinha que faz todo mundo perder tempo

**Mudar variável de ambiente na Vercel NÃO afeta o deploy que já está no ar.**
As variáveis são lidas no momento do build/execução daquele deploy. Depois de
adicionar ou alterar qualquer uma:

Vercel → projeto `kiteninja` → **Deployments** → no deploy mais recente, menu
`⋯` → **Redeploy**.

Sem isso, você vai configurar tudo certo e continuar vendo o comportamento
antigo.

---

## 1. `CRON_SECRET` — comece por aqui

É o mais urgente: sem ele, a emergência não escala.

**Gerar o valor** (qualquer máquina com Node):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Guarde esse valor — ele vai em **dois lugares**, e precisa ser **idêntico**
nos dois.

**1a. Na Vercel**

Vercel → projeto `kiteninja` → Settings → **Environment Variables** → Add:

- Key: `CRON_SECRET`
- Value: o valor gerado
- Environments: marque **Production**, **Preview** e **Development**

**1b. No GitHub Actions**

O `.github/workflows/cron-varredura.yml` roda a cada 5 minutos e chama as duas
rotas com esse Bearer. Ele lê de **secret**, não de variable:

GitHub → repositório → Settings → Secrets and variables → **Actions** → aba
**Secrets** → New repository secret:

- Name: `CRON_SECRET`
- Secret: **o mesmo valor** da Vercel

Opcionalmente, na aba **Variables** (não Secrets), crie `APP_BASE_URL` se um
dia o domínio mudar. Sem ela o workflow usa `https://kiteninja.vercel.app`,
que hoje está correto — pode pular.

**1c. Confirmar**

Depois do redeploy da Vercel:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://kiteninja.vercel.app/api/cron/sos-escalada
# esperado: 401
```

E o caminho completo, com o segredo:

```bash
curl -i -H "Authorization: Bearer SEU_VALOR_AQUI" \
  https://kiteninja.vercel.app/api/cron/sos-escalada
# esperado: 200
```

Depois, no GitHub → aba **Actions** → workflow "Varredura periódica" →
**Run workflow** (disparo manual) e confira que passa verde. Não espere os 5
minutos para descobrir que o segredo está errado.

> Nota sobre precisão: o `schedule` do GitHub Actions não é garantido no
> minuto exato — pode atrasar sob carga da plataforma. Para SOS isso significa
> que a detecção real pode passar do limiar. É o preço do plano gratuito;
> está documentado no cabeçalho do próprio workflow.

---

## 2. Web Push (VAPID) — 3 variáveis

Sem elas, `sendPushToUser` devolve 0 e **nenhum push de SOS sai do servidor**.
Falha silenciosa: nada quebra na tela, ninguém é avisado.

**Gerar o par (uma única vez na vida do projeto):**

```bash
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

Saem duas strings, `publicKey` e `privateKey`.

> **Não regenere se já existirem.** Trocar o par invalida todas as inscrições
> de push já salvas em `push_subscriptions`, e cada usuário precisaria
> reinstalar/reautorizar para voltar a receber. Se não souber se já existem,
> confira primeiro na Vercel em vez de gerar por cima.

Na Vercel → Settings → Environment Variables, adicione as três:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | a `publicKey` |
| `VAPID_PRIVATE_KEY` | a `privateKey` |
| `VAPID_SUBJECT` | `mailto:tarcyo.alves@gmail.com` |

O prefixo `NEXT_PUBLIC_` na pública é intencional — o navegador precisa dela
para se inscrever. A privada **jamais** leva esse prefixo: ela assina os
envios, e `NEXT_PUBLIC_` embute o valor no bundle que qualquer visitante lê.

---

## 3. `GOOGLE_APPLICATION_CREDENTIALS_JSON` — push nativo (FCM)

É o que faz notificação chegar no app Android instalado. Sem isso o FCM fica
desabilitado em silêncio (o Web Push continua funcionando normalmente).

**Onde pegar:**

Firebase Console → seu projeto → ⚙️ **Configurações do projeto** → aba
**Contas de serviço** → **Gerar nova chave privada** → confirma. Baixa um
`.json`.

**Como colar na Vercel:** abra o arquivo, copie o **conteúdo inteiro** e cole
como valor de `GOOGLE_APPLICATION_CREDENTIALS_JSON`. A Vercel aceita o JSON
multi-linha no campo; o código faz `JSON.parse` do conteúdo.

- Esse arquivo é uma **credencial de servidor**: dá acesso de administrador ao
  projeto Firebase. Nunca commitar, nunca mandar por chat, nunca colocar no
  app Android.
- A variável `GOOGLE_APPLICATION_CREDENTIALS` (sem `_JSON`) é a alternativa
  por *caminho de arquivo*, útil só localmente. Na Vercel use a `_JSON`, que
  tem prioridade se as duas existirem.

---

## 4. `BLOB_READ_WRITE_TOKEN` — upload de fotos

Vercel → projeto → aba **Storage** → crie/conecte um **Blob** store. Ao
conectar ao projeto, a Vercel injeta `BLOB_READ_WRITE_TOKEN` sozinha. Confira
em Environment Variables se apareceu.

## 5. `DATABASE_URL` — já está, mas confira o `-pooler`

Neon → projeto → **Connection Details** → escolha **Pooled connection**. O
host precisa conter `-pooler`. Sem o pooler, cada invocação serverless abre
conexão nova e o Neon estoura o limite de conexões.

## 6. `APP_URL`

`https://kiteninja.vercel.app` em produção. Usada para montar links de
convite. Local pode ficar vazia (o app usa a origem da requisição).

---

## 7. Arquivos locais do Android (não vão para o repositório)

Estes ficam só na sua máquina. O `.gitignore` já os cobre — confirmado.

**`android/app/google-services.json`**

Firebase Console → ⚙️ Configurações do projeto → aba **Geral** → role até
"Seus apps" → selecione o app Android (`br.com.kiteninja.app`) → **Baixar
google-services.json**. Salve exatamente em `android/app/google-services.json`.

Se o app Android ainda não existir lá: **Adicionar app** → Android → nome do
pacote `br.com.kiteninja.app` → registrar → baixar.

**`android/keystore.properties`** — aponta para a chave de assinatura:

```properties
storeFile=/caminho/absoluto/para/kiteninja.keystore
storePassword=SUA_SENHA
keyAlias=SEU_ALIAS
keyPassword=SUA_SENHA_DA_CHAVE
```

**O keystore em si.** Se já existe, guarde em pelo menos dois lugares (backup
externo + gerenciador de senhas).

> **Perder o keystore impede atualizar o app na Play Store para sempre.** Não
> há recuperação: a Play identifica o app pela assinatura. A única saída seria
> publicar como aplicativo novo, perdendo instalações, avaliações e URL. Se
> você ativar o **Play App Signing** ao criar o app no Console (recomendado), o
> Google guarda a chave de assinatura final e esse risco cai muito — mas a
> chave de *upload* ainda é sua e ainda precisa de backup.

---

## Ordem recomendada

1. **`CRON_SECRET`** nos dois lugares + redeploy. É o único confirmado ausente
   e o que tem consequência de segurança: hoje a escalada de SOS não roda.
2. **Confirmar o VAPID** antes de gerar qualquer coisa (regenerar quebra as
   inscrições existentes).
3. **FCM** (`GOOGLE_APPLICATION_CREDENTIALS_JSON`) + `google-services.json`
   local — só isso já destrava testar notificação no app nativo.
4. **Blob** e **`APP_URL`**, se ainda não estiverem.
5. **Redeploy** ao final, e repetir a sondagem do `curl` acima.

## Depois de configurar

Vale rodar o teste real do rastreamento descrito em
`docs/RASTREIO-BACKGROUND-ANDROID-LIMITACOES.md` e a checagem de notificações
com dois usuários e dois aparelhos. Nenhum dos dois pode ser feito por um
agente — exigem aparelho físico.
