import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { cookies } from 'next/headers';
import { HttpError, SESSION_COOKIE, requireUser, verifyPassword } from '@/lib/auth';
import { clampQuiverBoards, clampQuiverKites, num, oneOf, str } from '@/lib/validation';
import type { Discipline, RiderLevel } from '@/types';

const LEVELS = ['Iniciante', 'Intermediário', 'Avançado', 'Profissional'] as const;
const DISCIPLINES = [
  'Kitesurf Twintip',
  'Kitesurf Strapless Wave',
  'Hydrofoil',
  'Wingfoil',
  'Big Air',
] as const;
// Precisa bater com o CHECK de preferred_wind_unit em lib/schema.sql — um
// valor fora dessa lista quebraria o UPDATE com erro 500 em vez de 400.
const WIND_UNITS = ['knots', 'kmh', 'mph', 'ms'] as const;

/**
 * Distingue "campo não enviado" de "campo enviado". `null` conta como não
 * enviado: um cliente que serializa `null` por descuido não apaga o dado.
 */
function sent(body: unknown, field: string): boolean {
  if (body === null || typeof body !== 'object') return false;
  const v = (body as Record<string, unknown>)[field];
  return v !== undefined && v !== null;
}

/** Atualiza o próprio perfil. Não permite trocar email, role nem senha. */
export async function PATCH(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readJson(request);

    const name = str(body, 'name', { min: 2, max: 120, optional: true });
    // `name` vazio nunca apaga (a coluna é NOT NULL e o app inteiro mostra o
    // nome). Antes, `name: ""` era ignorado em silêncio e a tela dizia "salvo".
    if (sent(body, 'name') && !name) {
      throw new HttpError(400, 'O nome não pode ficar vazio.');
    }
    const weightKg = num(body, 'weightKg', { min: 30, max: 200, optional: true });
    const heightCm = num(body, 'heightCm', { min: 100, max: 230, optional: true });
    /*
     * CAMPOS DE TEXTO OPCIONAIS: "não enviado" MANTÉM, "enviado vazio" APAGA.
     *
     * Antes tudo era `COALESCE(${valor || null}, coluna)`: vazio virava NULL e o
     * COALESCE devolvia o valor antigo, então a bio, o spot de casa e o contato
     * de emergência não podiam mais ser removidos depois de preenchidos (V02).
     * `sent()` separa os dois casos, como em sessions/[id]. Conferido antes de
     * mudar: o único formulário que manda texto vazio é o do contato de
     * emergência (SidebarDrawer), e lá vazio É a intenção de apagar; nenhum
     * outro chamador de updateProfile manda estes campos (a calculadora manda
     * só weightKg; JSON.stringify omite `undefined`).
     */
    const homeSpotEnviado = sent(body, 'homeSpot');
    const bioEnviada = sent(body, 'bio');
    const contatoNomeEnviado = sent(body, 'emergencyContactName');
    const contatoFoneEnviado = sent(body, 'emergencyContactPhone');
    // Só espaços também é "vazio" (o `str` recusaria como "muito curto").
    const textoOpcional = (campo: string, max: number): string => {
      const v = (body as Record<string, unknown> | null)?.[campo];
      if (typeof v === 'string' && v.trim() === '') return '';
      return str(body, campo, { optional: true, max });
    };
    const homeSpot = textoOpcional('homeSpot', 120);
    const bio = textoOpcional('bio', 500);
    const highestJumpM = num(body, 'highestJumpM', { min: 0, max: 40, optional: true });
    const emergencyContactName = textoOpcional('emergencyContactName', 120);
    const emergencyContactPhone = textoOpcional('emergencyContactPhone', 30);

    /**
     * Foto de perfil. Aceita data URL JPEG/PNG/WebP comprimida ou URLs HTTPS seguras (ex: Dicebear, Vercel Blob).
     */
    const avatarUrl = str(body, 'avatarUrl', { optional: true, max: 1_500_000 });
    if (
      avatarUrl &&
      !/^data:image\/(jpeg|jpg|png|webp|gif|svg\+xml);base64,/i.test(avatarUrl) &&
      !/^https:\/\/[a-zA-Z0-9_\-./~%+=?&@#]+$/i.test(avatarUrl)
    ) {
      throw new HttpError(400, 'Formato de imagem não suportado.');
    }

    const hasLevel = (body as Record<string, unknown>)?.riderLevel !== undefined;
    const riderLevel = hasLevel
      ? oneOf<RiderLevel>(body, 'riderLevel', LEVELS)
      : null;

    const rawDisciplines = (body as Record<string, unknown>)?.disciplines;
    const disciplines = Array.isArray(rawDisciplines)
      ? (rawDisciplines.filter((d): d is Discipline =>
          DISCIPLINES.includes(d as (typeof DISCIPLINES)[number])
        ) as Discipline[])
      : null;

    const hasWindUnit = (body as Record<string, unknown>)?.preferredWindUnit !== undefined;
    const preferredWindUnit = hasWindUnit
      ? oneOf(body, 'preferredWindUnit', WIND_UNITS)
      : null;

    const rawQuiverKites = (body as Record<string, unknown>)?.quiverKites;
    const quiverKites = Array.isArray(rawQuiverKites) ? clampQuiverKites(rawQuiverKites) : null;

    /*
     * Preferência de aviso "amigo entrou na água".
     *
     * Checagem manual de presença antes de ler o valor, e NÃO `Boolean(...)`:
     * com COALESCE, `undefined` significa "não mexer neste campo" e `false`
     * significa "desligar". Convertendo direto, um PATCH que só muda o nome
     * mandaria `false` e desligaria a preferência sem ninguém pedir — o tipo
     * de bug que só aparece quando o usuário reclama que o aviso sumiu.
     */
    const rawNotificarAmigo = (body as Record<string, unknown>)?.notificarAmigoVelejando;
    const notificarAmigoVelejando =
      typeof rawNotificarAmigo === 'boolean' ? rawNotificarAmigo : null;

    const rawQuiverBoards = (body as Record<string, unknown>)?.quiverBoards;
    const quiverBoards = Array.isArray(rawQuiverBoards) ? clampQuiverBoards(rawQuiverBoards) : null;

    // COALESCE mantém o valor atual quando o campo não foi enviado; os quatro
    // textos opcionais usam CASE (acima) para também poderem ser apagados.
    await sql`
      UPDATE users SET
        name                = COALESCE(${name || null}, name),
        weight_kg           = COALESCE(${weightKg}, weight_kg),
        height_cm           = COALESCE(${heightCm}, height_cm),
        home_spot           = CASE WHEN ${homeSpotEnviado}::boolean THEN ${homeSpot || null}::text ELSE home_spot END,
        bio                 = CASE WHEN ${bioEnviada}::boolean THEN ${bio || null}::text ELSE bio END,
        highest_jump_m      = COALESCE(${highestJumpM}, highest_jump_m),
        avatar_url          = COALESCE(${avatarUrl || null}, avatar_url),
        rider_level         = COALESCE(${riderLevel}, rider_level),
        disciplines         = COALESCE(${disciplines && disciplines.length > 0 ? disciplines : null}, disciplines),
        quiver_kites        = COALESCE(${quiverKites && quiverKites.length > 0 ? quiverKites : null}, quiver_kites),
        quiver_boards       = COALESCE(${quiverBoards && quiverBoards.length > 0 ? quiverBoards : null}, quiver_boards),
        preferred_wind_unit = COALESCE(${preferredWindUnit || null}, preferred_wind_unit),
        emergency_contact_name  = CASE WHEN ${contatoNomeEnviado}::boolean THEN ${emergencyContactName || null}::text ELSE emergency_contact_name END,
        emergency_contact_phone = CASE WHEN ${contatoFoneEnviado}::boolean THEN ${emergencyContactPhone || null}::text ELSE emergency_contact_phone END,
        notificar_amigo_velejando = COALESCE(${notificarAmigoVelejando}, notificar_amigo_velejando),
        updated_at          = NOW()
      WHERE id = ${user.id}
    `;

    return { ok: true };
  });
}

