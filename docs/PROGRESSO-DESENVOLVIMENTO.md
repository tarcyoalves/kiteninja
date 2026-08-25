# Progresso de Desenvolvimento — KiteNinja

> Documento vivo. Atualize conforme o projeto evolui.

## Visão Geral

| Item | Status |
|------|--------|
| PWA (Next.js) | ✅ Produzindo |
| Android (Capacitor) | ✅ Toolchain instalada e validada; builds debug/release passaram |
| iOS | ⏳ Não iniciado |
| CI/CD GitHub Actions | 🔄 Implementando |
| Rastreio em background (Android) | ⚠️ Backend + estrutura Android implementados; build bloqueado por dependência não baixada (ver seção própria) |

## Arquivos Principais

### Root
- `package.json` — dependências, scripts, versão (0.1.0)
- `package-lock.json` — lockfile npm v3
- `tsconfig.json` — TypeScript config
- `next.config.ts` — Next.js config
- `eslint.config.mjs` — ESLint config
- `.gitignore` — ignores atualizados para Android/mobile

### Android
- `android/` — projeto Android gerado por Capacitor
- `android/app/build.gradle` — versão: 1.0, versionCode: 1
- `android/gradle/wrapper/gradle-wrapper.properties` — Gradle 8.14.3
- `capacitor.config.ts` — config do Capacitor

### Mobile
- `mobile-shell/` — shell estático (placeholder para URL remota)
- `capacitor.config.ts` — URL remota: https://kiteninja.vercel.app

### Scripts
- `scripts/bump-version.ts` — versionamento unificado PWA + Android
- `scripts/migrate-on-build.ts` — migração automática no build
- `scripts/verify-sql.ts` — validação SQL com PGlite
- `scripts/verify-db.ts` — testes de integração Neon (requer DATABASE_URL)
- `scripts/verify-sos.ts` — testes SOS adversariais

### Tracking (documentação própria, fora do escopo de edição desta tarefa)
- `docs/RASTREIO-BACKGROUND-ANDROID-LIMITACOES.md` — status detalhado do rastreio em background nativo (bloqueado por dependência)
- `docs/PLANO-RASTREIO-BACKGROUND-ANDROID.md` — plano original

### CI/CD
- `.github/workflows/ci.yml` — workflow de PR (em implementação)

## Testes

Números abaixo conferidos nesta rodada (working tree atual, incluindo trabalho de SOS/push em andamento não commitado):

| Suite | Comando | Status |
|-------|---------|--------|
| TypeScript | `npm run typecheck` | ✅ sem erros |
| Vitest | `npm run test` | ✅ 1360/1360 (78 arquivos) |
| SQL (PGlite) | `npm run test:sql` | ✅ 239/239 |
| SQL (Neon) | `npm run test:db` | ⚠️ Requer DATABASE_URL, não executado |
| Lint | `npm run lint` | ⚠️ 177 problemas (58 erros, 119 avisos) — baseline preservada, sem regressão introduzida por esta rodada de CI/CD |

## Versionamento

### Versão Atual
- **PWA**: `0.1.0` (package.json)
- **Android**: `1.0` (versionCode: 1)

### Script de Versionamento
```bash
npm run bump            # mostrar versão atual
npm run bump patch     # 0.1.0 → 0.1.1
npm run bump minor     # 0.1.0 → 0.2.0
npm run bump major     # 0.1.0 → 1.0.0
npm run bump 1.2.3     # set versão específica
```

> O script atualiza package.json E android/app/build.gradle simultaneamente.
> versionCode = major*10000 + minor*100 + patch

## Pendências Externas

### Android
- [x] Toolchain Android instalada e validada nesta máquina: Android Studio, JDK, Android SDK, ADB e Gradle presentes e funcionando.
- [x] `assembleDebug` e `assembleRelease` já rodaram com sucesso (artefatos em `android/app/build/outputs/apk/debug/` e `.../release/`, incluindo `.aab` em `android/app/build/outputs/bundle/release/`).
- [x] Aparelho físico Android disponível/testado: Samsung SM-A075M já esteve (ou está) conectado via ADB para testes.
- [ ] Keystore de release: presente em `android/keystore.properties` (fora do Git); confirmar se é o keystore definitivo de produção antes de publicar na Play Store.
- [ ] `com.google.android.gms:play-services-location` ainda comentado em `android/app/build.gradle` — bloqueia o rastreio em background nativo (ver seção "Rastreio em background" abaixo).

