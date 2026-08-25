# Matriz KEEP / ADAPT / REWRITE / NATIVE

**Base:** KiteNinja `e15dc03`. Esta matriz transforma o plano master em decisões de migração por domínio.

## Legenda

- **KEEP:** manter desenho e código com mudanças pequenas.
- **ADAPT:** extrair contrato/adapter e reutilizar a maior parte.
- **REWRITE:** reconstruir o cliente daquela capacidade; backend/regra pode permanecer.
- **NATIVE:** implementar a borda em Android/iOS e expor por interface TypeScript.

| Domínio | Decisão | O que permanece | O que muda | Gate |
|---|---|---|---|---|
| Backend Next/API | KEEP + ADAPT | rotas, SQL parametrizado, authz, domínio | `/api/v1`, schemas, erros, idempotência, paginação | contratos web/mobile verdes |
| Neon/schema | KEEP | modelo relacional, constraints e índices | sessões mobile, devices, outbox/telemetria, retenção | migração idempotente + teste Postgres |
| UI React/Tailwind | KEEP + ADAPT | componentes, tokens, safe areas, fluxos | remover dependência direta de browser e APIs relativas | browser + WebView iguais |
| Navegação | ADAPT | tabs/modais e IA atual | deep links e lifecycle; URL como estado quando útil | link frio/quente em iOS/Android |
| Auth web | KEEP | cookie opaco httpOnly | nenhuma regressão | suite auth atual |
| Auth mobile | REWRITE | regras de usuário/role e tabelas-base | token opaco rotacionável, secure storage, device sessions | rotação/revogação testadas |
| Perfil/social | KEEP + ADAPT | APIs e UI principal | api-client, paginação, cache, bloqueio/denúncia | offline/stale e UGC gates |
| Feed/logbook | KEEP + ADAPT | domínio e componentes | cursor, outbox, uploads por arquivo | retry sem duplicata |
| Chat geral/spot/DM | ADAPT | banco, autorização, UI | push nativo DM, cursor, dedupe, polling unificado | mensagens sem perda/duplicata |
| Classificados | KEEP + ADAPT | sem checkout, regras e CRUD | denúncia/bloqueio, mídia, moderação | store UGC compliance |
| Eventos/alertas | KEEP + ADAPT | APIs e telas | deep links, cache, preferências push | link e badge corretos |
| Chamados/admin | KEEP | fluxo atual | metadata app/platform/version em bug report | chamado reproduzível |
| SOS domínio/server | KEEP + HARDEN | máquina de estados, constraints, seleção e escalada | idempotency key, delivery ledger, healthcheck/alarme | exercícios multiaparelho |
| SOS cliente | ADAPT + NATIVE | hold e UI de estados | persistência local, localização/haptics/deep link nativos | nunca mente sobre ACK |
| Web Push | KEEP | PWA/VAPID | dispatcher comum | PWA continua recebendo |
| Push mobile | NATIVE | payload semântico | APNs/FCM, device registry e token lifecycle | matriz de lifecycle real |
| Presença geral | ADAPT | endpoint e regra de frescor | plugin foreground/lifecycle e menor cadência | bateria/rede aprovadas |
| Tracking de sessão | NATIVE | formato de pontos e cálculos puros | background location + buffer SQLite/batch | tela bloqueada/rede oscilante |
| Tracking downwind | NATIVE | API, schema, UI e domínio | service/background mode, fila e health | sem buraco silencioso |
| Leaflet/maps | KEEP no R1 | componentes e tiles/atribuição | adapter e lifecycle; medir | FPS/memória em aparelhos |
| Mapas offline | ADIAR/REWRITE | coordenadas/rotas | provedor/licença e tile packs próprios | licença + quota + UX |
| Previsão Open-Meteo | KEEP + ADAPT | backend e normalização | snapshot persistido, TTL/stale/fonte | sem zero inventado |
| Maré | HARDEN | pipeline atual | validar/calibrar fórmula por estação e disclaimer | revisão técnica de dados |
| Vento observado | KEEP + ADAPT | integração atual | cache/fonte/idade/fallback | indisponibilidade honesta |
| PWA/service worker | KEEP + ADAPT | canal web e Web Push | cache mínimo separado do mobile | atualização segura |
| Offline mobile | REWRITE | dados e contratos | SQLite, cache versionado, outbox | migrations/eviction/recovery |
| Upload/mídia | ADAPT | Vercel Blob e compressor | arquivo, presigned upload, retomada; remover data URL grande | falha/retry sem duplicata |
| Rate limiting | REWRITE server | semântica dos limites | storage compartilhado/atômico | múltiplas instâncias testadas |
| Observabilidade | ADD | `sosLog` sem PII como base | erros, métricas, alertas, traces/request ID | simulação gera alerta |
| CI/CD web | ADD | scripts atuais | workflow type/test/sql/build | branch protegida |
| CI/CD mobile | ADD | — | build, signing, artifacts, TestFlight/Play tracks | builds reproduzíveis |
| Privacidade/UGC | ADD | authz/moderação existente | política, exclusão/exportação, denúncia e bloqueio | checklist das lojas |