/**
 * Exclusão definitiva da própria conta.
 *
 * POR QUE ESTA ROTA EXISTE
 *
 * O Google Play exige, desde 2024, que todo app que cria contas ofereça um
 * caminho de exclusão dentro do app E uma URL pública explicando o processo
 * (ver `app/excluir-conta/page.tsx`). Sem isso o app é reprovado na submissão,
 * não importa o resto. A LGPD (art. 18, direito de eliminação) pede o mesmo.
 *
 * `DELETE FROM users` basta porque o schema já foi desenhado para isto: todas
 * as 35 chaves estrangeiras que apontam para `users` são ON DELETE CASCADE
 * (dado do próprio velejador: velejos, posições, mensagens, curtidas) ou
 * ON DELETE SET NULL (trilha de auditoria que precisa sobreviver sem a pessoa:
 * `audit_logs.actor_id`, `downwinds.criado_por`, `invites.used_by`).
 *
 * AS TRÊS TRAVAS, e por que cada uma:
 *
 *  - SENHA ATUAL: exclusão é irreversível e a sessão pode ter sido roubada.
 *    Pedir a senha faz a conta sobreviver a um celular desbloqueado na praia.
 *
 *  - SOS ATIVO: apagar a conta durante um chamado de socorro cascatearia
 *    `sos_alerts` e `sos_responders` — quem está indo ajudar perderia a
 *    posição da pessoa no meio do resgate. É a única trava aqui que não é
 *    sobre dados, é sobre alguém na água.
 *
 *  - ÚLTIMO ADMIN: se o único administrador ativo se apaga, ninguém mais
 *    emite convite nem promove alguém, e o app fica sem dono sem aviso.
 */
