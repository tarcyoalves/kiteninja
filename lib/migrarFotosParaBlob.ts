/**
 * Núcleo da migração das fotos antigas (base64 no banco) para o Vercel Blob.
 * O script que o dono roda é scripts/migrar-fotos-para-blob.ts; a lógica fica
 * aqui para ser testada contra PGlite, sem rede e sem token.
 *
 * GARANTIAS (testadas em lib/migrarFotosParaBlob.test.ts):
 *  - `aplicar: false` (padrão do script) só CONTA e soma o tamanho;
 *  - a linha só é trocada DEPOIS que o upload devolveu a URL;
 *  - nada é apagado — nem linha, nem arquivo no Blob;
 *  - idempotente: só olha linhas que ainda começam com `data:image/`, então
 *    rodar de novo continua de onde parou, e o upload usa nome fixo (pelo id
 *    da linha) com sobrescrita, então repetir não deixa arquivo sobrando;
 *  - lotes pequenos: lê poucas linhas por vez (cada uma pode ter 1,5 MB);
 *  - o UPDATE confere que a coluna ainda é `data:image/`: se a pessoa trocou a
 *    foto no meio da migração, a foto nova dela não é sobrescrita.
 *
 * Comentário SQL aqui não pode ter dólar-chave nem crase (verify-sql.ts).
 */

export type SqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export type Subir = (pathname: string, corpo: Buffer, contentType: string) => Promise<string>;

export interface OpcoesMigracao {
  sql: SqlTag;
  /** false = só conta (dry-run). */
  aplicar: boolean;
  subir: Subir;
  /** Linhas lidas por vez. */
  tamanhoLote?: number;
  log?: (msg: string) => void;
}

export interface ResumoTabela {
  tabela: string;
  pendentes: number;
  bytes: number;
  migradas: number;
  falhas: number;
  ignoradas: number;
}

const ID_ZERO = '00000000-0000-0000-0000-000000000000';

interface Alvo {
  tabela: string;
  prefixo: string;
  contar: (sql: SqlTag) => Promise<{ n: number; bytes: number }>;
  proximas: (sql: SqlTag, depoisDe: string, limite: number) => Promise<Array<{ id: string; foto: string }>>;
  trocar: (sql: SqlTag, id: string, url: string) => Promise<number>;
}

function numeros(rows: unknown[]): { n: number; bytes: number } {
  const r = (rows[0] ?? {}) as Record<string, unknown>;
  return { n: Number(r.n ?? 0), bytes: Number(r.bytes ?? 0) };
}

const ALVOS: Alvo[] = [
  {
    tabela: 'posts.photo_url',
    prefixo: 'relatos/',
    contar: async (sql) =>
      numeros(
        await sql`SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(photo_url)), 0) AS bytes FROM posts WHERE photo_url LIKE 'data:image/%'`
      ),
    proximas: async (sql, depoisDe, limite) =>
      (await sql`
        SELECT id::text AS id, photo_url AS foto FROM posts
        WHERE photo_url LIKE 'data:image/%' AND id > ${depoisDe}::uuid
        ORDER BY id LIMIT ${limite}
      `) as Array<{ id: string; foto: string }>,
    trocar: async (sql, id, url) =>
      (
        await sql`
          UPDATE posts SET photo_url = ${url}
          WHERE id = ${id}::uuid AND photo_url LIKE 'data:image/%'
          RETURNING id
        `
      ).length,
  },
  {
    tabela: 'users.avatar_url',
    prefixo: 'avatares/',
    contar: async (sql) =>
      numeros(
        await sql`SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(avatar_url)), 0) AS bytes FROM users WHERE avatar_url LIKE 'data:image/%'`
      ),
    proximas: async (sql, depoisDe, limite) =>
      (await sql`
        SELECT id::text AS id, avatar_url AS foto FROM users
        WHERE avatar_url LIKE 'data:image/%' AND id > ${depoisDe}::uuid
        ORDER BY id LIMIT ${limite}
      `) as Array<{ id: string; foto: string }>,
    trocar: async (sql, id, url) =>
      (
        await sql`
          UPDATE users SET avatar_url = ${url}
          WHERE id = ${id}::uuid AND avatar_url LIKE 'data:image/%'
          RETURNING id
        `
      ).length,
  },
  {
    tabela: 'listing_photos.data_url',
    prefixo: 'anuncios/',
    contar: async (sql) =>
      numeros(
        await sql`SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(data_url)), 0) AS bytes FROM listing_photos WHERE data_url LIKE 'data:image/%'`
      ),
    proximas: async (sql, depoisDe, limite) =>
      (await sql`
        SELECT id::text AS id, data_url AS foto FROM listing_photos
        WHERE data_url LIKE 'data:image/%' AND id > ${depoisDe}::uuid
        ORDER BY id LIMIT ${limite}
      `) as Array<{ id: string; foto: string }>,
    trocar: async (sql, id, url) =>
      (
        await sql`
          UPDATE listing_photos SET data_url = ${url}
          WHERE id = ${id}::uuid AND data_url LIKE 'data:image/%'
          RETURNING id
        `
      ).length,
  },
];

