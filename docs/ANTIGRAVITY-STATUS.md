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
| ANT-001 | P0 | SOS sem GPS fora de downwind não notifica ninguém | ❌ **Aberto — próxima prioridade** |
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

1. **ANT-001** — é o único P0 e é risco de vida. Um SOS que diz "enviado" sem
   ter avisado ninguém é pior que não ter botão de SOS, porque o velejador
   para de procurar outra saída.
2. **ANT-002** — mesmo subsistema, correção baixa, e o cenário (velejador
   derivando tenta atualizar a posição) é justamente o que sucede o ANT-001.
3. **ANT-006** e **ANT-012** — baratos, fecham inconsistências de auth/validação.
4. **ANT-007** — cron externo; depende de decidir onde hospedar o gatilho.
5. **ANT-004** + **ANT-011** — pacote "experiência Play Store".
6. Restante conforme o roadmap.
