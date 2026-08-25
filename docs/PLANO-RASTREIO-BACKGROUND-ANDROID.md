# Plano — rastreio de downwind com o app fechado (Android)

Status: **plano, nada implementado.** Escrito em 25/08/2026 depois do dono
testar o app real instalado no Android e relatar: *"no dw não está monitorando
com o app fechado"*.

## O que já foi corrigido e por que NÃO resolve esse teste

O commit `2f586ad` corrigiu dois bugs reais do lado web:

- o beacon parava de enviar posição quando a tela apagava (`document.hidden`);
- o Wake Lock só existia dentro do Modo Navegação, não na travessia inteira.

Isso conserta o cenário **"celular no colete, tela apagada, app ainda
aberto"** — que é o uso mais comum numa travessia. **Não conserta o cenário
testado pelo dono**, que foi com o app fechado. Os dois cenários parecem o
mesmo de fora (o velejador some do mapa), mas têm causas diferentes, e é
importante não confundir: se o teste for repetido com o app fechado, vai
falhar de novo, e a correção anterior não tem culpa nisso.

## Por que com o app fechado nada funciona hoje

Não é bug, é o modelo de execução. Quando o app sai dos recentes, o processo
morre: não existe JavaScript, `setInterval`, Service Worker periódico nem
Wake Lock. Vale para PWA, para TWA e para WebView — nenhum deles mantém
processo vivo depois que o usuário fecha o app.

A única forma de coletar GPS com o app fechado no Android é um **Foreground
Service** nativo: um serviço com notificação persistente, rodando fora da
WebView, que o sistema se compromete a manter vivo.

Ou seja: **este é o único item desta lista que não pode ser resolvido dentro
deste repositório.** Exige código no projeto Android. O que PODE e PRECISA ser
feito aqui é o lado servidor que esse serviço vai consumir — detalhado abaixo,
e é bastante coisa.

---

## Decisão de arquitetura que evita rejeição na Play Store

Esta parte importa mais do que parece, porque é onde apps de rastreamento
costumam ser barrados na revisão.

Pedir a permissão `ACCESS_BACKGROUND_LOCATION` dispara, desde o Android 11, um
processo de revisão especial do Google: formulário de declaração, vídeo
demonstrando o uso e justificativa. É lento e é motivo comum de rejeição.

**Dá para não precisar dela.** A regra: um Foreground Service com
`foregroundServiceType="location"` **iniciado enquanto o app está em primeiro
plano** continua recebendo localização depois que o app é fechado, usando só
`ACCESS_FINE_LOCATION`.

E isso encaixa perfeitamente no fluxo real do downwind: o velejador **sempre**
abre o app para entrar na travessia. É nesse toque que o serviço sobe. Depois
ele pode fechar o app à vontade.

Permissões necessárias (nenhuma exige revisão especial):

```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

```xml
<service
    android:name=".RastreioDownwindService"
    android:foregroundServiceType="location"
    android:exported="false" />
