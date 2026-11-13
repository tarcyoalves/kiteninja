# Migrar as fotos antigas para o Vercel Blob

## Para que serve

Até 12/11/2026 o app guardava a foto de **relato**, o **avatar** e a foto de
**anúncio** como um texto enorme (base64) dentro do banco Neon, até 1,5 MB cada.
O espaço do Neon gratuito é pequeno (1 GB em 11/2026) e cada foto ocupa até 1,5 MB. Daqui para a
frente as fotos novas já vão para o Vercel Blob e o banco guarda só o endereço
(a URL). Este script faz o mesmo com as fotos **que já estão no banco**.

Ele **não é obrigatório para o app funcionar**: as fotos antigas continuam
aparecendo do jeito que estão. Rode quando quiser liberar espaço no banco.

## Antes de começar

1. O Blob precisa estar ligado no projeto da Vercel (as fotos de velejo já usam).
   Se `BLOB_READ_WRITE_TOKEN` existe nas variáveis do projeto na Vercel, está ligado.
2. Faça um backup/ponto de restauração do banco no painel do Neon (ele guarda o
   histórico por pouco tempo no plano gratuito). O script não apaga nada, mas
   uma cópia dá tranquilidade.
3. Na sua máquina, na pasta do projeto, crie/edite o arquivo `.env.local` com
   duas linhas (copie os valores dos painéis da Vercel e do Neon; **nunca**
   mande esses valores para ninguém nem para o GitHub):

   ```
   DATABASE_URL=...
   BLOB_READ_WRITE_TOKEN=...
   ```

   O `.env.local` já é ignorado pelo git.

## Passo 1 — só olhar (não muda nada)

```bash
npx tsx scripts/migrar-fotos-para-blob.ts
```

Esse é o modo "dry-run". Ele só **conta** quantas fotos antigas existem em cada
tabela e quantos MB de texto elas ocupam. Nada é enviado e nada é alterado.
Para esse passo o `BLOB_READ_WRITE_TOKEN` nem é necessário.

## Passo 2 — migrar de verdade

```bash
npx tsx scripts/migrar-fotos-para-blob.ts --aplicar
```

Para cada foto antiga o script: (1) envia o arquivo ao Blob; (2) **só depois**
que o Blob confirma e devolve o endereço, troca o texto no banco pelo endereço.
Se um envio falhar, aquela foto continua exatamente como estava, e o script
segue para a próxima. No fim ele mostra um resumo e, havendo falhas, avisa.

- Pode rodar **de novo** quantas vezes quiser: ele só mexe no que ainda é foto
  antiga, então continua de onde parou. Se a internet cair no meio, é só repetir.
- Ele trabalha de poucas em poucas fotos (5 por vez). Para ir mais devagar:
  `--lote 2`.
- Ele **não apaga** nenhuma linha nem nenhum arquivo do Blob.
- Imagens que não são JPEG/PNG/WebP/GIF (por exemplo SVG) ficam como estão.
- Se uma pessoa trocar a própria foto enquanto o script roda, a foto nova dela
  é preservada.

## Depois de rodar

- O espaço do Neon só aparece liberado depois que o Postgres reaproveita as
  linhas; o painel do Neon pode demorar a mostrar a queda. Isso é normal.
- Rode o Passo 1 de novo: o número de fotos pendentes deve ser 0 (ou só as
  ignoradas, como SVG).

## Limite do Blob no plano gratuito (Hobby) — LEIA ANTES DO PASSO 2

Conferido na documentação da Vercel em 13/11/2026:

- **2.000 envios de arquivo por mês**, 1 GB de espaço, 10 GB de tráfego.
- Passou de qualquer um, **a Vercel bloqueia o Blob por 30 dias** — todas as
  fotos do app param de carregar.

**Cada foto migrada gasta 1 envio.** Por isso o script sobe no máximo **200
fotos por execução** e para sozinho. Olhe o total do Passo 1 e faça a conta:

- **no máximo duas execuções por mês** (400 fotos). A conta: o app pode usar
  até 1.500 envios no mês para fotos novas; 1.500 + 400 = 1.900, abaixo dos
  2.000. Três execuções no mesmo mês já arriscam o bloqueio;
- mais de 400 fotos antigas: continue no mês seguinte. O app funciona
  normalmente com as fotos antigas no banco enquanto isso; não há pressa.

Para mudar o teto de uma execução: `--max 100` (ou outro número). Não passe de
200 por vez: o próprio app precisa dos envios do mês para as fotos novas, e
ele para de aceitar foto em 1.500 (ver `docs/LIMITES-PLANOS-GRATUITOS.md`).

Sobre o espaço: os MB mostrados no Passo 1 são do texto, cerca de 33% maior
que o arquivo real. Se o total passar de ~700 MB, não migre tudo — fale antes.

## Se algo der errado

- `ERRO: DATABASE_URL não definida` — falta a linha no `.env.local`.
- `ERRO: para --aplicar é preciso BLOB_READ_WRITE_TOKEN` — falta o token.
- Falhas no resumo — rode o Passo 2 de novo; se persistir, guarde a mensagem
  mostrada (ela não contém segredos) e peça ajuda.
