# Diário de progresso

Registro cronológico de **tudo** que foi feito no KiteNinja — por pessoa ou por
agente. Regra do dono: *"sempre coloque no histórico de progresso ou diário"*.

## Como registrar

- **Toda sessão de trabalho termina com uma entrada aqui.** Sem entrada, o
  trabalho não está terminado.
- Agente trabalhando em paralelo **não edita este arquivo** (três agentes
  escrevendo no fim do mesmo arquivo geram conflito na junção). Ele cria
  `docs/diario/AAAA-MM-DD-<tarefa>.md` com o modelo abaixo, e quem junta o
  trabalho resume aqui com o link.
- Escreva o que um leitor sem contexto precisa: o que mudou, por quê, como foi
  verificado, o que ficou pendente. Commit sempre citado pelo hash.

### Modelo de entrada

```markdown
## AAAA-MM-DD — <título curto>
**Quem:** <pessoa ou agente/modelo> · **Tarefa:** <ID do plano, se houver>
**Commits:** `abc1234`, …

- O que mudou e por quê (a evidência que motivou).
- Como foi verificado (testes, contraprova, comandos).
- Impacto nos planos gratuitos (Neon / Vercel / GitHub), se houver.
- Pendências e decisões que ficaram para o dono.
```

---

## 2026-10-05 — Auditoria completa, senha, painel admin, segurança
**Quem:** Claude (Opus, orquestrador) · **Tarefa:** pedido do dono
**Commits:** `671e52e`, `5ec6998`, `34344ed`, `89a91b7`

- **Redefinição de senha "não prestou":** cinco defeitos, provados rodando as
  rotas reais contra PGlite — o "Esqueci minha senha" matava o link do admin,
  login seguia bloqueado após redefinir, o limitador contava login correto, a
  tela dizia 6 caracteres e o servidor 10, e o link nascia fora da tela no
  celular. Ver `docs/REDEFINIR-SENHA-NAO-PRESTOU.md`.
- **Segurança:** Next 16.3.1 → 16.3.8 (três alertas críticos de RCE). Críticas
  1 → 0 no `npm audit`.
- **Painel admin:** as 10 rotas testadas contra Postgres como admin, velejador e
  anônimo. Conta suspensa não entra mais; id inválido dá 400 e não 500.
- **Ferramenta nova:** `test/rotasComPglite.ts` — rotas reais contra Postgres em
  memória, com cookie de sessão.
- **Plano:** `docs/PLANO-AGENTES-2026-10.md`, 17 tarefas.
- **Verificação:** 1138 testes, contraprova de cada teste novo, tsc, eslint 0
  erros, verify-sql 319/0, verify-sos 59/0, build exit 0. CI verde em tudo
  exceto o job Android (T02 — ambiente, não código).
- **Pendente com o dono:** T03 (apagar projeto Vercel `kiteninja1`), T16
  (domínio), T08 (conta de e-mail), T11 (decisão de desenho do downwind).
