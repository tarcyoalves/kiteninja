# Feed: trilha + foto no carrossel, e Comunidade x Seguindo

Pedido: *"no feed, quando o velejador postar, mostrar o registro do gps no mapa
e se tiver foto, ficar como carrossel para o lado. Comunidade e seguidores."*

## O que já existia (e não precisou ser feito)

O mapa da trilha no card **já existia** desde a Fase 3: `TrilhaMiniatura` (SVG,
desenha na hora, sem rede) por baixo, e o Leaflet de satélite montado por cima
quando o card entra na tela. Isso ficou como estava — inclusive o portão de
`IntersectionObserver`, que o carrossel reaproveita.

## Achado: a foto do velejo nunca aparecia

`sessions_log.photo_url` é gravada desde sempre — o logbook tem campo de foto,
com validação de formato e tamanho. E `app/api/feed/route.ts` **não selecionava
a coluna**. A foto era salva e não chegava a lugar nenhum do feed.

Oitava ocorrência da mesma família nesta base: o dado é registrado direito e
depois se perde no caminho até a tela.

## Por que a foto não vem na listagem

`photo_url` guarda a imagem inteira como **data URL**, até 1,5 MB por sessão.
Uma página do feed traz 20 linhas: mandar as imagens junto daria dezenas de MB
numa requisição, no 4G de uma praia — que é exatamente onde este app é usado.

Então a listagem devolve só `temFoto: boolean`, e o card busca a imagem em
`GET /api/sessions/[id]/foto` **quando ela vai realmente ser vista**, pelo mesmo
portão que decide montar o Leaflet. Uma requisição a mais por card visível, em
vez de 30 MB por página.

A rota aplica `podeVerSessao`, a mesma regra da listagem: velejo privado só
devolve foto para o autor; qualquer outro recebe 404.

## O carrossel

Rolagem nativa com `scroll-snap`, sem biblioteca: são poucos slides numa direção
só, e o gesto do próprio navegador é melhor que qualquer reimplementação em JS —
inclusive para teclado e leitor de tela.

**A trilha vem primeiro, de propósito.** É o que diferencia um velejo de uma
foto qualquer, e é o que a pessoa não consegue postar em outro app. A foto é o
complemento.

Detalhes que não são enfeite:
- O slide da foto **reserva o espaço** antes de a imagem chegar; sem isso o card
  pula quando ela carrega.
- Selo "Trilha"/"Foto" no canto: numa olhada rápida, um mapa de satélite e uma
  foto de praia se confundem.
- Bolinhas com alvo de 24px e ponto visível de 6px — o ponto pequeno é estética,
  o alvo grande é o dedo.
- Um slide só não recebe `role="carrossel"`: sem outro lugar para onde ir, o
  rótulo seria mentira.
- Sessão digitada à mão, sem trilha nem foto, não mostra nada. Nunca inventa um
  mapa — era assim antes e continua.

## Comunidade x Seguindo

O feed tinha **um escopo só**, e era o mais estreito possível: `eu OR (público E
eu sigo o autor)`. Quem cria conta e ainda não segue ninguém abria o feed e via
**nada** — justamente na tela onde procuraria quem seguir.

Os dois escopos agora coexistem, com padrão `comunidade`:
- **Comunidade**: tudo que é público. É onde se DESCOBRE gente.
- **Seguindo**: só quem eu escolhi. É onde se ACOMPANHA gente.

**A trava que importa:** trocar de aba amplia QUEM aparece, jamais O QUE é
visível. Sessão privada de terceiro não aparece em escopo nenhum.

Isso está garantido em duas camadas independentes: o `WHERE` da rota e
`podeVerNoFeed` (pura, testada), aplicada de novo sobre as linhas que voltaram.
Redundância deliberada — se um dia o WHERE for editado errado, a segunda ainda
segura.

Cinco checks em `scripts/verify-sql.ts` rodam o `WHERE` real nos dois escopos
com cinco velejos (público e privado, de quem sigo e de estranho, mais o meu
privado). Verificados nos dois sentidos: afrouxando a regra para o escopo
`comunidade` ignorar `is_public`, tanto o teste puro quanto o check de SQL
reprovam.

## O que ficou de fora, e por quê

**Várias fotos por velejo.** O carrossel já renderiza N slides — a estrutura
está pronta. O que falta é o caminho de escrita: hoje o logbook aceita UMA foto
e a guarda como data URL no Postgres. Guardar várias assim seria entrincheirar
uma arquitetura ruim (o banco vira depósito de imagem).

O caminho certo é migrar a foto do velejo para o Vercel Blob — que já está
instalado e em uso nos vídeos de abertura (`@vercel/blob`, upload direto do
navegador com token). Aí as fotos viram URLs curtas, a listagem pode mandá-las
inline, e várias fotos por velejo passam a ser só mais uma tabela.

É um turno próprio, e mexe no logbook, na rota de sessões e nos dados
existentes. Preferi entregar o carrossel funcionando com a foto que já existe a
entregar meia migração.
