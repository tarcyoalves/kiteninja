# Auditoria Antigravity — status de correção

Rastreador vivo dos achados de `docs/ANTIGRAVITY-FINDINGS.md`. **Este é o
arquivo que se atualiza a cada correção** — os três documentos da auditoria
(`ANTIGRAVITY-AUDIT-2026.md`, `ANTIGRAVITY-FINDINGS.md`,
`ANTIGRAVITY-ROADMAP.md`) ficam intactos como registro do que foi encontrado
em 25/08/2026, para que dê para comparar depois o que mudou.

## Procedência e conferência

A auditoria foi feita pelo agente Antigravity e entregue pelo dono. Antes de
publicar aqui, **seis achados foram conferidos um a um contra o código real**
deste repositório — não é repasse cego de relatório de terceiro:

| Achado | Alegação | Conferido |
|---|---|---|
| ANT-001 | `sosCandidates.ts` devolve `[]` de proximidade quando `origin === null` | ✅ confere |
| ANT-005 | `LeafletMap.tsx` interpola `authorName`/`name` crus em `L.divIcon({ html })` | ✅ confere |
| ANT-006 | `login/route.ts` seleciona sem `AND is_active = TRUE` | ✅ confere |
| ANT-007 | `vercel.json` tem cron `0 3 * * *` (1x/dia) | ✅ confere |
| ANT-008 | `next.config.ts` vazio, sem `headers()` | ✅ confere |
| ANT-011 | `public/.well-known/` não existe | ✅ confere |

Os demais achados **não foram conferidos individualmente** e devem ser
reconfirmados antes de virar código. O relatório se mostrou preciso na
amostra, mas isso não substitui checar o achado que se vai corrigir.

## Situação por achado

| ID | Sev | Resumo | Situação |
|---|---|---|---|
| ANT-001 | P0 | SOS sem GPS fora de downwind não notifica ninguém | ✅ **Corrigido** (ver abaixo) |
| ANT-002 | P1 | Rate limit bloqueia atualizar posição de SOS ativo | ❌ Aberto |
| ANT-003 | P1 | Rastreio para ao bloquear a tela / background | 🟡 **Parcial** — tela apagada resolvido; **app fechado NÃO** (ver abaixo) |
| ANT-004 | P1 | Service Worker sem cache offline | ❌ Aberto |
| ANT-005 | P1 | DOM XSS nos marcadores Leaflet | ✅ **Corrigido** |
| ANT-006 | P1 | Login aceita conta suspensa | ❌ Aberto |
| ANT-007 | P1 | Cron de escalada 1x/dia no plano Hobby | ❌ Aberto |
| ANT-008 | P1 | Sem Security Headers / CSP | ❌ Aberto |
| ANT-009 | P2 | Fotos em base64 no Postgres | ❌ Aberto |
| ANT-010 | P2 | `/api/spots` sem cache distribuído | ❌ Aberto |
| ANT-011 | P2 | Sem `assetlinks.json` (TWA) | ❌ Aberto — **depende do dono** (ver abaixo) |
| ANT-012 | P2 | `sos/[id]` não valida UUID | ❌ Aberto |
| ANT-013 | P2 | Watcher de GPS não reata ao voltar do background | ❌ Aberto |
| ANT-014 | P2 | Falta índice `chat_messages(user_id, created_at)` | ❌ Aberto |
| ANT-015 | P3 | Eventos ordenados alfabeticamente | ❌ Aberto |
| ANT-016 | P3 | Logbook carrega 500 trilhas JSONB | ❌ Aberto |

---

## ANT-005 — corrigido

`escaparHtml()` aplicado em `createSosMarkerIcon` e `createResponderMarkerIcon`
(`components/LeafletMap.tsx`). O helper já existia e já era usado em
`DownwindMapa.tsx` — estes dois ícones tinham ficado de fora. Um nome de perfil
com `<img src=x onerror=...>` agora sai como texto no mapa de quem vê o SOS.

## ANT-003 — mitigado até o limite do que a web permite

