# Pré-flight mobile — KiteNinja

**Data:** 24/08/2026
**Executor:** Fable 5
**Supervisor:** Opus 5
**Base:** `704c9e60111d347924aeb19895981b543859e502`
**Status:** `EM ANDAMENTO`; Capacitor ainda não iniciado

## Classificação

- `PASS`: comprovado nesta execução.
- `FAIL EXISTENTE`: falha já presente antes do pré-flight.
- `FAIL NOVO`: regressão introduzida nesta execução.
- `BLOCKED`: depende de ambiente, decisão ou recurso ainda indisponível.
- `NÃO TESTADO`: não houve evidência suficiente.

## 1. Estado inicial

| Item | Resultado | Estado |
|---|---|---|
| Branch | `main`, rastreando `origin/main` | PASS |
| HEAD | `704c9e6` | PASS |
| Relação com remoto | 2 commits documentais à frente, 0 atrás | PASS |
| Working tree | limpa no início | PASS |
| Node | `24.14.1` | PASS |
| npm | `11.17.0` | PASS |
| Lockfile | `package-lock.json`, lockfile v3 | PASS |
| Dependências instaladas | `npm ls --depth=0` sem pacote faltante/inválido | PASS |
| Projetos Capacitor/Android/iOS | inexistentes | BLOCKED — ainda não iniciados por regra |

Os dois commits locais anteriores contêm somente documentação da Fase 0:

- `d19c246 docs(mobile): record phase zero baseline`;
- `704c9e6 docs(mobile): record phase zero gate decision`.

## 2. Validação repetida

| Verificação | Resultado | Estado |
|---|---:|---|
| TypeScript | exit 0 | PASS |
| Vitest | 673/673, 38 arquivos | PASS |
| SQL/PGlite | 233/233 | PASS |
| SOS adversarial/PGlite | 53/53 | PASS |
| Next build isolado | compilação, typecheck e geração de páginas concluídos | PASS |
| `npm run build` | não executado: chamaria migração no Neon configurado | BLOCKED |
| Neon `test:db` | não executado: cria/remove dados e não há staging | BLOCKED |

A compilação foi executada diretamente pelo CLI do Next para não acionar `scripts/migrate-on-build.ts`.

## 3. Toolchain Android

| Item | Resultado | Estado |
|---|---|---|
| Windows | 10.0.19045 | PASS |
| `winget` | 1.29.290 disponível | PASS |
| Espaço livre em C: | aproximadamente 122 GiB | PASS |
| JDK/`java`/`javac` | ausentes | BLOCKED |
| Android Studio | não detectado | BLOCKED |
| Android SDK | ausente; variáveis não definidas | BLOCKED |
| ADB | ausente | BLOCKED |
| Gradle global | ausente; o projeto Android deverá usar wrapper | BLOCKED |
| Aparelho Android físico | não detectado por PnP | BLOCKED |
| Hardware para IDE/build | Windows 10 Pro 64-bit, ~16 GiB RAM, ~122 GiB livres | PASS |
| Emulador Android | CPU sem SLAT reportado e virtualização de firmware desativada; recursos opcionais não puderam ser lidos sem elevação | BLOCKED / não é substituto do aparelho real |
| iOS/Xcode | máquina Windows | BLOCKED |

A matriz oficial atual de Capacitor/JDK/AGP/SDK/target Play está sendo confirmada antes de instalar ou fixar versões. O catálogo `winget` oferece `Google.AndroidStudio 2026.1.3.7` (lançado em 30/07/2026), mas disponibilidade não equivale a compatibilidade aprovada. Emulador não substituirá aparelho real.

## 4. Node e package manager

Estado atual:

- npm é o gerenciador efetivo;
- `package-lock.json` v3 está versionado;
- `package.json` não declara `packageManager` nem `engines`;
- npm usa `save-exact=false` e `engine-strict=false`;
- Node 24.14.1 satisfaz os engines instalados de Next (`>=20.9.0`), Vitest (`^20 || ^22 || >=24`) e Blob (`>=20`).

**Opções para decisão do Opus, nenhuma aplicada:**

- **A — recomendada:** manter npm, declarar `packageManager` com a versão npm validada no pré-flight, declarar uma faixa major de Node LTS compatível e adicionar um arquivo de versão para desenvolvimento. Preserva o lockfile e evita troca de ecossistema.
- **B:** fixar também o patch exato de Node. Aumenta a reprodução byte a byte, mas exige atualização frequente de segurança e pode divergir do runtime permitido na Vercel.
- **C — não recomendada:** trocar para pnpm/yarn. Não há problema atual que justifique novo lockfile, nova resolução e risco adicional antes do Capacitor.

