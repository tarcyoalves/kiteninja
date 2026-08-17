# Plano — Classificados de equipamento (anúncios)

Status: **plano, nada implementado.** Este documento existe para ser revisado
antes de escrever código.

## O problema real

Kite usado é mercado de golpe. O ticket é alto (kite R$ 3–8 mil, foil R$ 6–15
mil), o comprador está longe do vendedor (o velejador de Fortaleza quer a barra
que está em Búzios), e o produto tem defeito invisível em foto: costura
estourada, bladder remendado, pano com UV morto que rasga na primeira rajada.

Os golpes que acontecem de fato em grupos de kite:

1. **Foto roubada.** Anunciante copia foto de anúncio antigo ou de loja, recebe
   PIX, desaparece.
2. **Vendedor fantasma.** Conta criada no dia, preço 40% abaixo do mercado,
   pressão para "fechar hoje que tem outro interessado".
3. **Produto adulterado.** Kite com reparo estrutural vendido como "impecável".
4. **Golpe do comprovante.** Comprador manda comprovante PIX falso/agendado, leva
   o equipamento, o dinheiro não cai.
5. **Golpe do intermediário.** Terceiro se oferece para "garantir a transação".
6. **Roubo de conta.** Conta legítima e antiga é invadida; a reputação do dono é
   usada para aplicar o golpe.

## Decisão de arquitetura: KiteNinja NÃO processa pagamento

**Não haverá checkout, split, escrow ou carteira.** Isso é deliberado:

- Intermediar pagamento nos torna responsáveis pelo prejuízo. Marketplace com
  custódia de dinheiro atrai exigência regulatória (arranjo de pagamento no BC),
  obrigação de estorno, e chargeback — inviável para um app de nicho.
- Sem custódia, não somos alvo de golpe de estorno.
- O que agrega valor aqui não é o pagamento; é **saber com quem você está
  falando**. O app já tem algo que nenhum grupo de WhatsApp tem: identidade
  verificada por convite e histórico de velejo real.

O papel do KiteNinja é **reduzir a assimetria de informação**, não segurar o
dinheiro.

## O ativo que já temos e que muda o jogo

O app é fechado por convite (`invites`, uso único). Isso significa:

- Toda conta é rastreável a quem convidou (`invites.created_by`).
- Não existe criação de conta em massa. O golpista de conta descartável não
  entra, e se entrar, queima o convite de quem o trouxe.
- Já existe `sessions_log`: histórico real de velejo, com data, spot e duração.
  Conta com 40 sessões registradas em 8 meses não é conta de golpista.

**Regra derivada:** o anúncio exibe sinais de procedência da CONTA, não só do
produto.

## Modelo de dados proposto

```sql
CREATE TABLE listings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           VARCHAR(120) NOT NULL,
  category        VARCHAR(40)  NOT NULL,  -- kite, barra, prancha, foil, wing, trapézio, neoprene, acessório
  brand           VARCHAR(60),
  model           VARCHAR(80),
  size_label      VARCHAR(20),            -- "9m", "138cm", "1250cm²"
  year_made       SMALLINT,
  condition       VARCHAR(20)  NOT NULL,  -- novo, seminovo, usado, precisa_reparo
  has_repairs     BOOLEAN NOT NULL,       -- declaração explícita, obrigatória
  repairs_note    TEXT,
  price_cents     INTEGER NOT NULL CHECK (price_cents > 0),
  accepts_trade   BOOLEAN NOT NULL DEFAULT FALSE,
  description     TEXT NOT NULL,
  city            VARCHAR(80) NOT NULL,
  state           CHAR(2) NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'ativo',
                  -- ativo, pausado, vendido, removido, em_analise
  view_count      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sold_at         TIMESTAMPTZ,
  CONSTRAINT condition_valida CHECK (condition IN ('novo','seminovo','usado','precisa_reparo')),
  CONSTRAINT status_valido CHECK (status IN ('ativo','pausado','vendido','removido','em_analise')),
  -- Reparo declarado exige descrição: "tem reparo" sem dizer qual é inútil.
  CONSTRAINT reparo_descrito CHECK (has_repairs = FALSE OR repairs_note IS NOT NULL)
);

CREATE TABLE listing_photos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id   UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  position     SMALLINT NOT NULL,
  -- Hash perceptual para detectar foto reusada entre anúncios (ver adiante).
  phash        VARCHAR(64),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE listing_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id   UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  reporter_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason       VARCHAR(40) NOT NULL,  -- foto_roubada, preco_suspeito, produto_diferente, cobranca_antecipada, outro
  detail       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Uma denúncia por pessoa por anúncio, senão a contagem é manipulável.
  UNIQUE (listing_id, reporter_id)
);
```

Índices: `(status, created_at DESC)` para a listagem; `(category, status)`;
`(seller_id, status)`; `(state, status)`.

## Camadas antigolpe

### 1. Selo de procedência da conta (não do produto)

Cada anúncio mostra, calculado no servidor:

- **Tempo de conta**: "Rider desde mar/2026". Conta com menos de 14 dias recebe
  aviso visível: *"Conta recente — combine encontro presencial"*.
