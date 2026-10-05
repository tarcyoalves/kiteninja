'use client';

import React, { useEffect, useState } from 'react';
import { History, Loader2, RefreshCw } from 'lucide-react';

/**
 * Trilha de auditoria: as últimas 100 ações do administrador.
 *
 * Existe porque nenhuma rota do painel deixava rastro — se a conta de admin
 * fosse usada por outra pessoa, não havia como saber o que tinha sido feito.
 * Ver `lib/auditoriaAdmin.ts` (o que é gravado e, principalmente, o que nunca
 * é: token e link de senha).
 *
 * SEM POLLING, de propósito: a auditoria é consultada de vez em quando, não
 * vigiada, e cada atualização é uma consulta ao Neon gratuito. Busca ao abrir
 * a aba e quando o admin toca em "Atualizar".
 */

interface AcaoLinha {
  id: string;
  acao: string;
  alvoTipo: string;
  alvoId: string | null;
  alvoNome: string | null;
  atorNome: string | null;
  detalhes: Record<string, unknown>;
  em: string;
}

const PAPEIS: Record<string, string> = {
  admin: 'Admin',
  moderator: 'Moderador',
  instructor: 'Instrutor',
  rider: 'Velejador',
};

const STATUS_CHAMADO: Record<string, string> = {
  novo: 'Novo',
  em_analise: 'Em análise',
  aprovado: 'Aprovado',
  rejeitado: 'Rejeitado',
  implementado: 'Implementado',
};

/** A frase da linha, a partir da ação gravada. Ação desconhecida aparece crua. */
function descrever(a: AcaoLinha): string {
  const alvo = a.alvoNome ?? 'conta removida';
  const d = a.detalhes ?? {};
  const papel = (v: unknown) => PAPEIS[String(v)] ?? String(v ?? '?');
  const status = (v: unknown) => STATUS_CHAMADO[String(v)] ?? String(v ?? '?');

  switch (a.acao) {
    case 'admin.usuario.papel_alterado':
      return `mudou o papel de ${alvo}: ${papel(d.de)} → ${papel(d.para)}`;
    case 'admin.usuario.suspenso':
      return `suspendeu a conta de ${alvo}`;
    case 'admin.usuario.reativado':
      return `reativou a conta de ${alvo}`;
    case 'admin.usuario.troca_senha_exigida':
      return `exigiu a troca de senha de ${alvo} no próximo login`;
    case 'admin.usuario.troca_senha_dispensada':
      return `dispensou a troca de senha de ${alvo}`;
    case 'admin.usuario.link_senha_gerado':
      return `gerou um link de nova senha para ${alvo}`;
    case 'admin.convite.criado':
      return d.restritoAoEmail ? 'criou um convite restrito a um e-mail' : 'criou um convite aberto';
    case 'admin.convite.revogado':
      return 'revogou um convite';
    case 'admin.chamado.status_alterado':
      return `mudou o status de um chamado: ${status(d.de)} → ${status(d.para)}`;
    case 'admin.chamado.parecer_alterado':
      return 'registrou um parecer em um chamado';
    case 'admin.erro.resolvido':
      return `marcou o erro #${a.alvoId ?? '?'} como resolvido`;
    case 'admin.erro.reaberto':
      return `reabriu o erro #${a.alvoId ?? '?'}`;
    default:
      return a.acao;
  }
}

function quando(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const AuditoriaManager: React.FC = () => {
  const [acoes, setAcoes] = useState<AcaoLinha[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  /**
   * Busca ao abrir a aba e a cada incremento de `recarga` (botão). Todo
   * `setState` acontece depois de um `await`, como em `ErrosManager`: o React
   * Compiler não aceita estado alterado de forma síncrona dentro de efeito, e
   * `carregando` já nasce `true`. Sem `setInterval`.
   */
  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const res = await fetch('/api/admin/auditoria', { cache: 'no-store' });
        if (!res.ok) throw new Error('Não foi possível carregar a auditoria.');
        const dados = (await res.json()) as { acoes?: AcaoLinha[] };
        if (!vivo) return;
        setAcoes(dados.acoes ?? []);
        setErro(null);
      } catch (e) {
        if (vivo) setErro(e instanceof TypeError ? 'Sem conexão. Tente de novo.' : e instanceof Error ? e.message : 'Falha ao carregar.');
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [recarga]);

  const atualizar = () => {
    setCarregando(true);
    setRecarga((n) => n + 1);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-sm font-black text-white">Auditoria</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            As últimas 100 ações do administrador. Atualiza só quando você toca no botão.
          </p>
        </div>
        <button
          type="button"
          onClick={atualizar}
          disabled={carregando}
          className="shrink-0 px-3 py-1.5 rounded-xl bg-slate-800/70 text-slate-300 hover:text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={carregando ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </div>

      {erro && (
        <p
          role="alert"
          className="mb-3 p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs font-bold"
        >
          {erro}
        </p>
      )}

      {carregando && acoes.length === 0 && (
        <div className="flex items-center justify-center py-10 text-slate-500">
          <Loader2 size={20} className="animate-spin" />
        </div>
      )}

      {!carregando && !erro && acoes.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <History size={28} className="text-slate-500 mb-2" />
          <p className="text-sm font-black text-white">Nenhuma ação registrada ainda</p>
          <p className="text-[11px] text-slate-500 mt-1">
            Suspender, mudar papel, gerar link de senha, convites e chamados aparecem aqui.
          </p>
        </div>
      )}

      <ul className="space-y-2">
        {acoes.map((a) => (
          <li key={a.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
            <p className="text-[10px] text-slate-500 font-mono">{quando(a.em)}</p>
            {/* `break-words`: nome de pessoa e texto de convite não têm onde
                quebrar e esticariam o cartão para fora da tela. */}
            <p className="text-xs text-slate-200 mt-0.5 break-words">
              <strong className="text-cyan-300">{a.atorNome ?? 'conta removida'}</strong> {descrever(a)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
};
