# Migrar as fotos antigas para o Vercel Blob

## Para que serve

Até 12/11/2026 o app guardava a foto de **relato**, o **avatar** e a foto de
**anúncio** como um texto enorme (base64) dentro do banco Neon, até 1,5 MB cada.
O Neon gratuito tem só 0,5 GB: cerca de 300 fotos enchem o banco. Daqui para a
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

## Limite do Blob no plano gratuito (Hobby)

Não consegui confirmar o número atual nas páginas de documentação a que tive
acesso, e ele muda com o tempo. **Confira o limite atual no painel da Vercel**
(Storage, Blob, e a página de uso/limites do plano) e compare com o total de MB
mostrado no Passo 1. Atenção: os MB do dry-run são do texto base64, que é cerca
de 33% maior que o arquivo real; o espaço usado no Blob será um pouco menor.
Como as fotos novas já são comprimidas no celular (algumas centenas de KB), a
conta do dia a dia costuma ser bem menor que a das fotos antigas.

## Se algo der errado

- `ERRO: DATABASE_URL não definida` — falta a linha no `.env.local`.
- `ERRO: para --aplicar é preciso BLOB_READ_WRITE_TOKEN` — falta o token.
- Falhas no resumo — rode o Passo 2 de novo; se persistir, guarde a mensagem
  mostrada (ela não contém segredos) e peça ajuda.
