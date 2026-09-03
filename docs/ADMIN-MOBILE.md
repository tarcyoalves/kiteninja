# Painel admin no celular — o que estava solto e por quê

Relato do dono: *"Está meio solta com scrolls laterais"*.

Eram dois sintomas com causas diferentes, e ambos foram **medidos** antes de
corrigidos (ver `scripts/medir-overflow.mjs`).

## Medição, não palpite

Nenhuma verificação do projeto enxerga layout: `tsc`, `eslint`, os 936 testes e
as 295 checagens de SQL não renderizam nada, e o Vitest roda em
`environment: 'node'`, sem DOM. Layout quebrado atravessa o pipeline inteiro
verde — foi exatamente o que aconteceu.

O script abre o painel real num Chromium a 390px, com dados adversariais, e
mede `scrollWidth > clientWidth` em cada aba. Antes da correção:

```
VAZA  Convites        scroll=474/390
        BUTTON right=474 :: px-3.5 py-2 rounded-xl text-xs font-black flex items-center gap-1.5
VAZA  Monitoramento   scroll=541/390
VAZA  Abertura        scroll=474/390
VAZA  Chamados        scroll=510/390
```

Depois: `390/390` nas quatro.

## Causa 1 — a barra de abas (o principal)

Quatro botões com ícone e rótulo num `flex` sem quebra. "Monitoramento"
sozinho passa de 110px; os quatro somam **474px** numa tela de 390. Item de
flex não encolhe abaixo do próprio conteúdo, então a barra empurrava a página
inteira e o painel deslizava de lado — em **todas** as abas, porque o
cabeçalho é comum.

Virou grade 2x2 no celular, fileira única a partir de `sm`. Grade em vez de
tira rolável de propósito: com quatro abas, rolagem horizontal esconderia
metade delas atrás de um gesto que ninguém adivinha.

## Causa 2 — texto do usuário sem quebra

Um chamado é escrito por quem está reportando um bug: vem com URL colada,
caminho de rota, trecho de log. Nada disso tem espaço para quebrar.
`whitespace-pre-wrap` preserva as quebras digitadas, mas **não quebra dentro de
uma palavra que nunca teve espaço**. Faltava `break-words` no título, na
descrição e no campo "Tela".

Mesma família: e-mail em `font-mono` no Monitoramento (`flex-wrap` quebra
ENTRE itens, nunca dentro de um) e nome de arquivo de vídeo na Abertura.

## Causa 3 — larguras divergentes entre abas ("meio solta")

Convites era `max-w-md` (448px), Chamados `max-w-2xl` (672px) e Monitoramento
ia até o fim do container de 896px. Trocar de aba fazia o conteúdo pular de
largura dentro do mesmo painel — a sensação de "solto".

Agora as três ocupam a mesma coluna. Só o formulário de convite (dois campos)
mantém largura máxima própria, para os inputs não esticarem 900px no desktop.

## Outros ajustes da mesma varredura

- **Cabeçalho**: nome de admin comprido empurrava a linha inteira (`min-w-0` +
  `truncate`), e "Voltar ao app" quebrava em duas linhas (`whitespace-nowrap`).
- **Abertura**: o cabeçalho "Adicionar Novo Vídeo" com os dois botões
  (`Upload (até 50MB)` e `Link / URL Direta`) num `justify-between` sem quebra.
  Agora quebram e dividem a largura no celular; idem Rodízio/Aleatório.
- **Convites**: revogar não pedia confirmação. O botão é uma lixeira de 36px ao
  lado do texto, no celular — um toque errado invalidava para sempre o link
  recém-enviado, sem aviso e sem desfazer. Passou a confirmar, mesmo padrão de
  `handleApagarEvento`.

## O que NÃO foi feito, de propósito

Não foi adicionado `overflow-x: hidden` no container do painel. Resolveria o
sintoma numa linha e **esconderia a próxima ocorrência** — a tabela larga que
alguém adicionar daqui a três meses ficaria cortada em silêncio, sem nada
indicando o problema. As causas foram corrigidas uma a uma.

O Playwright também não entrou como dependência do projeto: carregá-lo em todo
deploy da Vercel não se paga por uma ferramenta que só roda localmente. O
script documenta o `npm i -D playwright` necessário.
