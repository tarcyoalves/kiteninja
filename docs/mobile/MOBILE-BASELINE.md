# Baseline mobile — Fase 0

**Projeto:** KiteNinja
**Data:** 24/08/2026
**Fase:** 0 — baseline, sem alteração de código funcional
**Status:** `IMPLEMENTADO`, `TESTADO` e **APROVADO COM CONDIÇÕES pelo Opus 5**; Fase 1 ainda não iniciada
**Commit auditado:** `e15dc03014b40aaee53e578ccaf09d539228a5b8`
**Branch:** `main`, rastreando `origin/main`

## 1. Regra de classificação

- `PASS`: comando ou verificação concluída no baseline.
- `FAIL EXISTENTE`: falha reproduzida no commit remoto, antes de qualquer código mobile.
- `FAIL NOVO`: regressão introduzida pela fase atual.
- `BLOQUEADO`: não executado porque faltou ambiente seguro, ferramenta, aparelho ou autorização.
- `NÃO TESTADO`: fora do escopo técnico executável desta máquina.

Resultado agregado: **nenhum `FAIL NOVO`**. A Fase 1 ainda não foi iniciada; staging/banco descartável e toolchain Android permanecem condições de preparação conforme a decisão do Opus 5 na seção 11.

## 2. Git e integridade da árvore

| Verificação | Resultado | Classificação | Evidência |
|---|---|---|---|
| Branch/upstream | `main` → `origin/main` | PASS | `git branch --show-current`; `@{upstream}` |
| Sincronização remota | local e remoto no mesmo SHA; ahead `0`, behind `0` | PASS | `git fetch origin main --prune`; `git rev-list --left-right --count HEAD...origin/main` |
| Alterações rastreadas antes da fase | nenhuma | PASS | `git status --porcelain` |
| Arquivos não rastreados antes da fase | apenas `docs/mobile/` | PASS | documentação produzida pela auditoria anterior |
| `git diff --check` | sem erro | PASS | nenhuma alteração funcional ou whitespace inválido |
| Force push/reset/produção | não executados | PASS | regra de segurança preservada |

O build criou somente `.next/`, já ignorado. Esta fase criou/atualizou apenas documentação em `docs/mobile/`.

## 3. Ambiente e toolchain

| Item | Estado |
|---|---|
| SO | Windows 10 build 19045, Git Bash/MSYS2 x86_64 |
| Node.js | `v24.14.1` |
| npm | `11.17.0` |
| Gerenciador/lock | npm; `package-lock.json` lockfile v3 |
| Git | `2.53.0.windows.2` |
| Java/JDK | `BLOQUEADO` — não instalado/não está no PATH |
| Android SDK | `BLOQUEADO` — `ANDROID_HOME` e `ANDROID_SDK_ROOT` ausentes |
| ADB | `BLOQUEADO` — comando ausente |
| Xcode/macOS | `BLOQUEADO` nesta máquina Windows |
| Vercel CLI/link local | ausente; `.vercel/project.json` não existe |
| CI versionado | ausente; zero workflows em `.github/workflows` |

Não existem ainda `android/`, `ios/` ou `capacitor.config.*`.

## 4. Stack e dependências instaladas

Versões principais resolvidas:

- Next.js `16.3.1`;
- React/React DOM `19.2.8`;
- TypeScript `5.9.3`;
- Tailwind CSS `4.3.3`;
- Vitest `4.1.10`;
- ESLint `9.39.5`;
- Leaflet `1.9.4` e React Leaflet `5.0.0`;
- Neon serverless `1.1.0`;
- Vercel Blob `2.0.0`;
- Web Push `3.6.7`.

`npm ls --depth=0 --json` terminou sem dependência faltante ou inválida.

O `package.json` não fixa `packageManager` nem `engines`. Isso deve ser decidido antes de automatizar CI/build mobile, sem alterar a arquitetura por conta própria.

## 5. Matriz de validação