Este é o achado que motivou a rodada, a partir do relato do dono: *"no
Android, com o app fechado, o downwind não está monitorando."*

**Feito:**

1. `lib/useDownwindBeacon.ts` — removida a guarda `document.hidden`. O beacon
   pausava exatamente no estado normal de quem está velejando (celular no
   colete, tela apagada). A guarda nunca economizou nada real: se o sistema
   congela a página, o `setInterval` não dispara de qualquer forma — ela só
   garantia que, nas janelas em que o sistema DEIXAVA a página rodar, o app
   se recusasse a usá-las.
2. `context/DownwindContext.tsx` — Wake Lock durante toda a travessia. Ele já
   existia, mas só dentro do Modo Navegação (`components/ModoNavegacao.tsx`):
   quem entrava no downwind e ficava em outra aba, ou só guardava o celular,
   ficava sem proteção justo por não estar olhando a tela. Agora o lock vive
   no provider e é solto sozinho quando o downwind sai de `em_andamento`.
3. `views/DownwindAoVivoView.tsx` — faixa de status honesta durante a
   travessia, dizendo se a tela está travada ligada e avisando que fechar o
   app interrompe o envio.

**O que isso NÃO resolve, e não tem como resolver daqui:** com o app
**fechado** (removido dos recentes) não existe JavaScript rodando. Não é
limitação do KiteNinja, é do modelo de execução: nem PWA, nem TWA, nem
WebView têm processo vivo depois que o app é encerrado. Rastreio real com app
fechado exige **Foreground Service nativo no Android** — um serviço com
notificação persistente, coletando GPS fora da WebView.

**ATENÇÃO — o que foi corrigido não cobre o teste do dono.** Ele testou no app
Android real com o **app fechado**, e para esse caso nada acima muda o
resultado. São dois cenários que parecem iguais de fora (o velejador some do
mapa) e têm causas diferentes:

| Cenário | Situação |
|---|---|
| Tela apagada, app aberto (celular no colete) | ✅ Corrigido |
| App em segundo plano (trocou de app) | ✅ Melhorado (o sistema ainda pode congelar a página) |
| **App fechado (fora dos recentes)** | ❌ **Não resolvido — exige código nativo** |

O plano concreto para o terceiro caso está em
**`docs/PLANO-RASTREIO-BACKGROUND-ANDROID.md`**: arquitetura do Foreground
Service, como evitar a revisão especial de background location da Play Store,
o problema de autenticação do serviço nativo (TWA não compartilha cookie nem
aceita ponte JS) e as **4 etapas que dá para começar neste repositório desde
já**.

## ANT-011 — bloqueado por dado que só o dono tem

O `assetlinks.json` precisa de dois valores que não existem neste
repositório: o `package_name` do app Android e o **fingerprint SHA-256 do
certificado de assinatura** da Play Store. Assim que o dono passar os dois, o
arquivo entra em `public/.well-known/assetlinks.json` (Next.js serve
`public/` na raiz do domínio) e a barra do Chrome some do app instalado.

---

## Ordem sugerida de ataque

Difere do roadmap original em um ponto: ANT-005 já saiu (era 2 linhas e uma
vulnerabilidade confirmada, não fazia sentido esperar uma fase).

1. ~~**ANT-001**~~ — **feito.** Detalhe da correção logo abaixo.
2. **ANT-002** — mesmo subsistema, correção baixa, e o cenário (velejador
   derivando tenta atualizar a posição) é justamente o que sucede o ANT-001.
3. **ANT-006** e **ANT-012** — baratos, fecham inconsistências de auth/validação.
4. **ANT-007** — cron externo; depende de decidir onde hospedar o gatilho.
5. **ANT-004** + **ANT-011** — pacote "experiência Play Store".
6. Restante conforme o roadmap.


---

## ANT-001 — como foi fechado

**O cenário exato:** velejador sozinho, GPS falhou (celular molhado, permissão
negada, 3 s de timeout), não está em downwind nenhum, não declarou spot no
chat, e nenhum moderador abriu o app nos últimos 15 minutos.