```

`FOREGROUND_SERVICE_LOCATION` é obrigatória a partir do Android 14 — sem ela o
serviço lança exceção ao subir.

---

## O problema que não é óbvio: autenticação

`POST /api/downwind/{id}/posicoes` autentica por **cookie de sessão**
(`kiteninja_session`, `httpOnly`, ver `lib/auth.ts:11`). Um serviço nativo
fazendo requisição com OkHttp **não tem esse cookie**.

E aqui a resposta depende de como o app Android foi construído:

- **Se for WebView/Capacitor**: `CookieManager.getInstance().getCookie(...)`
  lê os cookies da WebView, inclusive `httpOnly`. Funciona, é o caminho curto.
- **Se for TWA**: **não funciona.** TWA roda dentro do Chrome, não numa WebView
  do app — o cookie está no pote do Chrome, inacessível ao código nativo. Pelo
  mesmo motivo, um TWA **não aceita `@JavascriptInterface`**: não há ponte JS
  possível.

Como o app foi publicado como TWA (segundo `docs/ANTIGRAVITY-AUDIT-2026.md`,
seção 6.1), o plano assume o caso difícil.

### Solução: token de rastreio escopado, entregue por FCM

Desenha-se assim, e resolve autenticação e gatilho de uma vez:

1. Velejador entra no downwind pelo app (primeiro plano).
2. Servidor gera um **token de rastreio** curto: válido só enquanto aquele
   downwind estiver `em_andamento`, e autorizado a **uma única ação** —
   `POST` de posição naquele downwind. Não dá acesso à conta.
3. Servidor manda o token ao aparelho por **mensagem de dados FCM**.
4. O app nativo recebe, sobe o Foreground Service e passa a postar posição a
   cada 45s com `Authorization: Bearer <token>`.
5. Ao encerrar o downwind, o servidor manda outra mensagem FCM e o serviço se
   desliga sozinho (com um teto de tempo como rede de segurança, para o
   serviço nunca ficar preso caso a mensagem se perca).

O escopo estreito é o ponto: se o token vazar, o estrago possível é alguém
reportar posição falsa num downwind — não acessar a conta, ler DMs ou disparar
SOS. Vale a pena não economizar nisso.

---

## O que precisa ser feito NESTE repositório

Isso é o que eu consigo implementar aqui, e é pré-requisito do lado Android:

### 1. Tabela e emissão do token de rastreio

```sql
CREATE TABLE IF NOT EXISTS downwind_tracking_tokens (
  token_hash   TEXT PRIMARY KEY,            -- SHA-256, nunca o token cru
  downwind_id  UUID NOT NULL REFERENCES downwinds(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Guardar só o hash é o mesmo padrão já usado em `invites` e
`downwind_convites` neste projeto.

### 2. Aceitar Bearer token na rota de posições

`app/api/downwind/[id]/posicoes/route.ts` passa a aceitar, além do cookie, um
`Authorization: Bearer`. O token só vale para o `downwind_id` que está na URL
— um token de um downwind não reporta posição em outro.

### 3. Aceitar `registradoEm` no POST (sem isso a trilha mente)

Hoje o `INSERT` deixa `registrado_em` no default do banco (`NOW()`). Enquanto
tudo é tempo real, tudo bem. Com serviço nativo e sinal oscilando na praia,
deixa de ser: pontos coletados offline e enviados 20 minutos depois seriam
gravados como **agora**.

Num resgate isso é perigoso ao contrário do que parece — a trilha mostraria o
velejador num lugar onde ele esteve há 20 minutos como se fosse a posição
atual, e o apoio em terra procuraria no ponto errado.

Então o POST precisa aceitar `registradoEm` opcional, com trava:

- rejeitar timestamp no futuro;
- rejeitar mais velho que ~6h;
- **nunca** confiar cegamente: é dado vindo do cliente.

Isso também destrava o outbox offline do lado web (ANT-004 / melhoria nº 1 do
roadmap) — a mesma correção serve aos dois.

### 4. Ponte FCM em `lib/push.ts`

Já documentada como ausente em `docs/PLANO-APP-NATIVO.md`. Hoje o backend só
fala Web Push (VAPID); a tabela `push_subscriptions` guarda
`endpoint`/`p256dh`/`auth`, que é o formato do Web Push, e não tem onde
guardar um token FCM. Sem essa ponte não há como mandar a mensagem que liga o
serviço — e, de quebra, hoje **nenhuma** notificação (SOS incluído) chega ao
app nativo se ele depender de FCM.

---

## O que precisa ser feito no projeto Android

Fora deste repositório. Resumo do que o serviço faz:

- `FusedLocationProviderClient` com intervalo de 45s (mesma cadência do
  beacon web — ver `lib/useDownwindBeacon.ts`) e prioridade de alta precisão.
- Notificação persistente dizendo que a travessia está sendo rastreada, com
  ação de encerrar. Além de ser exigência do sistema, é honestidade: a pessoa
  precisa ver que está sendo localizada.
- Fila local (Room/SQLite) para os pontos que falharem por falta de sinal,
  reenviados em lote com o `registradoEm` de quando foram coletados.
- Auto-desligamento por FCM ou por teto de tempo.

### A armadilha dos fabricantes

Xiaomi, Huawei, Oppo, Vivo e Samsung matam serviços em segundo plano de forma
muito mais agressiva que o Android puro, mesmo Foreground Service. É a causa
clássica de "funciona no Pixel, não funciona no Xiaomi" — e boa parte do
público de kite no Brasil usa exatamente esses aparelhos.

Mitigações, nesta ordem:

1. Pedir isenção de otimização de bateria
   (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`) ao iniciar a primeira travessia.
2. Instruir o usuário a fixar o app em "sem restrições" de bateria (a tela
   varia por fabricante — vale um passo a passo no app).
3. Tratar como esperado que alguns aparelhos ainda assim interrompam, e usar
   isso como argumento para o servidor **detectar silêncio** (ver abaixo).

### Rede de segurança no servidor, independente do aparelho

Vale a pena, e é implementável aqui: se um participante marcado como
`navegando` parar de reportar por mais de X minutos numa travessia em
andamento, avisar o organizador e o apoio em terra. Assim, mesmo quando o
rastreio falhar por motivo que não controlamos, **alguém fica sabendo** — em
vez do ponto simplesmente congelar no mapa sem ninguém perceber, que é
exatamente o que aconteceu no teste do dono.

---

## Ordem sugerida

| Etapa | Onde | Depende de |
|---|---|---|
| 1. `registradoEm` no POST de posições | este repo | nada — **dá para começar já** |
| 2. Alerta de silêncio no downwind | este repo | nada — **dá para começar já** |
| 3. Tabela + emissão do token de rastreio | este repo | nada |
| 4. Bearer token na rota de posições | este repo | etapa 3 |
| 5. Ponte FCM em `lib/push.ts` | este repo | credenciais do Firebase |
| 6. Foreground Service | projeto Android | etapas 3-5 |
| 7. Isenção de bateria + telas de instrução | projeto Android | etapa 6 |

As etapas 1 e 2 têm valor por si só, **mesmo que o app nativo nunca saia**:
a 1 destrava o outbox offline do PWA, e a 2 faz o silêncio de um velejador
virar aviso em vez de passar despercebido.

## Perguntas que ainda travam a parte Android

Continuam as de `docs/PLANO-APP-NATIVO.md`, mas agora com consequência clara:

1. **O app é TWA ou WebView/Capacitor?** TWA obriga o caminho do token + FCM
   descrito aqui. WebView/Capacitor permite o atalho do `CookieManager` e
   encurta bastante as etapas 3 e 4.
2. **Onde vive o projeto Android?** Repositório separado (dá para adicionar à
   sessão) ou só na máquina local?
3. **O Firebase já tem FCM configurado** com `google-services.json` no app e
   credencial de servidor disponível?