| Validação | Comando seguro executado | Resultado | Classificação |
|---|---|---:|---|
| Typecheck | `node node_modules/typescript/bin/tsc --noEmit` | exit 0 | PASS |
| Vitest | `node node_modules/vitest/vitest.mjs run` | 38 arquivos, **673/673** testes | PASS |
| SQL/PGlite | `node node_modules/tsx/dist/cli.mjs scripts/verify-sql.ts` | **233/233** checks | PASS |
| SOS adversarial/PGlite | `node node_modules/tsx/dist/cli.mjs scripts/verify-sos.ts` | **53/53** checks | PASS |
| Compilação Next isolada | `node node_modules/next/dist/bin/next build` | compilou, typecheck e 36 páginas estáticas concluídos | PASS |
| Lint | `node node_modules/eslint/bin/eslint.js .` | **56 erros, 116 avisos em 62 arquivos** | FAIL EXISTENTE |
| Audit de dependências de produção | `npm audit --omit=dev --json` | 1 high + 1 moderate, 0 critical | FAIL EXISTENTE |
| Integração Neon | `npm run test:db` | não executado: escreve/apaga dados no banco de `.env.local` | BLOQUEADO |
| Build via script npm | `npm run build` | não executado: roda migração antes de compilar | BLOQUEADO |
| Android/iPhone reais | — | ainda não há shell nem toolchain | NÃO TESTADO |

### 5.1 Baseline de lint existente

Principais grupos:

- `react-hooks/set-state-in-effect`: 34;
- `react-hooks/refs`: 11;
- `react/no-unescaped-entities`: 4;
- `react-hooks/exhaustive-deps`: 4;
- `@typescript-eslint/no-explicit-any`: 3;
- outras regras: 4 erros;
- avisos dominados por `@typescript-eslint/no-unused-vars` (84) e `@next/next/no-img-element` (25).

Há ainda três diretivas `eslint-disable` sem uso, reportadas sem `ruleId`. Como o código rastreado é idêntico a `origin/main`, toda essa dívida é pré-existente. A Fase 0 não a corrigiu.

### 5.2 Audit de dependências existente

`npm audit --omit=dev` reportou:

- `undici` transitivo via `@vercel/blob`: severidade agregada high;
- `@vercel/blob` direto afetado pela cadeia: moderate;
- correção indicada pelo npm como disponível;
- nenhuma vulnerabilidade critical.

Atualizar dependência de produção é mudança separada. Deve receber validação e revisão de segurança antes do shell mobile; não foi aplicado `npm audit fix` automaticamente.

## 6. Build e banco — limite de segurança

O script versionado é:

```text
build = tsx scripts/migrate-on-build.ts && next build
```

`migrate-on-build.ts` carrega `.env.local`, conecta ao Neon e executa o schema, incluindo atualização defensiva de dados duplicados. Por isso:

- a compilação foi validada chamando o CLI do Next diretamente;
- `npm run build` não foi usado localmente contra a URL configurada;
- `scripts/verify-db.ts` também não foi executado, pois cria e remove dados reais;
- antes de CI/staging, é obrigatório fornecer banco descartável/controlado e separar evidência de migração da compilação.

A `DATABASE_URL` local existe, usa `postgresql:`, host pooled e `sslmode=require`; host, usuário e senha não foram registrados neste documento.

## 7. Ambientes

### Local

- `.env.local` contém `DATABASE_URL` configurada.
- `APP_URL`, `CRON_SECRET` e VAPID não estão em `.env.local`.
- `.env.local.vapid` contém o trio VAPID, mas esse nome não é carregado automaticamente pelo Next nem por `scripts/load-env.ts`, cujo padrão é apenas `.env.local`.
- Consequência: **push local não deve ser considerado configurado** sem mover/injetar essas variáveis por um mecanismo aprovado.

### Staging

**BLOQUEADO / AUSENTE.** Não foi encontrada configuração versionada de staging, branch dedicada, projeto Vercel localmente vinculado, banco descartável ou conjunto de variáveis separado. Branches remotas antigas não constituem ambiente de staging comprovado.

Criar staging envolve decisões sobre banco, secrets, Vercel, migração e dados; exige revisão do Opus 5.

### Produção

