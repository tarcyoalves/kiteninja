import { describe, expect, it } from 'vitest';
import { splitSqlStatements } from './splitSqlStatements';

describe('splitSqlStatements', () => {
  it('divide comandos SQL comuns e remove comentários', () => {
    expect(splitSqlStatements(`
      -- comentário de seção
      CREATE TABLE a (id INT);
      /* comentário; de bloco */
      ALTER TABLE a ADD COLUMN nome TEXT;
    `)).toEqual([
      'CREATE TABLE a (id INT)',
      'ALTER TABLE a ADD COLUMN nome TEXT',
    ]);
  });

  it('trata comentários como espaço entre tokens, não cola palavras', () => {
    expect(splitSqlStatements('SELECT/* comentário */1; SELECT-- linha\n2;')).toEqual([
      'SELECT 1',
      'SELECT \n2',
    ]);
  });

  it('não divide ponto-e-vírgula dentro de strings ou identificadores', () => {
    expect(splitSqlStatements(`SELECT 'a;b'; SELECT "col;una" FROM t;`)).toEqual([
      "SELECT 'a;b'",
      'SELECT "col;una" FROM t',
    ]);
  });

  it('mantém DO $$ com todos os comandos internos como uma instrução', () => {
    const sql = `
      DO $$
      DECLARE
        total INT;
      BEGIN
        UPDATE t SET n = 1;
        GET DIAGNOSTICS total = ROW_COUNT;
        IF total > 0 THEN
          RAISE NOTICE 'ok; %', total;
        END IF;
      END $$;
      CREATE INDEX idx_t_n ON t (n);
    `;
    const statements = splitSqlStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('GET DIAGNOSTICS total = ROW_COUNT;');
    expect(statements[0]).toContain("RAISE NOTICE 'ok; %', total;");
    expect(statements[1]).toBe('CREATE INDEX idx_t_n ON t (n)');
  });

  it('mantém dollar-quote nomeado e comentários aninhados', () => {
    const statements = splitSqlStatements(`
      CREATE FUNCTION f() RETURNS void AS $corpo$
      BEGIN
        PERFORM 1;
      END;
      $corpo$ LANGUAGE plpgsql;
      /* fora /* aninhado; */ ainda fora */ SELECT 2;
    `);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('$corpo$');
    expect(statements[1]).toBe('SELECT 2');
  });
});