export async function DELETE(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readJson(request);

    const senha = (body as Record<string, unknown>)?.currentPassword;
    if (typeof senha !== 'string' || senha.length === 0) {
      throw new HttpError(400, 'Informe sua senha para confirmar a exclusão.');
    }

    const linhas = await sql`SELECT password_hash, role FROM users WHERE id = ${user.id} LIMIT 1`;
    const linha = linhas[0] as Record<string, unknown> | undefined;
    if (!linha) throw new HttpError(404, 'Usuário não encontrado.');

    if (!(await verifyPassword(senha, String(linha.password_hash)))) {
      throw new HttpError(401, 'Senha incorreta.');
    }

    const sos = await sql`
      SELECT 1 FROM sos_alerts
      WHERE user_id = ${user.id} AND status IN ('ativo', 'em_atendimento')
      LIMIT 1
    `;
    if (sos.length > 0) {
      throw new HttpError(
        409,
        'Você tem um chamado de SOS em aberto. Encerre o chamado antes de excluir a conta.'
      );
    }

    if (String(linha.role) === 'admin') {
      const outros = await sql`
        SELECT 1 FROM users
        WHERE role = 'admin' AND is_active = TRUE AND id <> ${user.id}
        LIMIT 1
      `;
      if (outros.length === 0) {
        throw new HttpError(
          409,
          'Você é o único administrador ativo. Promova outro administrador antes de excluir a conta.'
        );
      }
    }

    // O filtro é o próprio id da sessão: ninguém apaga a conta de outra pessoa
    // por aqui. Moderação de terceiros passa pelo painel admin, com outra rota.
    const apagado = await sql`DELETE FROM users WHERE id = ${user.id} RETURNING id`;
    if (apagado.length === 0) throw new HttpError(404, 'Usuário não encontrado.');

    // As sessões já caíram por CASCADE em auth_sessions; o cookie no navegador
    // é que precisa ir embora, senão a próxima tela tenta usar um token morto.
    const jar = await cookies();
    jar.delete(SESSION_COOKIE);

    return { ok: true };
  });
}
