/**
 * Pessoas e sessões de teste SEM pagar o bcrypt (custo 12, ~0,5 s) a cada uma.
 *
 * `criarUsuario` + `logarComo` (test/rotasComPglite.ts) fazem o caminho
 * completo — hash da senha, rota de login, verificação — e custam ~1 s por
 * pessoa nesta máquina. Os testes de fluxo precisam de dezenas de pessoas e
 * trocam de pessoa a toda hora; só o SOS passava de 60 s de arquivo. Aqui:
 *
 *  - `novaPessoa` insere o usuário com um hash calculado UMA vez;
 *  - `entrarComo` abre uma sessão de verdade (`createSession`, a mesma que o
 *    login chama: linha em `auth_sessions` + cookie no "navegador"), sem
 *    passar pela verificação de senha.
 *
 * O que NÃO é testado por aqui é o login em si — quem testa o login continua
 * usando `logarComo`.
 */
import { createSession, hashPassword } from '../lib/auth';
import { db, trocarPessoa, type UsuarioDeTeste } from './rotasComPglite';

let hashUnico: Promise<string> | null = null;
let seq = 0;

export async function novaPessoa(o: {
  role?: 'admin' | 'moderator' | 'instructor' | 'rider';
  nome?: string;
  ativo?: boolean;
} = {}): Promise<UsuarioDeTeste> {
  hashUnico ??= hashPassword('senha-rapida-de-teste');
  seq += 1;
  const email = `rapido${seq}@teste.kiteninja`;
  const nome = o.nome ?? `Rapido ${seq}`;
  const r = await db.query<{ id: string }>(
    `INSERT INTO users (email, name, password_hash, role, rider_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [email, nome, await hashUnico, o.role ?? 'rider', `KN-R${seq}`, o.ativo ?? true]
  );
  return { id: r.rows[0].id, email, senha: 'senha-rapida-de-teste', nome };
}

/** Passa a ser essa pessoa (cookie de sessão novo, "navegador" limpo). */
export async function entrarComo(u: { id: string }) {
  trocarPessoa();
  await createSession(u.id, 'vitest');
}