**O que acontecia:** o SOS era gravado, a tela dizia "SOS Enviado", e **zero
pessoas eram notificadas**. Pior: a escalada de 5 → 15 → 50 km continuava
rodando, ampliando o raio no banco a cada dois minutos, sempre chamando
ninguém. Falha silenciosa, no caminho de vida — e a tela do velejador nunca
dava um sinal de que ele estava sozinho.

**Duas rodadas de correção.** A primeira (já registrada na seção 6 de
`scripts/verify-sos.ts`) adicionou a fonte de downwind, que não depende de
coordenada. Isso resolveu o SOS de quem está numa remada. Não resolveu o de
quem está sozinho — que é justamente quem mais precisa.

### O que fechou o resto

O seletor agora tem três degraus, e só desce para o próximo quando o anterior
devolve lista vazia:

| Degrau | Camadas | Depende de |
|---|---|---|
| 1 — normal | proximidade, downwind, apoio em terra | GPS **ou** estar numa remada |
| 2 — fallback | moderadores **com** presença recente, quem declarou o mesmo spot | alguém com o app aberto |
| 3 — último recurso | moderadores **sem** filtro de presença, quem tem o mesmo estado no `home_spot` | **nada** |

As duas camadas do degrau 3 são a correção, e as duas derrubam um filtro que
estava errado para esse uso:

- **Moderador sem exigir presença.** O filtro `last_seen_at >= cutoff` faz
  sentido para responder "quem está perto e pode ajudar agora". Não faz nenhum
  para o último recurso: o push chega no celular com o app fechado — é
  exatamente para isso que push existe. Numa base pequena, "nenhum moderador
  com o app aberto neste instante" é o caso **comum**, e era esse filtro que
  transformava o último recurso em lista vazia.
- **Mesmo estado, via `home_spot`.** Esta camada já existia no código e era
  **inalcançável**: quem chamava sempre passava `estado: null`, então o
  `else if (estado)` nunca rodava. Agora o estado é derivado do spot do próprio
  SOS quando há um, ou do `home_spot` do perfil quando não há — a única pista
  que sobra de onde a pessoa costuma velejar.

### Dois defeitos vizinhos que apareceram no caminho

- **A escalada nunca passava o spot.** `lib/sosEscalada.ts` chamava
  `selectSosCandidates` sem `spotId`. Ou seja: mesmo depois da primeira
  correção, as camadas de fallback por spot ficavam mortas em toda escalada.
  O `spot_id` agora é lido na varredura e repassado (e o mesmo em
  `/api/sos/active`, o outro gatilho).
- **Contas desativadas entravam.** Nenhuma das camadas de fallback checava
  `is_active`. Alerta de socorro para conta suspensa é alerta jogado fora,
  e nas camadas amplas isso podia ser a maioria da lista.

### Teto

As camadas amplas (mesmo spot, mesmo estado) não têm filtro geográfico: num
estado com o app popular seriam centenas de pushes de uma vez, dentro do
caminho crítico do socorro, com tempo de função serverless finito. Ambas têm
`LIMIT 200` (`MAX_CANDIDATOS_AMPLOS`).

### Como está verificado

- `lib/sosCandidates.test.ts` — a decisão pura de mesclagem das camadas
  (prioridade, dedupe, memória da escalada). É a parte que, errada, manda o
  push com o motivo errado: "alguém a 2 km" em vez de "é do seu downwind".
- `scripts/verify-sos.ts`, **seção 6b** — contra Postgres de verdade, com o
  cenário montado peça por peça. Inclui a prova de que o filtro de presença era
  o culpado: a consulta antiga devolve zero no mesmo banco onde a nova devolve
  o moderador.

### O que isto NÃO resolve

Nada disto entrega push se os segredos de push não estiverem configurados em
produção — VAPID e `GOOGLE_APPLICATION_CREDENTIALS_JSON`. **Sem eles o
servidor grava os socorristas em `sos_responders` e não sai push nenhum, em
silêncio.** Ver `docs/CONFIGURACAO-SEGREDOS.md`. É a pendência que mais
importa hoje, e ela é do dono — não há como um agente configurá-la.
