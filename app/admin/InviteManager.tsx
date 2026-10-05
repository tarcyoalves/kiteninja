'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Link2, Trash2, TriangleAlert } from 'lucide-react';

interface InviteRow {
  id: string;
  email: string | null;
  note: string | null;
  expiresAt: string;
  usedAt: string | null;
  usedByName: string | null;
  status: 'aberto' | 'usado' | 'expirado' | 'revogado';
}

const STATUS_STYLE: Record<InviteRow['status'], string> = {
  aberto: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  usado: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
  expirado: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  revogado: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
};

export function InviteManager() {
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /*
   * Falha de carregar/atualizar o HISTÓRICO, mostrada na própria seção do
   * histórico. Antes `if (!res.ok) return;` deixava a lista vazia com o texto
   * "Nenhum convite gerado ainda." — o painel afirmava que não havia convite
   * quando, na verdade, não tinha conseguido ler.
   */
  const [erroLista, setErroLista] = useState<string | null>(null);
  /*
   * Falha de revogar, com o id do convite: aparece DENTRO do cartão tocado.
   * Numa lista longa, o `error` do topo (acima do histórico) fica fora da tela
   * e o admin achava que o convite tinha sido revogado.
   */
  const [erroRevogar, setErroRevogar] = useState<{ id: string; msg: string } | null>(null);

  // Carrega lista de convites
  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch('/api/admin/invites', { signal: controller.signal });
        if (!res.ok) throw new Error('lista');
        const data = await res.json();
        setInvites(data.invites ?? []);
        setErroLista(null);
      } catch {
        // Abortar (sair da aba) não é falha; qualquer outra coisa é.
        if (!controller.signal.aborted) {
          setErroLista('Não foi possível carregar o histórico de convites.');
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, []);

  /** Relê o histórico depois de uma ação. Devolve se conseguiu. */
  async function recarregarLista(): Promise<boolean> {
    try {
      const listRes = await fetch('/api/admin/invites');
      if (!listRes.ok) throw new Error('lista');
      const listData = await listRes.json();
      setInvites(listData.invites ?? []);
      setErroLista(null);
      return true;
    } catch {
      return false;
    }
  }

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setCopied(false);

    try {
      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email || undefined, note: note || undefined }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? 'Não foi possível gerar o convite.');
        return;
      }

      setFreshLink(data.inviteUrl);
      setEmail('');
      setNote('');
      // O convite JÁ existe e o link está na tela; se só a releitura do
      // histórico falhar, é isto que precisa ser dito (e não "falha de
      // conexão", que faria o admin gerar um segundo convite).
      if (!(await recarregarLista())) {
        setErroLista('Convite criado, mas não consegui atualizar o histórico. Recarregue a aba para vê-lo.');
      }
    } catch {
      setError('Falha de conexão.');
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    if (!freshLink) return;
    try {
      await navigator.clipboard.writeText(freshLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('Não foi possível copiar. Selecione o texto manualmente.');
    }
  }

  async function revoke(id: string, identificacao: string) {
    /*
     * Confirmação antes de revogar — mesmo padrão de handleApagarEvento em
     * views/EventsAndAlertsView.tsx.
     *
     * O botão é um ícone de lixeira de 36px ao lado do texto, no celular. Um
     * toque errado invalidava para sempre o link que o admin acabou de mandar
     * para alguém, sem aviso e sem desfazer — a pessoa convidada só descobria
     * ao tentar entrar.
     */
    if (!confirm(`Revogar o convite de ${identificacao}? O link para de funcionar na hora e não dá para desfazer.`)) {
      return;
    }
    setErroRevogar(null);
    try {
      const res = await fetch(`/api/admin/invites/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErroRevogar({ id, msg: data.error ?? 'Não foi possível revogar.' });
        return;
      }
      // Revogou, mas o cartão ainda diz "aberto" se a releitura falhar: dizer.
      if (!(await recarregarLista())) {
        setErroRevogar({
          id,
          msg: 'Convite revogado, mas não consegui atualizar o histórico. Recarregue a aba.',
        });
      }
    } catch {
      setErroRevogar({ id, msg: 'Falha de conexão. O convite pode não ter sido revogado.' });
    }
  }

  const inputClass =
    'w-full p-3 rounded-xl bg-[#1E293B] border border-slate-700 text-white ' +
    'font-semibold text-base focus:outline-none focus:border-cyan-400';

  return (
    // Este componente só existe como aba dentro de AdminDashboard, que já tem seu
    // próprio <main> rolável (.app-scroll) e cabeçalho com "Voltar ao app" + nome
    // do admin. Um <main>/<header> próprios aqui duplicavam os dois na tela toda
    // vez que a aba "Convites" ficava ativa — por isso saíram.
    <div className="w-full space-y-5">
        {/* O CARD é que tem largura máxima, não a aba inteira.
            Antes o container da aba era `max-w-md`, enquanto Chamados era
            `max-w-2xl` e Monitoramento ia até o fim: trocar de aba fazia o
            conteúdo pular de largura dentro do mesmo painel. Agora as três
            abas ocupam a mesma coluna e só este formulário — dois campos —
            se limita, para os inputs não esticarem 900px no desktop. */}
        <form onSubmit={generate} className="w-full max-w-md space-y-3 p-4 rounded-2xl bg-[#0B132B] border border-slate-800">
          <h2 className="font-bold text-sm">Gerar novo link</h2>

          <div>
            <label htmlFor="inv-email" className="block text-xs font-bold text-slate-300 mb-1.5">
              Email do velejador <span className="text-slate-500 font-normal">(opcional)</span>
            </label>
            <input
              id="inv-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="velejador@exemplo.com"
              className={inputClass}
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Se preenchido, o link só funciona para este email. Mais seguro contra repasse.
            </p>
          </div>

          <div>
            <label htmlFor="inv-note" className="block text-xs font-bold text-slate-300 mb-1.5">
              Anotação <span className="text-slate-500 font-normal">(opcional)</span>
            </label>
            <input
              id="inv-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex: João da escola de kite"
              className={inputClass}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-emerald-500 text-slate-950 font-black text-sm flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Link2 size={16} aria-hidden="true" />
            {loading ? 'Gerando...' : 'Gerar link de convite'}
          </button>
        </form>

        {freshLink && (
          <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/40 space-y-3">
            <p className="flex items-start gap-2 text-xs text-amber-300 font-bold">
              <TriangleAlert size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
              Copie agora. Este link não pode ser recuperado depois.
            </p>
            <p className="p-3 rounded-xl bg-slate-950 text-cyan-300 text-[11px] font-mono break-all">
              {freshLink}
            </p>
            <button
              type="button"
              onClick={copyLink}
              className="w-full py-3 rounded-xl bg-emerald-500 text-slate-950 font-black text-sm flex items-center justify-center gap-2"
            >
              {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              {copied ? 'Copiado' : 'Copiar link'}
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-sm font-semibold">
            {error}
          </p>
        )}

        <section className="space-y-2">
          <h2 className="font-bold text-sm px-1">Histórico</h2>

          {erroLista && (
            <p role="alert" className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-sm font-semibold">
              {erroLista}
            </p>
          )}

          {invites.length === 0 && !erroLista && (
            <p className="text-sm text-slate-500 px-1 py-4">Nenhum convite gerado ainda.</p>
          )}

          {invites.map((inv) => (
            <article
              key={inv.id}
              className="p-3.5 rounded-2xl bg-[#0B132B] border border-slate-800 flex flex-wrap items-start gap-3"
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-black border uppercase ${STATUS_STYLE[inv.status]}`}
                  >
                    {inv.status}
                  </span>
                  {inv.usedByName && (
                    <span className="text-xs text-slate-300 font-bold truncate">
                      {inv.usedByName}
                    </span>
                  )}
                </div>
                {inv.email && <p className="text-xs text-slate-400 truncate">{inv.email}</p>}
                {inv.note && <p className="text-xs text-slate-500 truncate">{inv.note}</p>}
                <p className="text-[11px] text-slate-500">
                  {inv.status === 'aberto'
                    ? `Expira ${new Date(inv.expiresAt).toLocaleDateString('pt-BR')}`
                    : inv.usedAt
                      ? `Usado ${new Date(inv.usedAt).toLocaleDateString('pt-BR')}`
                      : `Expirou ${new Date(inv.expiresAt).toLocaleDateString('pt-BR')}`}
                </p>
              </div>

              {inv.status === 'aberto' && (
                <button
                  type="button"
                  onClick={() => revoke(inv.id, inv.email || inv.note || 'sem identificação')}
                  aria-label="Revogar convite"
                  className="p-2 rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/30 shrink-0"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              )}

              {erroRevogar?.id === inv.id && (
                <p
                  role="alert"
                  className="basis-full p-2 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs font-semibold"
                >
                  {erroRevogar.msg}
                </p>
              )}
            </article>
          ))}
        </section>
    </div>
  );
}
