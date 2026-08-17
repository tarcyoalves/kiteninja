/* Conta descartável para inspecionar o layout logado.
   Em ESM todos os imports resolvem antes do corpo do módulo, então lib/db (que
   exige DATABASE_URL na carga) precisa vir por import dinâmico, depois do env.
   Também não importo lib/auth.ts: ele tem `import 'server-only'`, que só resolve
   dentro do build do Next. */
import bcrypt from 'bcryptjs';
import { loadEnv } from './load-env';

loadEnv();
const { sql } = await import('../lib/db');

const email = 'qa-layout@kiteninja.local';
const senha = 'QaLayout#2026x';
const hash = await bcrypt.hash(senha, 12);

await sql`
  INSERT INTO users (email, password_hash, name, rider_id, weight_kg, rider_level, role)
  VALUES (${email}, ${hash}, 'QA Layout', '9999', 78, 'Intermediário', 'admin')
  ON CONFLICT (email) DO UPDATE SET password_hash = ${hash}, role = 'admin'
`;
console.log('pronto:', email);
