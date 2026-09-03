# Fotos do velejo: do data URL no Postgres para o Blob, e de uma para várias

Fecha o item que ficou aberto em `docs/FEED-CARROSSEL-E-ESCOPO.md`.

## O que era

Uma foto por velejo, guardada em `sessions_log.photo_url` como **data URL** —
a imagem inteira em base64 dentro do Postgres, até 1,5 MB por linha.

Duas consequências, e a segunda é a que travava tudo:
1. O banco virou depósito de imagem.
2. O feed **não podia** mandar a foto na listagem: 20 linhas × 1,5 MB = dezenas
   de MB por página, no 4G da praia.

Guardar *várias* fotos assim seria entrincheirar o problema.

## O que é agora

A foto sobe do celular **direto para o Vercel Blob** — o mesmo storage já usado
pelos vídeos de abertura, com o mesmo protocolo de token
(`@vercel/blob/client`). O arquivo nunca passa pelo servidor: mandá-lo para a
rota só para ela reenviar ao storage gastaria a banda do velejador duas vezes.

`session_photos` guarda só a URL, com `ordem` — que é a sequência que o
velejador montou na tela, não a ordem em que os uploads terminaram. Várias fotos
sobem em paralelo e resolvem fora de sequência; sem a coluna, o carrossel sairia
embaralhado.

## A migração não converte nada — e é de propósito

As fotos antigas foram **copiadas** para `session_photos` preservando o data
URL. Convertê-las exigiria baixar e re-subir bytes reais durante um build de
deploy: risco de verdade, por ganho nenhum — elas já funcionam.

Por isso `url` aceita os dois formatos, e `sessions_log.photo_url` não foi
apagada: enquanto houver linha dependendo dela para reconstruir histórico,
removê-la é perda de dado sem contrapartida.

Sete checks cobrem exatamente isso em `scripts/verify-sql.ts`: que a cópia
aconteceu, que o data URL sobreviveu **inteiro**, que rodar a migração de novo
não duplica (o schema é aplicado a cada deploy), que a ordem sai de `ordem`, que
duas fotos não disputam a mesma posição, que a contagem não carrega imagem, e
que apagar o velejo leva as fotos junto.

Verificado no sentido contrário: quebrando a migração para ignorar data URLs,
**três** desses checks reprovam.

## Por que as fotos ainda não vêm na listagem do feed

As novas caberiam — são URLs curtas. As antigas, não. Um caminho só para os dois
formatos é melhor que dois caminhos condicionais, então a listagem continua
mandando `totalFotos: number` e o card busca as imagens quando elas vão ser
vistas, pelo mesmo `IntersectionObserver` que monta o Leaflet.

Quando não houver mais data URL no banco, dá para mandar as URLs inline e
economizar uma requisição por card. Não vale fazer agora: economizar uma
requisição não paga um caminho condicional a mais.

## Decisões que parecem arbitrárias e não são

**Máximo de 4 fotos.** Limite de produto, não técnico — o Blob aguentaria muito
mais. O carrossel é uma tira horizontal num card de feed; passar de meia dúzia
de slides transforma navegação em garimpo.

**Chegar acima do teto corta em vez de recusar.** Cliente desatualizado mandando
cinco fotos é erro de cliente, não do velejador. Perder o velejo inteiro por
causa da quinta foto seria a pior resposta possível — a sessão é o dado que
importa.

**Falha ao gravar foto não derruba a resposta.** Mesmo princípio: uma foto que
não gravou é uma pena; um velejo que sumiu porque a foto falhou é o defeito
recorrente desta base.

**Os slides nascem do NÚMERO, não da lista carregada.** Assim o carrossel já tem
o tamanho final antes de qualquer imagem chegar: as bolinhas não mudam de
quantidade no meio da leitura e o card não pula quando a resposta volta.

**A checagem de sessão dentro de `onBeforeGenerateToken` não é redundante.** É
ela que de fato autoriza a emissão do token — sem ela, quem descobrir a URL da
rota consegue um token válido e passa a subir arquivo no storage do projeto. O
prefixo `velejos/` obrigatório existe pelo mesmo motivo: sem ele, um token
emitido ali serviria para sobrescrever `intro/…`, que é conteúdo de admin.

## Compatibilidade

`POST /api/sessions` continua aceitando `photoUrl` (uma foto, data URL). O
Android é uma casca que carrega a web, mas uma aba aberta há dias tem o bundle
antigo em memória. Quando vem, entra como a primeira foto.

## O que depende de você

`BLOB_READ_WRITE_TOKEN` precisa existir no ambiente da Vercel — é o mesmo token
que os vídeos de abertura já usam, então provavelmente já está lá. Se não
estiver, a rota responde 503 com essa mensagem exata em vez de falhar em
silêncio.
