# Portões de qualidade, aparelhos e publicação mobile

Use esta checklist como condição de passagem. “Funciona no simulador” não aprova um recurso de segurança.

## 1. Baseline obrigatório

**Execução de referência:** `MOBILE-BASELINE.md`, commit `e15dc03`, 24/08/2026. Itens de aparelho, staging, banco real e operação continuam abertos; não interpretar o baseline local como aprovação de release.

- [ ] Registrar commit exato, versões Node/npm/Xcode/Android Studio/JDK.
- [ ] Confirmar o gate de plataforma: Android pode começar no Windows; iOS só começa com Apple Developer Program e macOS/Xcode próprio ou CI macOS aprovados.
- [ ] Provar VAPID, scheduler externo por minuto e SOS PWA em dois aparelhos antes de criar o shell nativo.
- [ ] `npm run typecheck` verde.
- [ ] `npm test` verde.
- [ ] `npm run test:sql` verde.
- [ ] `npm run test:db` verde em banco descartável/controlado.
- [ ] `npx tsx scripts/verify-sos.ts` verde.
- [ ] Compilação Next verde em ambiente controlado. `npm run build` executa `scripts/migrate-on-build.ts`; usar banco descartável/controlado ou chamar a compilação Next isoladamente, nunca migrar produção por acidente.
- [ ] Migração testada separadamente, idempotente e com alvo/ambiente explicitamente verificados.
- [ ] Smoke de produção web e PWA.
- [ ] Schema real comparado ao esperado.
- [ ] Backup/restore de banco provado antes de migração mobile.

## 2. Pirâmide de testes alvo

### Unitários

- regras de domínio, authz, geografia, forecast, maré, vento, estado de sinal;
- serialização de contratos e migrations de cache;
- retries/backoff/dedupe/idempotência;
- adapters com fakes de localização, push, storage e lifecycle.

### Contrato/API

- web cookie e mobile bearer em todos os endpoints protegidos;
- roles e convidados;
- schemas backward/forward compatible;
- paginação, cursores e erros estáveis;
- idempotency keys concorrentes;
- tokens revogados/rotacionados;
- posição/UGC de outro usuário nunca vaza;
- `/api/sos/active` busca alertas e socorristas em número limitado de queries, sem uma query adicional por alerta;
- fanout de push tem concorrência limitada, timeout e métricas antes de qualquer envio em lote real;
- políticas de retenção e expurgo existem para chat, notificações, auditoria, sessões expiradas, posições e SOS, com exceções de segurança/legais documentadas.

### Integração nativa

- permissões negada, limitada, temporária e revogada;
- token APNs/FCM novo, rotacionado, inválido e duplicado;
- Keychain/Keystore após reboot, logout e reinstalação;
- SQLite migration, corrupção controlada, disk full e purge;
- deep link frio, quente, autenticado e deslogado;
- lifecycle foreground/background/terminated.

### E2E

- login, troca de senha, logout e revogação;
- spot/previsão/mapa;
- criar/editar sessão, feed/comentário/like;
- chat/DM e push;
- evento/downwind/convite de apoio;
- anúncio e moderação;
- excluir/exportar conta;
- SOS completo.

## 3. Matriz mínima de aparelhos reais

Definir versões mínimas somente após analytics/pesquisa da comunidade. A matriz precisa conter, no mínimo:

### iOS

- iPhone menor/antigo ainda suportado;
- iPhone moderno com notch/Dynamic Island;
- versão mínima suportada;
- versão iOS estável atual;
- Low Power Mode, Background App Refresh on/off;
- Wi-Fi, 4G/5G, modo avião, sinal intermitente;
- app foreground, background, tela bloqueada, encerrado pelo sistema e force-quit pelo usuário.

### Android

- Pixel/AOSP como referência;
- Samsung recente;
- ao menos um fabricante com gestão agressiva de bateria;
- versão mínima e versão estável atual;
- economia de bateria, Data Saver, permissão “só desta vez”, localização aproximada/precisa;
- foreground service visível;
- app background, tela bloqueada, processo morto e force-stop.

Simuladores/emuladores complementam, nunca substituem GPS, APNs/FCM, bateria, câmera e lifecycle reais.

## 4. Gate de SOS

### Cenários obrigatórios

