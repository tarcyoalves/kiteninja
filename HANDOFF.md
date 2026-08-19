# Handoff — continuar amanhã

Data: 2026-08-19. Escrito para outro agente (ou eu mesmo) retomar sem perder contexto.

## TL;DR

Todo o código está commitado e correto em `main` e `master` (`eb30ce9`), testes verdes.
**O que falta é só PUBLICAR em produção** — hoje bloqueado pelo limite de 100 deploys/dia
do plano free da Vercel (`api-deployments-free-per-day`, "try again in 24 hours").

## Ação #1 (a primeira coisa a fazer amanhã): publicar

Assim que a cota de deploy resetar (~24h após 2026-08-19 ~23h, ou seja, a partir da noite
de 2026-08-20):

```bash
cd kiteninja
git commit --allow-empty -m "chore: redeploy fix teclado iOS"
git push origin master:main
```

Isso publica o commit `eb30ce9` (o código já está lá) em produção.

**IMPORTANTE — branch de deploy:** a Vercel publica PRODUÇÃO a partir do branch **`main`**,
não `master`. Os dois branches coexistem. Sempre empurrar para `main`
(`git push origin master:main` é fast-forward limpo hoje). Push só em `master` gera apenas Preview.

Depois confirmar:

```bash
npx vercel ls | grep -i production   # o deploy novo tem que ficar ● Ready
```

Se der o erro de limite de novo, a cota ainda não resetou — esperar mais.

## Ação #2: validar no iPhone

O bug NÃO é verificável no preview desktop (não abre teclado virtual real). Precisa testar
em iPhone Safari, logado, na tela de Chat:

- Tocar na caixa de texto → o campo deve subir junto com o teclado, **sem** vão embaixo e
  **sem** o campo saltar para o topo da tela.
- Recolher o teclado → não pode sobrar faixa morta no rodapé.
- Como é PWA, **fechar e reabrir o app** (ou recarregar no Safari) para furar o cache do
  service worker e pegar a versão nova.

URL de Preview que já buildou o commit certo (dá pra testar ANTES de promover):
`https://kiteninja-85b87l39o-tarcyoalves-projects.vercel.app`

## O que foi feito nesta sessão (2026-08-18/19)

1. **SOS movido para o menu do avatar** (commit `debd08f`). O botão SOS flutuante cobria a
   área de envio do chat. Removido `components/SosButton.tsx`; gatilho agora vive na seção
   "Segurança & Emergência" do `SidebarDrawer`, com press-and-hold de 800ms. Lógica extraída
   para `lib/useSosHold.ts`.

2. **Feed: menu flutuante cobria "Publicar Relato"** (commit `ab3fe5c`). O FAB usava
   `bottom-20` fixo, ignorando a safe-area do iPhone. Passou a usar `--nav-h` + safe-area via
   classe `.publish-fab-bottom` no `globals.css`; folga do fim do feed vira `.feed-pad-bottom`.

3. **Chat: layout deslocava ao abrir o teclado no iOS** (commit `eb30ce9`) — ESTE é o fix
   principal que precisa ir pra produção. Ver seção abaixo.

## Detalhe técnico do fix do teclado (commit eb30ce9)

**Causa raiz:** `.app-shell` é `position: fixed; height: 100dvh`. No iOS Safari o `dvh` NÃO
encolhe quando o teclado abre, e `interactive-widget=resizes-content` é ignorado. O shell
mantinha altura cheia atrás do teclado; o iOS rolava a viewport de layout para revelar o input
e a tela inteira deslocava (campo no topo, vão embaixo). Duas tentativas anteriores mexeram só
em padding e não resolveram — a origem era o shell não saber que a área visível encolheu.

**Correção:**
- `lib/useVisualViewportShell.ts` (novo): lê a VisualViewport API (suportada no iOS) e publica
  `--app-height` e `--app-offset-top` em `document.documentElement`. Chamado no `MainContent`
  de `app/page.tsx`.
- `.app-shell` (em `app/globals.css`) agora usa `top: var(--app-offset-top,0px)` e
  `height: var(--app-height, 100dvh)` — ocupa exatamente a área visível, colado nela,
  cancelando o deslocamento do iOS. `dvh` fica como fallback.
- `views/ChatView.tsx`: removido o hack de `paddingBottom = keyboardHeight` (causaria dupla
  contagem agora). O composer só alterna a folga inferior via hook `useKeyboardVisible`
  (`lib/useKeyboardVisible.ts`), e o efeito de viewport só mantém o scroll no fim.

## Verificação (sempre rodar antes de commitar)

```bash
npx tsc --noEmit      # deve passar limpo
npx vitest run        # 343 testes, todos passando
```

## Convenções do projeto que importam aqui

- Classes arbitrárias do Tailwind com `env()`/`calc()` quebram o parser de JSX — por isso o
  cálculo mora em classes no `globals.css` (ex.: `.publish-fab-bottom`, `.pb-above-nav`).
- Neon: só template-tag parametrizado (`` sql`...` ``), nunca `sql(...)` como função.
- Nunca colar token/PAT no chat; usar `gh` autenticado. Segredos só em `.env.local`, nunca
  sob `NEXT_PUBLIC_`.
