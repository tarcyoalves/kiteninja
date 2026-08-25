# Relatório de pré-flight mobile — KiteNinja

**Data:** 24/08/2026
**Executor:** Fable 5
**Revisor obrigatório:** Opus 5
**Base inicial:** `704c9e60111d347924aeb19895981b543859e502`
**Status provisório:** `NO-GO` para Capacitor; investigação e preparação em andamento

> Este relatório só será fechado após as etapas de segurança, toolchain, lint, scheduler SOS e staging. `BUILD PASSOU` não significa que GPS, SOS, push ou background foram validados.

## 1. Estado inicial

- Branch `main`, dois commits documentais à frente e zero atrás de `origin/main`.
- Working tree limpa no início.
- Node `24.14.1`, npm `11.17.0`, lockfile v3.
- Nenhum projeto Capacitor/Android/iOS presente.
- Nenhuma funcionalidade mobile implementada nesta etapa.

## 2. Toolchain

- Windows 10 e `winget` disponíveis.
- Aproximadamente 122 GiB livres em C:.
- Android Studio, JDK, Android SDK, ADB e Gradle não detectados.
- Nenhum aparelho Android físico detectado.
- Matriz oficial atual ainda sob confirmação; nenhuma versão instalada por aproximação.
- iOS bloqueado por ausência de macOS/Xcode e aparelho/conta aprovados.

## 3. Dependências e reprodução

- npm permanece o gerenciador efetivo; não há proposta de troca.
- `packageManager`, `engines` e arquivo de versão Node estão ausentes.
- Node atual satisfaz os requisitos das ferramentas instaladas.
- Configuração reproduzível ainda depende de decisão do Opus.

## 4. Segurança

- Cadeia comprovada: `@vercel/blob@2.0.0 → undici@5.29.0`.
- Audit atual: 1 high + 1 moderate; 0 critical.
- `npm audit fix` não foi executado.
- Versão mínima corrigida e compatibilidade ainda sob validação.

## 5. Lint

- Baseline mantido: 56 erros e 116 avisos em 62 arquivos.
- Triagem focada em hooks/effects/refs e risco mobile em andamento.
- Nenhuma refatoração geral autorizada.

## 6. SOS

- Motor de escalada global e por alerta existe e passou nos checks adversariais.
- Concorrência cron/poll é condicionada pelo raio e testada localmente.
- Agenda publicada é diária, incompatível com escalada 5→15→50 km em minutos.
- Estado real de `CRON_SECRET`, VAPID e execução do scheduler não foi comprovado.
- Cron/SOS não será alterado sem decisão do Opus.

## 7. Staging

- Não há staging/banco descartável comprovado nem separação de secrets.
- Migração prefere URL direta, mas o ambiente local só declara URL pooled.
- Testes Neon e migração continuam bloqueados.
- Proposta segura está documentada em `MOBILE-PREFLIGHT.md`; infraestrutura não foi criada.

## 8. Riscos provisórios

1. Dependência de produção vulnerável.
2. Scheduler SOS não operacional em cadência de emergência comprovada.
3. Ausência de staging e guardas contra alvo de produção.
4. Toolchain Android ausente.
5. Aparelho Android real ausente.
6. Dívida de lint inclui regras de hooks potencialmente funcionais.
7. Node/npm não fixados para reprodução.
8. Push e secrets de produção não comprovados.

## 9. Mudanças realizadas

Até o momento:

- criado `MOBILE-PREFLIGHT.md`;
- criado este relatório provisório;
- nenhum código funcional, dependência, secret, banco, cron ou deploy alterado.

## 10. Testes repetidos

| Gate | Resultado |
|---|---|
| TypeScript | PASS |
| Vitest | 673/673 PASS |
| SQL/PGlite | 233/233 PASS |
| SOS adversarial | 53/53 PASS |
| Next build isolado | PASS |
| Neon real | BLOCKED |
| Android build | BLOCKED |
| Android real | BLOCKED |

## 11. GO / NO-GO provisório

**NO-GO para iniciar Capacitor neste momento.**

Motivos:

- matriz/toolchain Android ainda não instalada e validada;
- vulnerabilidade ainda aberta;
- scheduler SOS/staging aguardam decisão arquitetural;
- checklist aprovado exige prova operacional que ainda não existe;
- nenhum aparelho Android físico está disponível.

## 12. Decisões para o Opus 5

Pendentes antes do parecer final:

1. versão exata e estratégia de atualização de `@vercel/blob`;
2. campos `packageManager`/`engines` e versão Node reproduzível;
3. matriz oficial e instalação da toolchain Android;
4. conjunto mínimo de correções lint funcionais;
5. scheduler externo/por minuto, healthcheck e observabilidade SOS;
6. desenho de staging e proteção contra produção;
7. se o gate “SOS PWA em dois aparelhos antes do shell” permanece absoluto ou é milestone paralelo documentado.

## 13. Rollback

Até o fechamento, remover os dois documentos de pré-flight reverte toda alteração versionável desta etapa. Não há rollback de produto, banco ou infraestrutura.