const EXTENSAO: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** `data:image/jpeg;base64,AAAA` -> tipo e bytes. null se não for imagem base64 aproveitável. */
export function lerDataUrl(valor: string): { contentType: string; corpo: Buffer; extensao: string } | null {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(valor);
  if (!m) return null;
  const contentType = m[1].toLowerCase();
  const extensao = EXTENSAO[contentType];
  // svg+xml e afins: não sobem. Imagem vetorial pode carregar script, e o app
  // nunca gerou isso — se existir no banco, é dado estranho, fica onde está.
  if (!extensao) return null;
  const corpo = Buffer.from(m[2], 'base64');
  if (corpo.length === 0) return null;
  return { contentType, corpo, extensao };
}

export async function migrarFotos(o: OpcoesMigracao): Promise<ResumoTabela[]> {
  const { sql, aplicar, subir } = o;
  const lote = Math.max(1, Math.min(o.tamanhoLote ?? 5, 50));
  const log = o.log ?? (() => undefined);
  const resumos: ResumoTabela[] = [];

  for (const alvo of ALVOS) {
    const { n, bytes } = await alvo.contar(sql);
    const r: ResumoTabela = { tabela: alvo.tabela, pendentes: n, bytes, migradas: 0, falhas: 0, ignoradas: 0 };
    resumos.push(r);
    log(`${alvo.tabela}: ${n} foto(s) em base64, ${(bytes / 1024 / 1024).toFixed(1)} MB de texto`);
    if (!aplicar || n === 0) continue;

    // Paginação por id (e não "as primeiras N que ainda são data:"): uma foto
    // que falha continuaria sendo a primeira da fila para sempre.
    let ultimo = ID_ZERO;
    for (;;) {
      const linhas = await alvo.proximas(sql, ultimo, lote);
      if (linhas.length === 0) break;
      for (const linha of linhas) {
        ultimo = linha.id;
        const dados = lerDataUrl(String(linha.foto));
        if (!dados) {
          r.ignoradas += 1;
          log(`  ${alvo.tabela} ${linha.id}: formato não migrável, deixada como está`);
          continue;
        }
        let url: string;
        try {
          url = await subir(`${alvo.prefixo}migrado-${linha.id}.${dados.extensao}`, dados.corpo, dados.contentType);
        } catch (e) {
          r.falhas += 1;
          log(`  ${alvo.tabela} ${linha.id}: upload falhou (${e instanceof Error ? e.message : String(e)}); linha intacta`);
          continue;
        }
        if (!/^https:\/\//.test(url)) {
          r.falhas += 1;
          log(`  ${alvo.tabela} ${linha.id}: o Blob não devolveu URL https; linha intacta`);
          continue;
        }
        // Só aqui, com a URL na mão, a linha muda.
        const trocadas = await alvo.trocar(sql, linha.id, url);
        if (trocadas > 0) r.migradas += 1;
        else r.ignoradas += 1; // a pessoa trocou a foto no meio do caminho
      }
      log(`  ${alvo.tabela}: ${r.migradas} migradas, ${r.falhas} falhas até agora`);
    }
  }
  return resumos;
}
