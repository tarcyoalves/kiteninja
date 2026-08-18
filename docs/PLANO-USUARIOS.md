# Plano de Arquitetura e Engenharia de Usuários — KiteNinja

**Documento de especificação e design de sistema para ciclo de vida, identidade, segurança, autorização, conformidade e governança de contas.**

---

## 1. Visão Geral e Filosofia do Produto

O **KiteNinja** é uma plataforma exclusiva e mobile-first, fechada por convite, focada em velejadores de kitesurf. Diferente de redes sociais abertas ou apps genéricos de previsão, o KiteNinja combina:
1. **Condições hiperlocais em tempo real:** Vento, rajadas, ondas e marés para a tomada de decisão rápida na praia.
2. **Comunidade e Segurança:** Alertas de perigo (redes, pedras, resgates), feed de sessões compartilhadas, presença no spot e chat ao vivo.
3. **Classificados Fechados (Marketplace):** Negociação confiável de equipamentos entre membros verificados.

Por ser um ecossistema com acesso controlado por convites e com dados reais de velejadores (peso, localização, sessões, fotos e contatos), o sistema de usuários precisa ser robusto, seguro, auditável e em conformidade com as melhores práticas de segurança e LGPD.

---

## 2. Ciclo de Vida da Conta

### 2.1. Criação e Onboarding por Convite (Exclusividade)
- **Regra:** Não existe auto-cadastro público. Apenas usuários que recebem um convite ativo gerado por um administrador podem criar conta.
- **Mecanismo de Segurança:**
  - O convite possui um `token` criptográfico de 256 bits gerado aleatoriamente (`randomBytes(32)` em `base64url`).
  - O banco de dados armazena apenas o `token_hash` (SHA-256) e a data de expiração (`expires_at` padrão de 7 dias).
  - O consumo é atômico via `UPDATE invites SET used_at = NOW(), used_by = $userId WHERE id = $inviteId AND used_at IS NULL AND revoked_at IS NULL RETURNING id;`. Isso resolve qualquer concorrência ou tentativa de uso duplo diretamente no banco de dados.

### 2.2. Recuperação de Senha
- **Problema atual:** Usuários sem acesso à senha dependiam de reset manual direto no banco de dados.
- **Arquitetura de Recuperação:**
  - Tabela `password_reset_tokens`:
    - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
    - `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
    - `token_hash TEXT NOT NULL UNIQUE` (SHA-256 do token)
    - `expires_at TIMESTAMPTZ NOT NULL` (tempo de vida: 2 horas)
    - `used_at TIMESTAMPTZ`
    - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  - O link de recuperação `https://kiteninja.vercel.app/recuperar-senha/[token]` envia o token em claro por e-mail (ou exibido em modo seguro para o admin em homologação).
  - O consumo do token valida se `used_at IS NULL AND expires_at > NOW()`, atualiza a senha com `bcryptjs` (12 rounds), invalida o token e **encerra todas as sessões ativas do usuário** (`DELETE FROM auth_sessions WHERE user_id = $userId`).

### 2.3. Verificação e Troca de E-mail
- **Troca Segura com Confirmação:**
  - Para alterar o e-mail, o usuário solicita a troca informando o novo e-mail e sua senha atual.
  - O sistema gera um token de confirmação enviado para o novo e-mail e uma notificação de segurança para o e-mail antigo.
  - A troca só se efetiva após a validação do token do novo endereço.

### 2.4. Desativação (Soft Delete) vs. Exclusão LGPD (Direito ao Esquecimento)
- **Soft Delete (Desativação Temporária):**
  - Coluna `is_active BOOLEAN NOT NULL DEFAULT TRUE` e `deactivated_at TIMESTAMPTZ` em `users`.
  - Usuários desativados têm suas sessões revogadas imediatamente e são bloqueados no login.
  - Anúncios no marketplace ficam marcados como 'Removido'.
- **Exclusão Definitiva (LGPD):**
  - **Decisão Arquitetural sobre Conteúdo Comunitário:**
    - Se um velejador excluir sua conta, alertas de segurança e histórico de conversas/posts comunitários não devem corromper o feed com links quebrados ou sumir com alertas de perigo ativos.
    - O sistema altera a chave estrangeira em posts, comentários e alertas para `user_id = NULL` (ou associa a um usuário sentinela do sistema "Velejador Anônimo"), enquanto dados estritamente pessoais (peso, sessões de navegação privadas, sessões de autenticação, favoritos, quiver e e-mail) são deletados em definitivo.
- **Exportação de Dados (Portabilidade LGPD):**
  - Rota `/api/profile/export` que retorna um pacote JSON com todos os dados associados ao usuário (perfil, logs de sessões, posts criados, anúncios e favoritos).