> Nota: o relatório `docs/mobile/MOBILE-PREFLIGHT.md`/`MOBILE-PREFLIGHT-REPORT.md` (24/08/2026) registrava toolchain Android ausente nesta máquina. Isso mudou — a toolchain foi instalada e validada depois desse relatório. Esses dois documentos ficam como registro histórico do estado daquela data; não refletem o estado atual.

### Dependências
- [ ] `@vercel/blob`/undici — vulnerabilidade corrigida no commit `a3b61d7`
- [x] `packageManager` e `engines` agora declarados no `package.json` (`npm@11.17.0`, `node >=20.9.0`)

### SOS / Push / Tracking — agentes em andamento

Há trabalho não commitado em andamento nestas áreas (fora do escopo desta tarefa de CI/CD; listado aqui apenas para visibilidade, sem avaliar corretude):

- **SOS** (`app/api/sos/route.ts`, `lib/sos.ts`, `lib/sosCandidates.ts`, `lib/rateLimit.ts`, `components/SosIncomingAlert.tsx`, `components/SosPanel.tsx`) — modificados no working tree, testes correspondentes (`lib/sos.test.ts`, `lib/rateLimit.test.ts`) também modificados. Não avaliado por este documento se as mudanças estão completas ou prontas para merge.
- **Push/FCM** (`lib/push.ts` modificado; `app/api/push/fcm/route.ts` e `lib/usePushNotifications.ts` novos, não commitados) — registro de token FCM nativo implementado (UPSERT por token, suporta múltiplos dispositivos). CRON_SECRET e credenciais FCM de produção não confirmados como configurados na Vercel.
- **Tracking / rastreio em background Android** (`app/api/downwind/[id]/tracking-token/route.ts`, `lib/trackingToken.ts`, `RastreioDownwindService.java`, `DownwindTrackerPlugin.java` — todos novos/não commitados) — status **NÃO CONCLUÍDO**: backend (emissão/validação/revogação de token) e estrutura Android (Foreground Service + plugin Capacitor) implementados, mas o build trava porque `play-services-location` está comentado em `android/app/build.gradle` (ver `docs/RASTREIO-BACKGROUND-ANDROID-LIMITACOES.md` para detalhes, limitações conhecidas — force-stop do app, fabricantes agressivos — e próximos passos). Não testado em aparelho real com o serviço em primeiro/segundo plano.

CRON_SECRET, VAPID keys e credenciais FCM de produção: estado real na Vercel não confirmado por este levantamento.

### Staging
- [ ] Branch/banco Neon staging não existe
- [ ] VARIÁVEIS de staging não separadas

## Histórico de Releases

| Data | Versão | Notas |
|------|--------|-------|
| — | 0.1.0 | Primeira versão |
| — | 1.0 (Android) | Primeira versão Android (debug) |

## Comandos Úteis

```bash
# Desenvolvimento
npm run dev            # Next.js dev server

# Build
npm run build         # Next.js + migração automática
npm run start         # Production server

# Testes
npm run test          # Vitest
npm run test:sql      # Validação SQL (PGlite)
npm run test:db       # Teste Neon real (requer DATABASE_URL)

# Lint
npm run lint          # ESLint
npm run typecheck     # TypeScript

# Android
npm run cap:sync      # Capacitor sync
npm run android:build:debug   # Debug APK
npm run android:build:release  # Release APK (requer keystore)

# Versionamento
npx tsx scripts/bump-version.ts patch  # Bump patch
```

## Estrutura de Diretórios

```
/
├── .github/workflows/    # CI/CD
├── android/              # Projeto Android
│   ├── app/build.gradle  # Versão Android
│   ├── gradle/           # Gradle wrapper
│   └── ...
├── app/                  # Next.js App Router
├── components/           # Componentes React
├── context/              # React Contexts
├── docs/                 # Documentação
│   ├── mobile/            # Mobile preflight reports
│   └── PROGRESSO-DESENVOLVIMENTO.md  # Este arquivo
├── lib/                  # Bibliotecas, schema SQL
├── mobile-shell/         # Shell Capacitor (placeholder)
├── scripts/              # Scripts de build/test
└── views/                # Views (MapView, etc)
```

## Out of Scope (não tocar)

- SOS (lib/sos*.ts, app/api/sos/**, app/api/cron/**)
- Push/FCM (lib/push.ts, app/api/push/**)
- Tracking (lib/useDownwindBeacon.ts, app/api/downwind/**)
- Contextos React (context/DownwindContext.tsx, context/KiteDataContext.tsx)
- UI principal (components/, views/, app/)

---

Última atualização: 2026-08-25
