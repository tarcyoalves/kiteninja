'use client';

import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  applyAppUpdate,
  clearAppUpdateAvailable,
  detectarNovoCommit,
  dismissAppUpdate,
  limparParametroDeAtualizacao,
  markAppUpdateAvailable,
  podeAtualizarSozinho,
  resultadoDaAtualizacao,
  useAppUpdateAvailable,
  useAppUpdateCommit,
} from '../lib/appUpdate';
import { RefreshCw, Sparkles, X } from 'lucide-react';
import { useDownwind } from '../context/DownwindContext';
import { useKiteData } from '../context/KiteDataContext';

/** O resultado não muda durante a vida da página: a URL do carregamento é fixa. */
function assinarNada(): () => void {
  return () => {};
}

interface VersionInfo {
  commit: string;
}

export const UpdateNotificationBanner: React.FC = () => {
  const { downwindAtivo } = useDownwind();
  const { myActiveSos, isLoggerOpen, isNewPostOpen } = useKiteData();
  const temAtualizacao = useAppUpdateAvailable();
  const commitDisponivel = useAppUpdateCommit();
  const [atualizando, setAtualizando] = useState(false);
  const commitDoBundle = process.env.NEXT_PUBLIC_BUILD_COMMIT;

  /*
   * A tentativa anterior deu certo? Sem esta checagem não havia como saber: o
   * app recarregava e torcia, e se o WebView entregasse a versão antiga assim
   * mesmo, o aviso voltava em 60 s num laço silencioso.
   *
   * Via `useSyncExternalStore` e não `useState`: a resposta depende de
   * `window.location`, que não existe no servidor. Um inicializador de
   * `useState` roda também no SSR e devolveria `false` lá contra `true` aqui —
   * divergência de hidratação. O snapshot do servidor é explicitamente
   * `false`, e o valor real entra no primeiro quadro do cliente.
   */
  const falhouAoAtualizar = useSyncExternalStore(
    assinarNada,
    () => resultadoDaAtualizacao(window.location.search, process.env.NEXT_PUBLIC_BUILD_COMMIT) === 'falhou',
    () => false
  );

  const checarVersao = useCallback(async () => {
    try {
      const res = await fetch(`/api/version?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          Pragma: 'no-cache',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      });
      if (!res.ok) return;

      const data = (await res.json()) as VersionInfo;
      const novoCommit = detectarNovoCommit(commitDoBundle, data.commit);
      if (novoCommit) {
        markAppUpdateAvailable(novoCommit);
      } else {
        // Remove inclusive um alerta falso deixado por um update do Service
        // Worker quando o código aberto já é o mesmo que está em produção.
        clearAppUpdateAvailable();
      }
    } catch {
      // Falha temporária de rede não significa que existe atualização.
    }
  }, [commitDoBundle]);

  const aplicarAtualizacao = useCallback(async () => {
    setAtualizando(true);
    await applyAppUpdate();
  }, []);

  /*
   * ATUALIZAÇÃO SOZINHA — o ponto desta tela.
   *
   * Antes o aviso só avisava. Quem ignorasse o popup, ou o fechasse no X (que
   * grava a dispensa em localStorage), ficava na versão antiga por tempo
   * indefinido. Quando a versão nova conserta um SOS que não escala ou um
   * downwind que não registra, "o usuário decide quando atualizar" é o mesmo
   * que "não atualiza".
   *
   * Só acontece quando não há nada a perder e ninguém está olhando — ver
   * `podeAtualizarSozinho`. Na prática: o app foi para o segundo plano, e
   * quando a pessoa voltar já encontra a versão nova.
   */
  useEffect(() => {
    if (!temAtualizacao || atualizando) return;

    const tentarSozinho = () => {
      const seguro = podeAtualizarSozinho({
        temDownwindAtivo: Boolean(downwindAtivo),
        temSosAtivo: Boolean(myActiveSos),
        temModalAberto: isLoggerOpen || isNewPostOpen,
        appVisivel: !document.hidden,
      });
      if (seguro) void applyAppUpdate();
    };

    document.addEventListener('visibilitychange', tentarSozinho);
    return () => document.removeEventListener('visibilitychange', tentarSozinho);
  }, [temAtualizacao, atualizando, downwindAtivo, myActiveSos, isLoggerOpen, isNewPostOpen]);

  /*
   * O `__app_update` cumpriu o papel de furar o cache neste carregamento e não
   * pode ficar na barra de endereço: o app compartilha links (o convite de
   * downwind é `/?dw_invite=…`) e o parâmetro viajaria junto.
   */
  useEffect(() => {
    limparParametroDeAtualizacao();
  }, []);

  useEffect(() => {
    // O SW cuida apenas de push. `updatefound` não identifica versão do app e
    // não pode acender o banner: o arquivo pode reinstalar sem mudança de código.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
    }

    const timeoutInicial = window.setTimeout(checarVersao, 3000);
    const intervalo = window.setInterval(() => {
      if (!document.hidden) checarVersao();
    }, 60000);

    const onAppVisivel = () => {
      if (!document.hidden) checarVersao();
    };

    document.addEventListener('visibilitychange', onAppVisivel);
    window.addEventListener('focus', onAppVisivel);

    return () => {
      window.clearTimeout(timeoutInicial);
      window.clearInterval(intervalo);
      document.removeEventListener('visibilitychange', onAppVisivel);
      window.removeEventListener('focus', onAppVisivel);
    };
  }, [checarVersao]);

  // Nunca interrompe o velejador durante um downwind ativo.
  if (downwindAtivo) return null;

  /*
   * A atualização foi pedida e o app voltou com a versão antiga. Insistir no
   * mesmo botão só repetiria o laço; o que resolve no WebView do Android é
   * fechar o app de vez e abrir de novo.
   */
  if (falhouAoAtualizar && !temAtualizacao) {
    return (
      <div className="fixed top-2.5 inset-x-3 z-splash flex justify-center pointer-events-none animate-in slide-in-from-top-4 duration-300">
        <div className="pointer-events-auto max-w-md w-full bg-[#0B1220]/95 border border-amber-400/50 rounded-2xl p-3 shadow-xl backdrop-blur-xl text-slate-100">
          <p className="text-xs font-black text-amber-200">Não foi possível atualizar</p>
          <p className="mt-0.5 text-[10px] text-amber-100/80 leading-snug">
            Feche o app completamente e abra de novo para carregar a versão nova.
          </p>
        </div>
      </div>
    );
  }

  if (!temAtualizacao) return null;

  return (
    <div className="fixed top-2.5 inset-x-3 z-splash flex justify-center pointer-events-none animate-in slide-in-from-top-4 duration-300">
      <div className="pointer-events-auto max-w-md w-full bg-[#0B1220]/95 border border-cyan-400/50 rounded-2xl p-3 shadow-[0_10px_30px_rgba(34,211,238,0.25)] backdrop-blur-xl flex items-center justify-between gap-3 text-slate-100 ring-1 ring-cyan-500/20">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-full bg-cyan-400/20 text-cyan-300 flex items-center justify-center shrink-0 border border-cyan-400/40 animate-pulse">
            <Sparkles size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black text-white leading-tight flex items-center gap-1.5">
              <span>Nova versão disponível!</span>
            </p>
            <p className="text-[10px] text-cyan-200/80 truncate">
              Toque para carregar as últimas melhorias
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={aplicarAtualizacao}
            disabled={atualizando}
            className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-cyan-400 via-cyan-500 to-blue-600 hover:from-cyan-300 hover:to-blue-500 text-slate-950 font-black text-xs shadow-md shadow-cyan-500/30 active:scale-95 transition-all flex items-center gap-1.5"
          >
            <RefreshCw size={13} className={atualizando ? 'animate-spin' : ''} />
            <span>{atualizando ? 'Atualizando…' : 'Atualizar'}</span>
          </button>
          <button
            type="button"
            onClick={() => dismissAppUpdate(commitDisponivel)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 active:scale-95 transition-all"
            aria-label="Dispensar aviso desta versão"
            title="Lembrar apenas na próxima versão"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};