---

## 3. Identidade, Perfil e Quiver

### 3.1. Avatar e Gestão de Imagens
- **Diagnóstico do Bug de "Alterar Foto":**
  - A conversão de imagens de alta resolução de câmeras de celular (iPhone/Android) gerava data URLs pesadas (> 1.5MB), estourando o limite de payload de requisição JSON ou falhando na decodificação de imagens HEIC/HEIF nativas do iOS sem conversão de canvas.
  - Armazenar data URLs base64 diretamente na coluna `avatar_url TEXT` inchava as tabelas do PostgreSQL e aumentava desnecessariamente a largura de banda em queries relacionais.
- **Solução Arquitetural:**
  - **Compressão Otimizada no Cliente:** Canvas redimensionado para 256x256 ou 320x320 com qualidade 0.75 WebP/JPEG, garantindo payload leve (< 50KB).
  - **Tratamento de Mimetypes:** Aceitar `image/*` e formatos comuns de smartphone.
  - **Armazenamento:** Suporte nativo a Vercel Blob (`@vercel/blob`) para URLs públicas diretas e CDN, mantendo compatibilidade com data URLs compactas quando Blob não estiver configurado.

### 3.2. Quiver e Equipamento
- Estruturação de campos para cálculo preciso de tamanho de pipa e recomendação na praia:
  - `quiver_kites NUMERIC(3,1)[]` (ex: `[7.0, 9.0, 12.0]`)
  - `quiver_boards TEXT[]` (ex: `['Twintip 136x41', 'Strapless 5\'2"']`)
  - `preferred_wind_unit TEXT DEFAULT 'knots' CHECK (preferred_wind_unit IN ('knots', 'kmh', 'mph', 'ms'))`
  - `preferred_temp_unit TEXT DEFAULT 'celsius'`

### 3.3. Unicidade e Geração de `rider_id`
- Cada velejador possui um identificador público amigável (ex.: `0042`, `rider_bra_12`).
- Geração automática sequencial formatada com 4 dígitos padronizados (`LPAD(NEXTVAL('rider_id_seq')::text, 4, '0')`), com unicidade garantida no banco de dados.

---

## 4. Papéis e Matriz de Permissões (RBAC Centralizado)

Toda a lógica de autorização é centralizada no módulo `lib/authz.ts` e coberta por testes automatizados em `lib/authz.test.ts`.

### 4.1. Papéis Suportados
1. **`admin`:** Controle total do sistema, emissão e revogação de convites, gerenciamento de papéis, suspensão de usuários, moderação global de conteúdo, exclusão forçada e visualização de métricas de auditoria.
2. **`moderator`:** Moderação de alertas de segurança, remoção de posts ofensivos, moderação do marketplace e resposta a denúncias de usuários.
3. **`instructor` / `escola`:** Perfil verificado de instrutor ou escola credenciada, com permissão para criar eventos oficiais e suporte no spot.
4. **`rider`:** Velejador padrão com acesso ao feed, previsão, histórico de sessões, chat, favoritos e marketplace.

### 4.2. Matriz de Autorização

| Recurso / Ação | Rider Comum | Instrutor / Escola | Moderador | Administrador |
| :--- | :---: | :---: | :---: | :---: |
| **Acessar Condições / Spots** | ✅ | ✅ | ✅ | ✅ |
| **Criar / Editar Próprias Sessões** | ✅ (próprio `user_id`) | ✅ (próprio `user_id`) | ✅ (próprio `user_id`) | ✅ |
| **Publicar no Feed / Comentar** | ✅ | ✅ | ✅ | ✅ |
| **Apagar Próprio Post / Comentário** | ✅ | ✅ | ✅ | ✅ |
| **Apagar Post / Comentário de Terceiros** | ❌ | ❌ | ✅ | ✅ |
| **Criar Alerta de Segurança** | ✅ | ✅ | ✅ | ✅ |
| **Resolver / Editar Alerta de Segurança** | ❌ | ❌ | ✅ | ✅ |
| **Criar Anúncio no Marketplace** | ✅ | ✅ | ✅ | ✅ |
| **Criar Evento Oficial** | ❌ | ✅ | ✅ | ✅ |
| **Gerar Convites de Acesso** | ❌ | ❌ | ❌ | ✅ |
| **Suspender / Promover Usuários** | ❌ | ❌ | ❌ | ✅ |
| **Auditoria e Métricas de Segurança** | ❌ | ❌ | ❌ | ✅ |

---

## 5. Segurança Avançada e Sessões