- [ ] autor com GPS preciso;
- [ ] autor sem GPS/permissão negada;
- [ ] autor offline antes do ACK;
- [ ] rede cai depois que servidor cria o SOS, antes da resposta;
- [ ] duplo toque e duas requisições concorrentes;
- [ ] quatro ou mais POSTs para o mesmo SOS aberto, atualizando posição, sem consumir o limite de novas emergências;
- [ ] encerrar o alerta e iniciar outro legítimo sem bloqueio indevido do rate limit;
- [ ] nenhum candidato inicial, escalada 5→15→50 km;
- [ ] candidato via proximidade;
- [ ] candidato via downwind e apoio em terra;
- [ ] dois socorristas respondem simultaneamente;
- [ ] último socorrista desiste e alerta volta a `ativo`;
- [ ] resolve/cancela enquanto push está em trânsito;
- [ ] resolução, cancelamento e falso alarme emitem evento estruturado `encerrado`;
- [ ] push em foreground/background/encerrado;
- [ ] token inválido e usuário com múltiplos aparelhos;
- [ ] deep link não revela posição antes da autorização;
- [ ] telefone oficial acessível sem internet;
- [ ] scheduler parado gera alarme operacional.

### Critérios

- UI só diz “enviado” depois de ACK idempotente do servidor.
- Falha de rede diz explicitamente que a comunidade não foi avisada.
- Atualizar/reconfirmar um SOS aberto não consome o orçamento de criação de novas emergências.
- Uma tentativa cria no máximo um SOS aberto.
- Nenhum usuário não autorizado vê coordenada.
- Escalada independe de cliente aberto.
- Aceitação pelo provedor de push, processamento/abertura pelo app receptor e resposta humana são estados distintos; um callback do dispositivo não prova que a pessoa leu, e nenhum contador de candidatos é apresentado como confirmação de recebimento.
- Logs têm request/SOS/device IDs e a transição terminal, sem coordenadas, tokens ou conteúdo privado.
- Existe kill switch remoto testado.

## 5. Gate de tracking

- [ ] 60+ minutos com tela bloqueada, rota conhecida e dois aparelhos.
- [ ] perda de rede e envio posterior em lote.
- [ ] pontos duplicados/reordenados.
- [ ] GPS impreciso/outlier/teleporte.
- [ ] parada prolongada e retomada.
- [ ] reboot/process death durante sessão.
- [ ] encerramento manual cessa indicador/serviço.
- [ ] expiração do downwind cessa coleta.
- [ ] consumo de bateria e aquecimento registrados.
- [ ] timestamp/accuracy/origem preservados.
- [ ] tela de apoio distingue atual, stale e sem sinal.
- [ ] retenção/purge/exportação verificados.

## 6. Gate de offline e sincronização

- [ ] shell abre sem rede.
- [ ] dados cacheados exibem idade e fonte.
- [ ] cache vazio não vira dado zero/falso.
- [ ] schema upgrade/downgrade não perde outbox crítica.
- [ ] outbox não duplica sessão, comentário, mensagem ou trilha.
- [ ] conflito server/client tem regra por entidade.
- [ ] logout apaga dados privados locais.
- [ ] troca de usuário não mistura caches.
- [ ] disk full/corrupção falha de forma recuperável.
- [ ] tiles offline só com licença e attribution aprovadas.

## 7. Segurança e privacidade

- [ ] threat model de conta, localização, SOS, chat e classificados.
- [ ] tokens somente em Keychain/Keystore; nenhum em logs/URL/analytics.
- [ ] TLS e configuração de rede padrão segura; pinning somente se houver plano de rotação/recuperação.
- [ ] permissões mínimas, contextuais e explicadas.
- [ ] rate limiting compartilhado, proteção de login e enumeração.
- [ ] uploads validam tipo real, tamanho, ownership e malware conforme risco.
- [ ] headers web/CSP/HSTS/anti-frame definidos sem quebrar mapas/fontes.
- [ ] SBOM/dependency scan e atualização de plugins.
- [ ] secrets fora do repo e separados por ambiente.
- [ ] conta de suporte/review sem privilégios excessivos.
- [ ] incident response para vazamento de posição/push indevido.

## 8. UGC e conta

- [ ] política e termos acessíveis antes de autenticar.
- [ ] denúncia disponível em perfil, post, comentário, chat/DM e anúncio.
- [ ] bloquear/mutar usuário e desfazer bloqueio.
- [ ] moderação remove conteúdo/conta e registra auditoria.
- [ ] exclusão de conta iniciada dentro do app.
- [ ] URL web de exclusão para Play.
- [ ] exportação de dados.
- [ ] retenção e exceções legais documentadas.
- [ ] suporte/contestação.
- [ ] resposta a abuso urgente.

## 9. Assets, UX de praia e lojas