A faixa final de Node só deve ser escolhida depois de cruzar requisitos oficiais de Next, Vitest, Capacitor e ambiente de deploy. Nenhum campo foi alterado.

## 5. Segurança de dependências

Cadeia confirmada localmente:

```text
projeto
└─ @vercel/blob 2.0.0
   └─ undici ^5.28.4 → resolvido 5.29.0
```

`npm audit --omit=dev` continua registrando:

- 1 vulnerabilidade agregada high (`undici`);
- 1 moderate (`@vercel/blob` afetado pela cadeia);
- 0 critical;
- correção indicada como disponível.

Versão corrigida, compatibilidade e usos reais estão em investigação. Não foi executado `npm audit fix` e nenhum pacote foi alterado.

## 6. Lint

Baseline preservado: 56 erros e 116 avisos em 62 arquivos, todos anteriores ao pré-flight. A triagem de hooks/effects/refs está em andamento.

Política desta etapa:

- corrigir somente risco funcional comprovado ou plausível;
- mudanças pequenas, com teste direcionado;
- não zerar warnings por estética;
- não misturar saneamento de lint com dependências ou Capacitor.

## 7. SOS e scheduler

Estado já confirmado:

- motor compartilhado em `lib/sosEscalada.ts`;
- porta global no cron e porta por alerta no polling de `/api/sos/active`;
- atualização condicionada ao raio lido evita escalada dupla entre cron/poll;
- checks adversariais passaram 53/53;
- `vercel.json` agenda o cron apenas diariamente (`0 3 * * *`), incompatível com estágios em minutos;
- `CRON_SECRET` e VAPID não são comprovados em produção pelo ambiente local;
- nenhuma mudança de cron/SOS será feita sem decisão do Opus.

A arquitetura completa, opções de scheduler, healthcheck e impacto estão sob revisão do Opus.

## 8. Staging

Não foi encontrado:

- projeto Vercel localmente vinculado;
- branch/configuração versionada de staging;
- variável de banco de staging/teste;
- banco descartável comprovado;
- separação de secrets por ambiente;
- arquivo `.neon` ligando este checkout a projeto/branch.

O script de migração prefere `DATABASE_URL_UNPOOLED`, mas essa variável não está declarada em `.env.local` nem em `.env.example`; hoje ele cai para a URL pooled. A orientação oficial do Neon é usar conexão pooled no runtime serverless e conexão direta para migrações.

**Proposta para decisão do Opus, ainda não implementada:**

1. branch/banco Neon isolado e identificável como staging;
2. `DATABASE_URL` pooled para o app e `DATABASE_URL_UNPOOLED` direta para migração;
3. projeto/ambiente Vercel separado ou Preview explicitamente vinculado ao banco de staging;
4. secrets próprios, nunca copiados implicitamente da produção;
5. dados sintéticos ou sanitizados — não clonar localização, SOS, mensagens ou perfis reais para desenvolvedores/dispositivos;
6. guardas que recusem migração/teste destrutivo quando o alvo for produção;
7. reset/descarte documentado e rollback por branch, dentro dos limites do plano contratado.

Estado: `BLOCKED`. Testes destrutivos, migrações, SOS e tracking não serão apontados ao banco configurado em `.env.local`. Nenhum recurso Neon/Vercel foi criado.

## 9. Produção e segurança operacional

Nenhum secret, banco, deploy, cron, API, autenticação, SOS ou produção foi alterado. O artefato `.next/` é local e ignorado.

## 10. Pendências para fechar o pré-flight

- [ ] decisão exata sobre atualização `@vercel/blob`/`undici`;
- [ ] instalar e validar toolchain Android oficial;
- [ ] identificar aparelho Android físico com depuração USB;
- [ ] decisão sobre `packageManager` e `engines`;
- [ ] triagem e correções mínimas de lint de risco;
- [ ] decisão Opus sobre scheduler SOS;
- [ ] decisão Opus sobre staging/banco controlado;
- [ ] repetir gates após qualquer mudança;
- [ ] produzir `MOBILE-PREFLIGHT-REPORT.md` e obter GO/NO-GO.

## 11. Rollback

Até este ponto só este documento foi criado. Rollback: remover `docs/mobile/MOBILE-PREFLIGHT.md`. Nenhum rollback de produto ou banco é necessário.
