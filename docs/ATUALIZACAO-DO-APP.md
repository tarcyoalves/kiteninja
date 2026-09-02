# Como o app se atualiza

O KiteNinja Android é um wrapper Capacitor com `server.url` apontando para
`https://kiteninja.vercel.app`. **O APK carrega o site remoto** — mudança de
código web ou de backend chega sem gerar APK novo.

Só precisa de APK novo quando muda: código nativo em `android/` (o Foreground
Service de rastreio, plugins do Capacitor), o `capacitor.config.ts`,
permissões no `AndroidManifest`, ou a versão do Capacitor.

---

## O que já funcionava

A **detecção** estava correta, e foi conferida em produção:

- `next.config.ts` injeta `NEXT_PUBLIC_BUILD_COMMIT` no bundle;
- `/api/version` devolve o commit do deploy;
- o banner compara os dois a cada 60 s, ao voltar do segundo plano e no foco.

Os dois SHAs foram lidos do ar e batem, então a comparação funciona.

O transporte também: o HTML sai com `must-revalidate` + ETag (revalida sempre)
e os chunks do Next têm hash no nome, então HTML novo puxa chunks novos.

---

## Os quatro defeitos que existiam

### 1. Só avisava — nunca atualizava sozinho

Quem ignorasse o popup ficava na versão antiga por tempo indefinido. Pior:
fechar no **X** grava o commit dispensado em `localStorage`, e aquele aviso
**não volta**.

Quando a versão nova conserta um SOS que não escala ou um downwind que não
registra, *"o usuário decide quando atualizar"* é o mesmo que *"não
atualiza"*.

### 2. Não dava para saber se tinha funcionado

O fluxo recarregava e torcia. Se o WebView entregasse a versão antiga assim
mesmo, o aviso voltava em 60 s, a pessoa tocava de novo, e nada dizia que a
atualização não estava pegando. Um laço silencioso.

### 3. O aviso sumia mesmo quando a atualização não acontecia

`clearAppUpdateAvailable()` rodava **antes** do `location.replace`. Se a
navegação não acontecesse — WebView engasgado, aba suspensa no meio — o aviso
sumia e o app continuava velho, sem sinal nenhum.

### 4. `?__app_update=…` ficava na barra de endereço

O parâmetro existe para furar o cache do WebView **naquele carregamento**.
Deixá-lo na URL o faz viajar em todo link compartilhado — e este app
compartilha links: o convite de downwind é `/?dw_invite=…`.

---

## Como ficou

### Atualiza sozinho, quando é seguro

`podeAtualizarSozinho` (puro e testado) exige **quatro** condições:

| Condição | Por quê |
|---|---|
| sem downwind ativo | recarregar mata o `watchPosition` e a trilha em memória — apagaria a travessia de quem está na água |
| sem SOS ativo | nada justifica mexer na tela de socorro |
| sem modal/formulário aberto | o recarregamento apagaria o que foi digitado |
| **app escondido** | recarregar na frente do usuário faria o app "piscar" sem motivo |

O gatilho é a mudança de visibilidade. Na prática: **o app vai para o segundo
plano e, quando a pessoa volta, já está na versão nova** — sem popup, sem
toque, sem interromper nada.

A regra é deliberadamente conservadora. Ficar uma versão atrás é muito melhor
que recarregar no meio de um velejo ou de um socorro.

Quando alguma condição impede, o banner continua aparecendo como antes — o
caminho manual não foi removido.

### Confirma o resultado

`resultadoDaAtualizacao` lê o `__app_update` da URL e compara com o SHA do
bundle carregado. Três respostas: `nao-tentou`, `funcionou`, `falhou`.

Quando falha, em vez de repetir o mesmo botão, o app diz o que resolve:

> **Não foi possível atualizar** — Feche o app completamente e abra de novo
> para carregar a versão nova.

### Não mente mais sobre ter atualizado

`applyAppUpdate` não limpa o estado antes de navegar. Como o recarregamento
descarta tudo de qualquer forma, ele é o único jeito de o aviso sumir — e se o
app não recarregou, o aviso continua lá, que é a verdade.

### Limpa a própria sujeira

`limparParametroDeAtualizacao` tira o `__app_update` da URL com
`replaceState`, depois que ele cumpriu o papel, sem recarregar nada.

---

## Uma armadilha encontrada na própria correção

A checagem de "a atualização anterior falhou?" depende de
`window.location.search`, que **não existe no servidor**. A primeira versão
usava um inicializador de `useState` — e inicializador roda também no SSR,
devolvendo `false` lá contra `true` aqui: **divergência de hidratação**.

Corrigido com `useSyncExternalStore` e snapshot de servidor explicitamente
`false`, o mesmo padrão de `lib/usePrefereMenosMovimento.ts`. É a terceira vez
que "valor que só existe no cliente" aparece nesta base — está no
`docs/REACT19-REGRAS-COMPILADOR.md`.

---

## Para o próximo agente

Se for mexer aqui, a pergunta que guia é: **o que se perde se a página
recarregar agora?** Toda condição de `podeAtualizarSozinho` é a resposta para
um caso concreto de perda. Adicionar estado novo que não sobrevive a um
reload significa adicionar uma condição ali também.
