# Roteiro de Release — KiteNinja

> Guia operacional para publicar novas versões.

## Pré-requisitos

1. **Versionamento atualizado**
   ```bash
   npm run bump patch  # ou minor/major/x.y.z
   ```

2. **CI verde** — Todos os jobs devem passar:
   - TypeScript
   - Tests (Vitest)
   - SQL Validation (PGlite)
   - Lint
   - Build Next.js
   - Android Debug Build

3. **Secrets configurados** (produção):
   - `DATABASE_URL` (Neon pooled)
   - `DATABASE_URL_UNPOOLED` (Neon direto, para migração)
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT`
   - `CRON_SECRET`
   - `GOOGLE_APPLICATION_CREDENTIALS_JSON` (FCM)

## Fluxo de Release

### 1. PWA (Vercel)

O deploy acontece automaticamente ao fazer merge na `main`:
1. GitHub Actions CI passa
2. Merge no GitHub
3. Vercel detecta push na `main`
4. Build automático (`npm run build`)
5. Deploy para https://kiteninja.vercel.app

### 2. Android

#### Debug Build
```bash
npm run cap:sync
npm run android:build:debug
# APK em android/app/build/outputs/apk/debug/app-debug.apk
```

#### Release Build (requer keystore)
```bash
# 1. Configure android/keystore.properties
# (NUNCA commitar este arquivo)
storeFile=C:/path/to/keystore.jks
storePassword=xxxx
keyAlias=kiteninja
keyPassword=xxxx

# 2. Build
npm run android:build:release
# APK em android/app/build/outputs/apk/release/app-release.apk
```

#### Play Store
1. Gerar o **AAB assinado** com `cd android && ./gradlew bundleRelease`
2. Validar o artefato em `android/app/build/outputs/bundle/release/app-release.aab`
3. Criar conta Google Play Developer
4. Criar app no Google Play Console
5. Fazer upload do AAB (APK é apenas para instalação/teste direto)
6. Preencher fichas, política de privacidade, classificação e screenshots
7. Submeter primeiro à faixa de teste interno e depois à revisão

## Rollback

### PWA
1. Vercel Dashboard → Deployments
2. Selecionar versão anterior
3. Click "Promote to Production"

### Android
- Não há rollback automático
- Atualizar com versão anterior no Play Store

## Checklist de Release

- [ ] `npm run bump` executado
- [ ] Versão atualizada em package.json
- [ ] Versão atualizada em android/app/build.gradle
- [ ] CI passou (todos os jobs)
- [ ] changelog.md atualizado
- [ ] secrets de produção configurados
- [ ] deploy PWA verificado
- [ ] Android APK gerado (se aplicável)
- [ ] Play Store atualizado (se aplicável)

## Notas

### Migration no Build
O script `scripts/migrate-on-build.ts` roda automaticamente no `npm run build`.
- Se `DATABASE_URL` estiver definida → aplica schema
- Se ausente → pula (útil para CI sem banco)

### VersionCode Android
O script `bump-version.ts` calcula automaticamente:
```
versionCode = major * 10000 + minor * 100 + patch
```
Exemplo: 1.2.3 → 10203

### GitHub Actions
- Rama `main` → deploy automático
- PRs → CI apenas (sem deploy)
- Sem secrets configurados no CI (build de debug não precisa)