- **Sessões registradas**: "63 velejos no logbook". É custoso de falsificar:
  exigiria meses de registros consistentes.
- **Quem convidou**: não expõe o nome de terceiros publicamente, mas mostra
  "Convidado por um rider verificado" — e para o admin, a cadeia completa.
- **Anúncios concluídos**: "4 vendas marcadas como concluídas".

Nada disso é "verificado ✓" genérico, que não significa nada. São fatos
verificáveis, e a UI diz de onde cada um vem.

### 2. Detecção de foto reutilizada

Ao publicar, calcular **pHash** (hash perceptual, não criptográfico) de cada
foto — dHash 64 bits resolve, implementável em ~40 linhas sobre canvas.

- Se o pHash tiver distância de Hamming ≤ 6 de foto em outro anúncio de **outro
  vendedor**, o anúncio entra em `em_analise` e o admin é notificado.
- Se colidir com anúncio do **mesmo** vendedor, é só republicação: libera.

Isso pega o golpe #1 (foto roubada de anúncio antigo do próprio app). Não pega
foto roubada da internet — para isso, o item 3.

### 3. Prova de posse: foto com marca do dia

Exigir **uma foto obrigatória** do equipamento ao lado de um código gerado na
hora (ex.: papel escrito à mão com `KN-7F3A`, ou o próprio app sobrepondo a
data). Quem não tem o equipamento não produz essa foto.

É o mesmo princípio de prova de vida bancária. Não é infalível, mas eleva
brutalmente o custo do golpe de foto da internet.

### 4. Faixa de preço de mercado

Manter tabela de referência por categoria/tamanho/ano (alimentada pelos próprios
anúncios concluídos). Se o preço estiver **abaixo de 55% da mediana**, o anúncio
mostra aviso ao COMPRADOR:

> ⚠️ Preço muito abaixo do praticado para 9m 2023. Preço bom demais é o isca
> mais comum de golpe. Veja o equipamento antes de pagar.

Note: o aviso é para o comprador, não bloqueio do vendedor. Pode haver venda
legítima urgente. Informar > censurar.

### 5. Checklist de segurança na conversa

Ao abrir contato sobre um anúncio, um bloco fixo, não dispensável na primeira vez:

- Veja o equipamento pessoalmente ou por chamada de vídeo **ao vivo** (vídeo
  gravado pode ser de outro produto).
- Infle o kite antes de pagar. Cheque costura de bordo de fuga, bladder e
  válvulas.
- **O KiteNinja nunca intermedeia pagamento.** Ninguém do app vai pedir PIX,
  taxa, sinal ou "garantia". Se pedirem, é golpe — denuncie.
- Comprovante PIX pode ser falsificado ou agendado. Confirme o saldo no **seu**
  extrato antes de entregar.
- Desconfie de pressa: "tem outro interessado, fecha agora" é técnica de golpe.

O terceiro item é o mais importante e precisa estar visível em todo lugar:
**deixa o golpe do intermediário sem chão.**

### 6. Denúncia e resposta

- Botão de denúncia em todo anúncio, com motivo estruturado.
- **3 denúncias distintas** → `em_analise` automático (sai da listagem, o admin
  revisa). Limiar automático porque golpista age rápido e o admin dorme.
- Painel do admin: fila de análise, histórico do vendedor, cadeia de convite.
- Admin pode **revogar o convite** e desativar a conta. Como a conta veio de
  convite rastreável, quem convidou é notificado — isso cria responsabilidade
  social real, que é o mecanismo mais eficaz num app de nicho.

### 7. Limites contra abuso

- Máximo 8 anúncios ativos por conta (evita spam de loja disfarçada).
- Conta com menos de 7 dias: máximo 1 anúncio ativo.
- Rate limit na criação: 3/dia.
- Sem link externo, telefone ou @ no título/descrição — força o contato pelo
  chat do app, onde há registro para investigação. Validar com regex no servidor,
  nunca só no cliente.

## Fora de escopo (explicitamente)

- Pagamento, escrow, split, carteira.
- Frete e etiqueta.
- Anúncio de loja/CNPJ (muda a natureza jurídica; se for desejado, é outro
  projeto com contrato e nota fiscal).
- Leilão.

## Ordem de implementação sugerida

1. Schema + migração + `verify-sql.ts` cobrindo as constraints.
2. CRUD de anúncio com upload de foto (reusar `lib/imageCompress.ts`).
3. Listagem com filtro (categoria, estado, faixa de preço) e busca.
4. Selo de procedência (agregados de `users` + `sessions_log`).
5. Checklist de segurança + aviso de preço.
6. Denúncia + fila do admin.
7. pHash e prova de posse (mais complexo, entra depois da base funcionar).

## Risco que permanece

Nenhuma camada acima impede um velejador de longa data, com histórico real, de
dar um golpe único. Esse risco é irredutível sem custódia de pagamento — e
custódia traz riscos piores. A mitigação é social: comunidade pequena, identidade
rastreável, e o custo reputacional de queimar a própria conta e a de quem
convidou.
