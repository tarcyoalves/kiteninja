import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL não definida. Copie .env.example para .env.local e preencha com a connection string pooled do Neon.'
  );
}

/**
 * Cliente SQL do Neon over HTTP.
 * Usa a connection string *pooled* (host com `-pooler`) porque cada invocação
 * serverless na Vercel abriria uma conexão nova; sem o pooler o Neon estoura
 * o limite de conexões.
 */
export const sql = neon(process.env.DATABASE_URL);
