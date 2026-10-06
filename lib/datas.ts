/**
 * Datas que saem do banco para a tela — num formato só.
 *
 * O DEFEITO QUE ISTO CORRIGE (achado vendo o app no tamanho de um celular,
 * em 06/10/2026): o feed, os alertas de segurança e o diário mostravam
 *
 *     Mon Oct 05 2026 23:58:21 GMT+0000 (Coordinated Universal Time)
 *
 * O driver do Neon converte `timestamptz` e `date` em objeto `Date` do JS
 * (parsers dos tipos 1184 e 1082), e as rotas faziam `String(r.created_at)` —
 * que é o `toString()` do Date, em inglês e com fuso por extenso. As telas
 * exibiam esse texto cru. O card de velejo do feed já usava
 * `formatRelativeTime` e mostrava "há 37 min"; os outros não.
 *
 * Regra: a API devolve ISO (instante) ou AAAA-MM-DD (data de calendário); a
 * tela formata. Sem dependência nenhuma: telas de cliente importam daqui.
 */

/** Instante → ISO 8601 em UTC. Aceita Date, string ou número; inválido → ''. */
export function instanteIso(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  const d = v instanceof Date ? v : new Date(v as string | number);
  return Number.isFinite(d.getTime()) ? d.toISOString() : '';
}

/**
 * Coluna `date` → 'AAAA-MM-DD', sem andar um dia para trás ou para frente.
 *
 * O driver monta o Date da coluna `date` à meia-noite do fuso LOCAL do
 * servidor; por isso os getters locais (e não os UTC) devolvem o dia certo
 * em qualquer fuso. Se já vier como texto 'AAAA-MM-DD', passa direto.
 */
export function dataCalendario(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = v instanceof Date ? v : new Date(v as string | number);
  if (!Number.isFinite(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** 'AAAA-MM-DD' → 'DD/MM/AAAA', lendo os números (sem Date, sem fuso). */
export function formatarDataCurta(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