- [ ] nome, bundle/application IDs definitivos.
- [ ] ícones iOS/Android em todas as escalas, adaptive/monochrome quando aplicável.
- [ ] splash nativa sem depender de vídeo/rede.
- [ ] screenshots por tamanho e textos em pt-BR.
- [ ] teste externo sob sol, movimento, uma mão e mão molhada: SOS alcançável, contraste legível e nenhuma informação crítica depende de texto de 9–11 px.
- [ ] alvos críticos têm pelo menos 44×44 pt no iOS e 48×48 dp no Android, com espaçamento contra toque acidental.
- [ ] hold/feedback/haptic do SOS funciona sob estresse e existe acesso direto no modo de navegação; o teste confirma que a proteção contra falso toque não impede pedido real.
- [ ] descrição não promete resgate garantido, precisão náutica oficial ou execução impossível após force-stop.
- [ ] privacy policy/support/marketing URLs HTTPS.
- [ ] Universal Links/Associated Domains e Android App Links verificados.
- [ ] permission strings/contextos revisados.
- [ ] orientação e safe areas em todos os aparelhos.
- [ ] acessibilidade: Dynamic Type/font scaling, contraste, VoiceOver/TalkBack, alvos de toque, reduced motion.

## 10. Apple — checklist de submissão

Os detalhes devem ser reconfirmados na documentação oficial no dia da submissão.

- [ ] Apple Developer e Agreements/Tax/Banking em ordem quando aplicável.
- [ ] App Store Connect, certificados/profiles e ownership documentados.
- [ ] App Privacy Details coerentes com código/SDKs.
- [ ] Privacy Manifest/Required Reason APIs revisados para SDKs incluídos.
- [ ] justificativas de localização foreground/background específicas.
- [ ] Background Modes somente para funções reais.
- [ ] conta demo e instruções para fluxo por convite/downwind/SOS sem emergência real.
- [ ] exclusão de conta dentro do app.
- [ ] UGC com denúncia/bloqueio/moderação.
- [ ] produto oferece funcionalidade nativa/offline suficiente, não é mero site embrulhado.
- [ ] nenhum uso de Critical Alerts alegado sem entitlement aprovado.

## 11. Google Play — checklist de submissão

Reconfirmar políticas e target API atuais no dia do envio.

- [ ] Play Console e verificação de conta concluídas.
- [ ] Android App Bundle assinado e Play App Signing configurado.
- [ ] target API exigida na data.
- [ ] Data Safety coerente com app/SDKs.
- [ ] formulário e evidência para background location, se exigidos.
- [ ] foreground service type/declarações e notificação persistente corretos.
- [ ] URL e fluxo de exclusão de conta.
- [ ] UGC/moderação/bloqueio.
- [ ] testers/trilhas exigidos para o tipo de conta vigente.
- [ ] pre-launch report sem blocker e testes manuais em fabricantes reais.

## 12. CI/CD e release

### Em todo pull request

- typecheck, unitários, contratos, SQL e build web;
- lint sem regressão em baseline;
- dependency/secret scan;
- testes dos pacotes afetados;
- Android debug build; iOS compile quando runner macOS disponível.

### Em release candidate

- migration dry-run e backup;
- E2E de smoke;
- builds assinados imutáveis;
- release notes, versão semântica + build number;
- artefatos/SBOM/sourcemaps protegidos;
- TestFlight e Play internal/closed;
- aprovação manual para produção.

### Rollout

- staged/phased rollout;
- kill switches por feature, plataforma e versão;
- minimum supported version apenas quando necessário;
- compatibilidade do backend com N-1;
- plano de rollback de DB forward-compatible (preferir expand/migrate/contract).

## 13. Observabilidade e alertas

### Sem dados sensíveis

Nunca enviar para logs/analytics:

- coordenadas ou trilha;
- mensagem/conteúdo de chat/SOS;
- tokens, cookies ou endpoints push completos;
- telefone/contato de emergência;
- senha, convite ou reset token.

### Alertas P0

- scheduler SOS atrasado;
- criação de SOS falhando acima do limiar;
- nenhum canal push configurado;
- taxa anormal de push rejeitado;
- API SOS p95/p99 acima do budget;
- migração/schema incompatível;
- crash loop no fluxo de tracking/SOS.

### Runbooks

- push indisponível;
- scheduler indisponível;
- banco degradado;
- provedor de clima/tiles indisponível;
- vazamento de localização;
- versão mobile defeituosa;
- chave/certificado comprometido;
- exclusão/solicitação de dados.

## 14. Critério final de go-live

O app só entra em rollout público quando:

1. zero P0 e P1 de segurança/SOS abertos;
2. SOS e tracking foram testados em aparelhos reais e cenários adversos;
3. políticas, denúncia, bloqueio e exclusão estão funcionais;
4. observabilidade e on-call detectam falhas sem depender de relato do usuário;
5. backend suporta a versão anterior durante rollback;
6. PWA continua operacional;
7. textos de produto refletem exatamente as garantias técnicas reais.
