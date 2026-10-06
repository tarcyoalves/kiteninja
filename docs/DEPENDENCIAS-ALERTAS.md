# Alertas de dependências (`npm audit`)

Registro do que o `npm audit --omit=dev` ainda acusa, por que não foi
corrigido e qual a exposição real. Medido em 06/10/2026 (tarefa T06).

| | Críticas | Altas | Moderadas | Total |
|---|---|---|---|---|
| Antes (partida de 06/10) | 1 | 4 | 6 | 11 |
| Depois | 1 | 0 | 2 | 3 |

Alertas altas resolvidos sem `--force`, dentro das faixas já declaradas
(commit `afb16b9`): `@grpc/grpc-js` 1.14.5, `undici` 6.29.0,
`brace-expansion` 2.1.7, `source-map-js` 1.2.2. `firebase-admin` 14.3.0 ->
14.5.0 (commit `5213fec`, mesma versão principal) removeu o resto da cadeia
`@google-cloud/storage` / `teeny-request` / `retry-request`.

O `sharp` (alta no plano de 05/10) não aparece mais: o `next` 16.3.8 traz
`sharp` 0.35.5, que já não é acusado.

Nota de ferramenta: o npm 10.9.7 do contêiner quebra no `npm audit fix`
(`Cannot read properties of null (reading 'edgesOut')`). Use o npm 11.17.0 do
`packageManager` (`npx npm@11.17.0 audit fix`). O `npm ci` com npm 10 lê o
lock gerado pelo 11 sem problema.

## Pendente 1 — `@capacitor/android` 8.5.0 (CRÍTICA) — decisão do dono

- **Advisory:** GHSA-rvm3-566m-v7fv (CVSS 9.3). Afeta `>=8.5.0 <8.5.1`; corrigido
  em 8.5.1. O guarda de navegação do WebView olhava host e esquema, mas não o
  caminho; o caminho interno `/_capacitor_http_interceptor_` fica na origem do
  app, então um link malicioso clicado dentro do app faz a camada nativa buscar
  uma URL arbitrária e devolve a resposta na origem do app, com acesso a
  `localStorage`, cookies e plugins nativos. Vale mesmo sem o plugin
  `CapacitorHttp` ligado.
- **Por onde chega:** dependência direta (`package.json`, pin exato `8.5.0`).
  O projeto Android (`android/capacitor.settings.gradle`) compila a partir de
  `node_modules/@capacitor/android`, então a falha vai dentro do APK.
- **Alcançável?** Só no app Android (APK), não no site nem no servidor. O
  `capacitor.config.ts` carrega `https://kiteninja.vercel.app` no WebView, e o
  app mostra conteúdo de usuário (chat, comentários, feed) — a condição do
  advisory (link clicável de conteúdo de usuário) existe em tese. Corrigir
  exige gerar e publicar um novo APK; a correção no `package.json` sozinha não
  protege quem já tem o app instalado.
- **Por que não foi corrigido aqui:** o conserto é um patch
  (`@capacitor/android`, `@capacitor/core`, `@capacitor/cli` para 8.5.2, mesma
  versão principal, `npm audit` indica `isSemVerMajor: false`), mas mexe na
  camada nativa Android e o ambiente do agente não consegue compilar nem testar
  o APK (o job Android do CI também está vermelho, T02). A tentativa de
  `npm install` foi negada pelo controle de permissões da sessão; por regra,
  não insisti por outro caminho. **Ação sugerida ao dono:** autorizar o bump
  (`npm install --save-exact @capacitor/android@8.5.2 @capacitor/core@8.5.2
  @capacitor/cli@8.5.2` com npm 11), rodar a verificação 0.4, conferir que o
  job Android do CI compila e publicar um novo APK.

## Pendente 2 — `uuid` 9.0.1 e `gaxios` 6.7.1 (moderadas)

- **Advisory:** GHSA-w5hq-g745-h8pq — falta de checagem de limite no buffer
  dos geradores v3/v5/v6 do `uuid` quando o chamador passa `buf`.
- **Por onde chega:** `firebase-admin` -> `@google-cloud/storage` 8.2.0 ->
  `gaxios` 6.7.1 -> `uuid` 9.0.1 (pin interno do `gaxios` 6.x). Existe ainda
  `uuid` 7.0.3 em `@capacitor/cli` -> `xcode` (só ferramenta de build, sem
  alerta no `--omit=dev`).
- **Alcançável?** Não. `gaxios` só usa `uuid.v4()` sem buffer
  (`node_modules/gaxios/build/src/gaxios.js`, geração do `boundary` de
  multipart) — o caminho vulnerável (v3/v5/v6 com `buf`) não é chamado. Além
  disso, `@google-cloud/storage` só é carregado por `firebase-admin/storage`, e
  o app só importa `firebase-admin/app` e `firebase-admin/messaging`
  (`lib/push.ts`).
- **Por que não foi corrigido:** `npm audit fix` não o resolve (o `gaxios` 6.x
  fixa `uuid` 9) e a saída que sobra é um `overrides` forçando `uuid` 11+ dentro
  de um pacote que declara `^9`. Risco de quebra sem ganho de segurança, dado
  que o caminho não é alcançado. Revisar quando o `firebase-admin` sair da
  cadeia `@google-cloud/storage` 8.x ou ela atualizar o `gaxios`.