- URL: `https://kiteninja.vercel.app`;
- branch local/remota de referência: `main` em `e15dc03`;
- smoke somente leitura da raiz: HTTP 200;
- `<title>KiteNinja</title>` e link do manifest presentes;
- manifest: nome `KiteNinja — Vento, Marés e Spots`, `display=standalone`, `start_url=/`, três ícones;
- `vercel.json` configura `/api/cron/sos-escalada` apenas em `0 3 * * *` (diário), inadequado para escalada em minutos;
- estado real de secrets e vínculo branch→produção no dashboard não pôde ser verificado sem acesso/CLI;
- `docs/OPERACAO-SOS.md` continua sendo a evidência operacional para VAPID/cron, não a existência de arquivos locais.

## 8. Riscos e bloqueios que seguem para revisão

### Críticos para iniciar implementação mobile

1. Não há staging seguro nem banco descartável para integração/migração.
2. Java, Android SDK e ADB não estão disponíveis nesta máquina.
3. iOS exige macOS/Xcode e conta/certificados; não é executável nesta máquina.
4. A autenticação mobile, base URL e cliente API ainda são decisões da Fase 1; nenhuma foi improvisada.
5. GPS/background, push, SOS, SQLite e armazenamento seguro permanecem não implementados.

### Dívida existente a tratar separadamente

1. Lint: 56 erros e 116 avisos.
2. Audit: `@vercel/blob`/`undici` com high/moderate e fix disponível.
3. Ausência de CI.
4. Push local não carregado pelo arquivo padrão.
5. Cron de produção diário e secrets de produção não verificáveis deste ambiente.

## 9. Evidências e artefatos

- este arquivo;
- `PLANO-MASTER-MOBILE.md`;
- `MATRIZ-MIGRACAO.md`;
- `STORE-READINESS.md`;
- saída dos comandos executados nesta sessão;
- `.next/` local como artefato descartável/ignorado da compilação.

Não foram gravados secrets, URLs privadas de banco, tokens ou coordenadas.

## 10. Rollback da Fase 0

Não existe rollback de produto: nenhum código, banco, secret, deploy ou configuração de runtime foi alterado. Para desfazer a fase, remover somente a documentação nova de `docs/mobile/` e o artefato ignorado `.next/`.

## 11. Decisão do Opus 5

**Veredito em 24/08/2026:** `FASE 0 APROVADA COM CONDIÇÕES`.

### Condições e classificação

1. **Lint:** dívida pré-existente; não reprova o baseline. Corrigir em mudança própria, com validação e rollback, antes de misturar alterações amplas do shell.
2. **Dependências:** `@vercel/blob`/`undici` deve ser atualizado em commit de segurança separado e validado antes do build mobile; não executar `npm audit fix` indiscriminadamente.
3. **Staging:** decisão ainda pendente. O mínimo recomendado é feature branch + banco descartável/controlado para migração e integração, sem assumir recurso pago. Não criar script de migração ou arquitetura de ambiente sem revisão específica.
4. **Toolchain Android:** instalar somente após confirmar a matriz oficial vigente do Capacitor/Android Gradle Plugin/Google Play na data da Fase 1. Não congelar aqui números de JDK, SDK ou target potencialmente desatualizados.
5. **Ordem de plataforma:** Android-first confirmado. iOS continua bloqueado até existir macOS/Xcode próprio ou CI macOS, Apple Developer Program e possibilidade de teste em iPhone real.
6. **Separação de commits:** saneamento de lint, atualização de dependência, staging/toolchain e inicialização Capacitor não devem ser misturados num único commit.

### Bloqueadores por marco

- **Para preparar a Fase 1:** decisão de staging/banco descartável e confirmação oficial da toolchain.
- **Durante a Fase 1, antes do build mobile:** atualização segura da dependência vulnerável; baseline de lint não pode piorar e sua correção deve ser isolada.
- **Para beta/release:** lint aprovado, audit sem vulnerabilidade crítica/alta não aceita, CI, staging, aparelhos reais e todos os gates de segurança/loja.
- **Para iOS:** requisitos de conta, signing, macOS/Xcode e aparelho real.

Nenhuma dessas condições autoriza alterar banco, autenticação, API, SOS, GPS, push, armazenamento ou arquitetura sem nova revisão do Opus 5.