### 5.1. Rate Limiting e Prevenção de Força Bruta
- **Vulnerabilidade Prevenida:** Tentativas automatizadas de login por força bruta, adivinhação de tokens de convite e spam em rotas de recuperação.
- **Implementação:**
  - Mecanismo de Sliding Window in-memory (ou chave distribuída) com bloqueio progressivo:
    - Login: máx 5 tentativas por IP / e-mail a cada 15 minutos. Após 5 falhas, lockout progressivo de 15 minutos com status 429 Too Many Requests.
    - Aceite / Validação de Convite: máx 10 tentativas por IP por hora.
    - Recuperação de Senha: máx 3 solicitações por e-mail por hora.

### 5.2. Gestão Granular de Sessões
- Tabela `auth_sessions`:
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
  - `token_hash TEXT NOT NULL UNIQUE` (SHA-256)
  - `user_agent TEXT`
  - `ip_address TEXT`
  - `last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  - `expires_at TIMESTAMPTZ NOT NULL`
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- **Funcionalidades:**
  - Listar todos os dispositivos e navegadores conectados.
  - Revogar sessão específica individualmente.
  - Revogar todas as outras sessões (botão "Desconectar de todos os outros aparelhos").
  - **Invalidação Obrigatória na Troca de Senha:** Ao alterar a senha ou recuperar acesso, todas as sessões anteriores são destruídas no banco.

### 5.3. Rotação de Cookie de Sessão no Login
- Para mitigar ataques de *Session Fixation*, a emissão de nova sessão sempre invalida qualquer token anterior presente no cliente e gera um identificador único de 256 bits com atributos `HttpOnly`, `Secure`, `SameSite=Lax` e caminho restrito `/`.

### 5.4. Log de Auditoria de Ações Administrativas
- Tabela `audit_logs`:
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `actor_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL`
  - `action TEXT NOT NULL` (ex: `INVITE_CREATED`, `INVITE_REVOKED`, `USER_SUSPENDED`, `ROLE_CHANGED`, `ALERT_RESOLVED`)
  - `target_type TEXT NOT NULL` (ex: `user`, `invite`, `alert`, `listing`)
  - `target_id TEXT`
  - `metadata JSONB`
  - `ip_address TEXT`
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

---

## 6. Painel Administrativo e Moderação

1. **Gestão de Velejadores (`/admin/users`):**
   - Busca por nome, e-mail ou `rider_id`.
   - Filtros por papel (`rider`, `admin`, `moderator`, `instructor`) e status (`ativo`, `suspenso`).
   - Paginação eficiente no banco via `LIMIT` e `OFFSET`.
   - Ações: suspender/reativar, alterar papel, forçar redefinição de senha no próximo acesso.
2. **Gestão de Convites (`/admin/invites`):**
   - Criação com notas descritivas e e-mail de destino opcional.
   - Listagem de convites pendentes, utilizados e revogados.
   - Revogação imediata de links não utilizados.
3. **Fila de Moderação e Denúncias (`/admin/moderation`):**
   - Tabela `content_reports` para denúncias de posts, anúncios de marketplace ou mensagens indevidas de chat.
   - Resolução ou exclusão direta por administradores e moderadores.

---

## 7. Schema de Notificações (Planejado)

Para permitir que o velejador seja avisado quando o vento atingir a condição ideal no seu home spot:
- Tabela `notification_preferences`:
  - `user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE`
  - `wind_alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE`
  - `wind_min_knots NUMERIC(4,1) NOT NULL DEFAULT 18.0` (regra de 18 nós ou mais)
  - `favorite_spots_only BOOLEAN NOT NULL DEFAULT TRUE`
  - `community_replies_enabled BOOLEAN NOT NULL DEFAULT TRUE`
  - `safety_alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE`
  - `event_reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE`
  - `channel_push BOOLEAN NOT NULL DEFAULT TRUE`
  - `channel_email BOOLEAN NOT NULL DEFAULT FALSE`

---

## 8. Roteiro de Entrega e Verificação

1. **Fase 1:** Criação das tabelas e índices em `lib/schema.sql` (100% idempotente com `CREATE TABLE IF NOT EXISTS`).
2. **Fase 2:** Centralização das regras de autorização em `lib/authz.ts` e extensão dos testes de segurança em `lib/authz.test.ts`.
3. **Fase 3:** Implementação dos serviços de Rate Limiting (`lib/rateLimit.ts`) e auditoria (`lib/audit.ts`).
4. **Fase 4:** Rotas de API de autenticação e perfil com validações estritas (`/api/auth/recover-password`, `/api/auth/reset-password`, `/api/profile/sessions`).
5. **Fase 5:** Validação contínua com `scripts/verify-sql.ts`, `vitest run`, `tsc --noEmit` e `npm run build`.