## Escolha de tecnologia por alternativa

### Capacitor — recomendada, com Android primeiro

**Prós neste repo**

- máximo reuso de React/Tailwind/componentes;
- plugins nativos podem ser introduzidos por domínio;
- Android/iOS no mesmo produto, mantendo o PWA;
- permite código nativo customizado para tracking safety-critical;
- menor risco de regressão de UI e regras.

**Riscos**

- precisa de cliente compilável separado do Next server;
- o cliente atual tem 63 chamadas relativas `/api` em 30 arquivos e depende do cookie web same-origin; assets locais exigem base URL absoluta, `api-client` e sessão mobile bearer segura;
- `server.url` remoto não é solução de produção: além de não fornecer casca offline, reduz o produto a um site carregado na WebView e não resolve a autenticação/arquitetura alvo;
- o plugin oficial `@capacitor/geolocation` não fornece tracking contínuo em background; o requisito depende de plugin mantido ou módulo nativo próprio, ambos sujeitos a spike, licença e revisão de políticas;
- plugins de background location de terceiros exigem auditoria de manutenção/licença;
- WebView + Leaflet precisa de teste de memória/FPS;
- uma casca que só abre o site pode sofrer rejeição por baixa funcionalidade e não resolve offline/background;
- iOS exige conta de distribuição e build/assinatura com macOS/Xcode ou CI macOS; no ambiente atual, isso é um gate explícito, não uma suposição.

**Ordem recomendada sob free tier/Windows**

1. provar VAPID + scheduler externo + SOS no PWA;
2. provar shell/auth, background GPS e mapa no Android;
3. iniciar iOS somente após aceitar os requisitos de conta e build macOS.

Isso é uma estratégia de implantação faseada, não duas arquiteturas: PWA, Android e futuro iOS compartilham backend, contratos, domínio e UI.

### React Native — não agora

Vantagem: ecossistema nativo e mapas/background maduros. Desvantagem: componentes DOM, CSS/Tailwind e Leaflet não são reutilizados diretamente; haveria reescrita grande da UI, mantendo ainda o backend. Considerar somente se o shell Capacitor falhar nos gates de performance ou plugins críticos.

### Flutter — não recomendado para esta migração

Exige reescrita completa de UI e linguagem/toolchain adicional, com pouco reaproveitamento do React atual. Pode produzir ótimo app, mas o custo de paridade e risco funcional não se justificam sem equipe Flutter dedicada.

### TWA/PWA empacotada — inadequada como solução completa

Pode acelerar Android, mas não resolve iOS, background location confiável, push nativo uniforme nem offline safety. Continua dependente do comportamento do navegador e cria duas estratégias divergentes.

### App nativo duplo — fora do escopo atual

Swift/Kotlin oferecem controle máximo, mas duplicam produto, testes e manutenção. Reservar código nativo somente para plugins/serviços críticos sob uma API comum.

## Critério de abandono do Capacitor

Só reconsiderar a escolha após um spike medido que demonstre pelo menos um bloqueio sem mitigação aceitável:

1. background tracking não atende aos gates mesmo com plugin/código nativo próprio;
2. Leaflet/WebView não atende budget de memória/FPS e a migração de mapa dentro do Capacitor não resolve;
3. políticas das lojas impedem a arquitetura mesmo com assets locais e integrações nativas;
4. share de UI real fica baixo demais após extração das dependências web.

Preferência ou percepção de “mais nativo” não é critério; dados dos spikes são.
