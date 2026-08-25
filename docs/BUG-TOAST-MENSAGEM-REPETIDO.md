# Bug — popup de mensagem reaparecia sem parar

Relato do dono (25/08/2026): *"um usuário mandou mensagem, e fica direto
aparecendo o popup, mesmo eu já tendo visto a msg, fica bugado."*

Corrigido. Documentado aqui porque a causa é um padrão que se repete em React
e é fácil de reintroduzir sem perceber.

## Sintoma

Uma mensagem chegava no chat geral, o toast aparecia (correto), sumia após
5,5s (correto) — e depois **voltava a aparecer**, com a mesma mensagem já
lida, várias vezes. Quanto mais o usuário navegava pelo app, mais o popup
reaparecia. Só parava ao abrir a aba de chat ou fechar no X.

## Causa

Duas coisas somadas em `components/InAppPushToast.tsx`:

**1. O auto-hide não consumia o evento.** O `setTimeout` de 5,5s mexia só no
estado local `visible`. O `latestIncomingMessage` continuava preenchido no
`KiteDataContext` — do ponto de vista do contexto, a mensagem seguia sendo "a
mais recente ainda não tratada", indefinidamente.

**2. O efeito dependia de `activeTab`.**

```tsx
}, [latestIncomingMessage, activeTab]);   // ← activeTab aqui era o gatilho
```

Toda troca de aba mudava `activeTab`, o efeito reexecutava, encontrava
`latestIncomingMessage` ainda preenchido e chamava `setVisible(true)` de novo.

Nenhuma das duas causava o bug sozinha: se o efeito não reexecutasse, a
mensagem pendurada no contexto não faria mal; se o auto-hide limpasse a
mensagem, a reexecução não teria o que exibir. O bug era a soma — e é por isso
que ele parecia intermitente, aparecendo "do nada": na verdade aparecia a cada
navegação entre abas.

## Correção

1. **`activeTab` saiu das dependências.** Esconder o toast quando o usuário
   está no chat é trabalho da guarda de render (`if (... || activeTab ===
   'chat') return null`), que já existia. Não precisava — nem devia — ser
   dependência do efeito que controla o ciclo de vida do toast.
2. **Cada mensagem passa a ser exibida no máximo uma vez**, rastreada pelo
   `id` num `useRef`. A regra virou função pura em `lib/toastMensagem.ts`
   (`deveExibirToastMensagem`), testada em `lib/toastMensagem.test.ts`.

Efeito colateral bom: o toast agora dura os 5,5s inteiros mesmo se a pessoa
trocar de aba no meio. Antes, cada troca reiniciava a contagem.

## Por que a identidade é por `id` e nunca por texto

Duas mensagens com o mesmo conteúdo ("bora?" mandado duas vezes) são dois
avisos legítimos e os dois devem aparecer. Comparar texto engoliria o segundo
— trocaria um bug barulhento por um silencioso, que é sempre o pior negócio.
Há teste cobrindo exatamente esse caso.

## O padrão a não repetir

Um efeito que **reage** a um evento vindo de contexto precisa **consumir** o
evento — limpando a origem ou marcando o que já foi tratado. Caso contrário,
qualquer dependência que mude por outro motivo (aba, tema, tamanho de janela)
reexecuta o efeito e reprocessa um evento antigo como se fosse novo.

Vale para toast, som de notificação, vibração, analytics: qualquer coisa que
deva acontecer **uma vez por evento**, e não uma vez por render.

## Nota sobre DMs

`latestIncomingDm` existe no `KiteDataContext` e é populado pelo watcher de
DMs, mas **nenhum componente o consome hoje** — DM só alimenta o badge, não
tem toast. Se algum dia um toast de DM for criado, ele precisa nascer com a
mesma trava de "exibe uma vez por `id`", senão reintroduz este mesmo bug.
