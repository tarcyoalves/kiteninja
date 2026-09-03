'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Film,
  Upload,
  Trash2,
  Eye,
  EyeOff,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Play,
  Pause,
  Shuffle,
  Repeat,
  Plus,
  Link as LinkIcon,
  Scissors,
} from 'lucide-react';
import { upload } from '@vercel/blob/client';
import { VideoTrimmer, type TrechoVideo, formatarSegundos } from '../../components/VideoTrimmer';
import {
  erroDoTrecho,
  extensaoDeVideo,
  MAX_BYTES_VIDEO,
  MAX_TRECHO_SEG,
  TIPOS_VIDEO_ACEITOS,
  type IntroVideo,
  type IntroVideoConfig,
  type ModoRodizio,
} from '../../lib/introVideo';

export const IntroVideoManager: React.FC = () => {
  const [config, setConfig] = useState<IntroVideoConfig>({ modo: 'rodizio', videos: [] });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Modo de inclusão: 'arquivo' | 'url'
  const [abaInclusao, setAbaInclusao] = useState<'arquivo' | 'url'>('arquivo');
  const [urlDireta, setUrlDireta] = useState('');
  const [tituloVideo, setTituloVideo] = useState('');

  // Arquivo selecionado para upload
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [urlLocal, setUrlLocal] = useState<string | null>(null);
  const [trechoNovo, setTrechoNovo] = useState<TrechoVideo>({ inicioSeg: 0, fimSeg: 6 });
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState(0);

  // Vídeo atualmente sendo editado/recortado na galeria
  const [editandoVideo, setEditandoVideo] = useState<IntroVideo | null>(null);
  const [trechoEdicao, setTrechoEdicao] = useState<TrechoVideo>({ inicioSeg: 0, fimSeg: 6 });
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);

  // Pré-visualização na galeria
  const [previewId, setPreviewId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void carregar();
  }, []);

  useEffect(() => {
    return () => {
      if (urlLocal) URL.revokeObjectURL(urlLocal);
    };
  }, [urlLocal]);

  async function carregar() {
    setCarregando(true);
    try {
      const res = await fetch('/api/admin/intro-video', { cache: 'no-store' });
      if (!res.ok) throw new Error('Não foi possível ler a configuração.');
      const data = (await res.json()) as { config?: IntroVideoConfig; video?: IntroVideo };
      if (data.config) {
        setConfig(data.config);
      } else if (data.video) {
        setConfig({ modo: 'rodizio', videos: [data.video] });
      }
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar.');
    } finally {
      setCarregando(false);
    }
  }

  function escolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;

    if (!TIPOS_VIDEO_ACEITOS.includes(f.type as (typeof TIPOS_VIDEO_ACEITOS)[number])) {
      setErro(`Formato "${f.type || 'desconhecido'}" não suportado. Use MP4, WebM ou MOV.`);
      return;
    }
    if (f.size > MAX_BYTES_VIDEO) {
      setErro(
        `Vídeo de ${(f.size / 1024 / 1024).toFixed(1)}MB excede o limite de ${
          MAX_BYTES_VIDEO / 1024 / 1024
        }MB.`
      );
      return;
    }

    if (urlLocal) URL.revokeObjectURL(urlLocal);
    setErro(null);
    setAviso(null);
    setArquivo(f);
    setUrlLocal(URL.createObjectURL(f));
    setTituloVideo(f.name.replace(/\.[^/.]+$/, ''));
    setTrechoNovo({ inicioSeg: 0, fimSeg: 6 });
  }

  async function capturarPoster(src: string, segundo: number): Promise<string | undefined> {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.src = src;
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';

      const desistir = setTimeout(() => resolve(undefined), 4000);

      v.addEventListener('loadeddata', () => {
        v.currentTime = Math.min(segundo, Math.max(0, v.duration - 0.1));
      });

      v.addEventListener('seeked', () => {
        try {
          const c = document.createElement('canvas');
          const largura = 480;
          c.width = largura;
          c.height = Math.round((v.videoHeight / (v.videoWidth || 1)) * largura) || 854;
          const ctx = c.getContext('2d');
          if (!ctx) {
            resolve(undefined);
            return;
          }
          ctx.drawImage(v, 0, 0, c.width, c.height);
          clearTimeout(desistir);
          resolve(c.toDataURL('image/jpeg', 0.6));
        } catch {
          clearTimeout(desistir);
          resolve(undefined);
        }
      });

      v.addEventListener('error', () => {
        clearTimeout(desistir);
        resolve(undefined);
      });

      try {
        v.load();
      } catch {
        // ignore
      }
    });
  }

  async function duracaoDoArquivo(src: string): Promise<number> {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.src = src;
      v.preload = 'metadata';
      const desistir = setTimeout(() => resolve(0), 4000);
      v.onloadedmetadata = () => {
        clearTimeout(desistir);
        resolve(v.duration && isFinite(v.duration) ? v.duration : 0);
      };
      v.onerror = () => {
        clearTimeout(desistir);
        resolve(0);
      };
    });
  }

  /**
   * Registra a URL final do vídeo na playlist (caminho JSON, pequeno). Serve
   * tanto para uma URL externa colada pelo admin quanto para a URL que o
   * Blob devolveu depois do upload direto do navegador — ver o comentário
   * grande em app/api/admin/intro-video/route.ts sobre por que o registro é
   * um passo separado do upload em si.
   */
  async function registrarNaPlaylist(payload: {
    url: string;
    inicioSeg: number;
    fimSeg: number;
    titulo: string;
    duracaoSeg?: number;
    posterDataUrl?: string;
    nomeArquivo?: string;
  }): Promise<void> {
    const res = await fetch('/api/admin/intro-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, ativo: true }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(data.error || 'Falha ao cadastrar vídeo.');
  }

  // Upload com progresso: o arquivo vai DIRETO do navegador para o Vercel
  // Blob (a Vercel limita o corpo de uma requisição de função serverless a
  // 4,5MB — um vídeo de poucos segundos já ultrapassa isso, então ele nunca
  // pode passar pela nossa API). Só a URL final, pequena, vai para a rota.
  async function enviarArquivo() {
    if (!arquivo || !urlLocal) return;

    const problema = erroDoTrecho(trechoNovo.inicioSeg, trechoNovo.fimSeg);
    if (problema) {
      setErro(problema);
      return;
    }

    setEnviando(true);
    setErro(null);
    setAviso(null);
    setProgresso(0);

    try {
      const poster = await capturarPoster(urlLocal, trechoNovo.inicioSeg);
      const duracao = await duracaoDoArquivo(urlLocal);

      const ext = extensaoDeVideo(arquivo.type);
      const resultado = await upload(`intro/abertura-${Date.now()}.${ext}`, arquivo, {
        access: 'public',
        contentType: arquivo.type,
        handleUploadUrl: '/api/admin/intro-video',
        onUploadProgress: (ev) => setProgresso(Math.round(ev.percentage)),
      });

      await registrarNaPlaylist({
        url: resultado.url,
        inicioSeg: trechoNovo.inicioSeg,
        fimSeg: trechoNovo.fimSeg,
        titulo: tituloVideo.trim() || arquivo.name,
        duracaoSeg: duracao > 0 ? duracao : undefined,
        posterDataUrl: poster,
        nomeArquivo: arquivo.name,
      });

      setAviso('Vídeo adicionado à playlist com sucesso!');
      setArquivo(null);
      if (urlLocal) URL.revokeObjectURL(urlLocal);
      setUrlLocal(null);
      setTituloVideo('');
      if (inputRef.current) inputRef.current.value = '';
      await carregar();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha no envio.';
      // upload() do @vercel/blob/client não repassa o corpo JSON de erro da
      // nossa rota quando a emissão do token falha — só um erro genérico.
      // Isso acontece sobretudo quando falta BLOB_READ_WRITE_TOKEN (a rota
      // devolve 503 com mensagem clara, mas essa mensagem não chega até
      // aqui), então damos uma pista melhor que "Failed to..." cru.
      setErro(
        /retrieve the client token/i.test(msg)
          ? 'Falha ao autorizar o envio. Confira se sua sessão de admin ainda está ativa e se o armazenamento de vídeo (Vercel Blob) está configurado no ambiente.'
          : msg
      );
    } finally {
      setEnviando(false);
      setProgresso(0);
    }
  }

  // Cadastro por URL direta
  async function cadastrarUrlDireta() {
    const url = urlDireta.trim();
    if (!url.startsWith('https://')) {
      setErro('A URL deve começar com https://');
      return;
    }

    const problema = erroDoTrecho(trechoNovo.inicioSeg, trechoNovo.fimSeg);
    if (problema) {
      setErro(problema);
      return;
    }

    setEnviando(true);
    setErro(null);
    setAviso(null);

    try {
      await registrarNaPlaylist({
        url,
        inicioSeg: trechoNovo.inicioSeg,
        fimSeg: trechoNovo.fimSeg,
        titulo: tituloVideo.trim() || 'Vídeo Externo',
      });

      setAviso('Vídeo externo cadastrado na playlist com sucesso!');
      setUrlDireta('');
      setTituloVideo('');
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao cadastrar.');
    } finally {
      setEnviando(false);
    }
  }

  // Alterna modo de rodízio
  async function alterarModo(novoModo: ModoRodizio) {
    setErro(null);
    try {
      const res = await fetch('/api/admin/intro-video', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modo: novoModo }),
      });
      if (!res.ok) throw new Error('Falha ao atualizar modo.');
      setConfig((prev) => ({ ...prev, modo: novoModo }));
      setAviso(`Modo alterado para ${novoModo === 'rodizio' ? 'Rodízio Sequencial' : novoModo === 'aleatorio' ? 'Aleatório' : 'Único'}.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao mudar modo.');
    }
  }

  // Alterna status ativo de um vídeo
  async function alternarStatusVideo(v: IntroVideo) {
    setErro(null);
    try {
      const res = await fetch('/api/admin/intro-video', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: v.id || v.url, ativo: !v.ativo }),
      });
      if (!res.ok) throw new Error('Falha ao alternar status.');
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao alterar.');
    }
  }

  // Salva edição de corte de um vídeo existente
  async function salvarTrechoEdicao() {
    if (!editandoVideo) return;
    const problema = erroDoTrecho(trechoEdicao.inicioSeg, trechoEdicao.fimSeg);
    if (problema) {
      setErro(problema);
      return;
    }

    setSalvandoEdicao(true);
    setErro(null);
    try {
      const res = await fetch('/api/admin/intro-video', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editandoVideo.id || editandoVideo.url,
          inicioSeg: trechoEdicao.inicioSeg,
          fimSeg: trechoEdicao.fimSeg,
        }),
      });
      if (!res.ok) throw new Error('Falha ao atualizar corte.');
      setAviso('Corte do vídeo atualizado com sucesso!');
      setEditandoVideo(null);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao salvar.');
    } finally {
      setSalvandoEdicao(false);
    }
  }

  // Remove um vídeo da playlist
  async function excluirVideo(v: IntroVideo) {
    if (!confirm(`Deseja realmente remover o vídeo "${v.titulo || v.nomeArquivo || 'selecionado'}" da playlist?`)) {
      return;
    }

    setErro(null);
    try {
      const res = await fetch(`/api/admin/intro-video?id=${encodeURIComponent(v.id || v.url)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Falha ao excluir vídeo.');
      setAviso('Vídeo removido da playlist.');
      if (editandoVideo?.id === v.id) setEditandoVideo(null);
      if (previewId === v.id) setPreviewId(null);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao excluir.');
    }
  }

  const videosAtivos = config.videos.filter((v) => v.ativo).length;

  return (
    <div className="space-y-6">
      {/* Header Informativo */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-900/60 p-4 rounded-2xl border border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Film className="text-cyan-400" size={20} />
            <h2 className="text-lg font-black text-white">Vídeos de Abertura & Playlist</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Cadastre múltiplos vídeos em alta resolução (até 50MB) para criar um rodízio automático na abertura do app.
          </p>
        </div>

        {/* Seletor de Modo de Exibição */}
        <div className="flex items-center gap-1.5 bg-slate-800 p-1.5 rounded-xl border border-slate-700 w-full sm:w-auto">
          <button
            onClick={() => alterarModo('rodizio')}
            className={`flex-1 sm:flex-none justify-center px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              config.modo === 'rodizio'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Alterna os vídeos sequencialmente a cada abertura"
          >
            <Repeat size={13} />
            <span>Rodízio</span>
          </button>
          <button
            onClick={() => alterarModo('aleatorio')}
            className={`flex-1 sm:flex-none justify-center px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              config.modo === 'aleatorio'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Sorteia um vídeo diferente a cada abertura"
          >
            <Shuffle size={13} />
            <span>Aleatório</span>
          </button>
        </div>
      </div>

      {/* Alertas */}
      {erro && (
        <div className="flex items-center gap-2 p-3.5 bg-red-950/40 border border-red-500/40 rounded-xl text-red-300 text-xs font-medium">
          <AlertTriangle size={16} className="text-red-400 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {aviso && (
        <div className="flex items-center gap-2 p-3.5 bg-emerald-950/40 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs font-medium">
          <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
          <span>{aviso}</span>
        </div>
      )}

      {/* Galeria de Vídeos Cadastrados */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <span>Galeria de Vídeos</span>
            <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 text-xs font-mono font-bold">
              {videosAtivos} ativos / {config.videos.length} total
            </span>
          </h3>
        </div>

        {carregando ? (
          <div className="flex items-center justify-center p-8 bg-slate-900/40 rounded-2xl border border-slate-800">
            <Loader2 className="animate-spin text-cyan-400" size={24} />
          </div>
        ) : config.videos.length === 0 ? (
          <div className="p-8 text-center bg-slate-900/40 rounded-2xl border border-dashed border-slate-800 space-y-2">
            <Film className="mx-auto text-slate-600" size={32} />
            <p className="text-sm font-bold text-slate-300">Nenhum vídeo cadastrado na playlist</p>
            <p className="text-xs text-slate-500">
              Faça o upload do seu primeiro vídeo abaixo para substituir a animação padrão.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {config.videos.map((v, index) => (
              <div
                key={v.id || index}
                className={`p-3.5 rounded-2xl border transition-all space-y-3 ${
                  v.ativo
                    ? 'bg-slate-900/80 border-slate-700/80 hover:border-cyan-500/50'
                    : 'bg-slate-950/60 border-slate-800 opacity-60'
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* Thumbnail / Player */}
                  <div className="relative w-24 h-16 bg-black rounded-xl overflow-hidden shrink-0 border border-slate-800">
                    {previewId === v.id ? (
                      <video
                        src={v.url}
                        autoPlay
                        muted
                        playsInline
                        className="w-full h-full object-cover"
                        onTimeUpdate={(e) => {
                          const el = e.currentTarget;
                          if (el.currentTime >= v.fimSeg) {
                            el.currentTime = v.inicioSeg;
                          }
                        }}
                      />
                    ) : v.posterDataUrl ? (
                      <img src={v.posterDataUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-slate-800 text-slate-500">
                        <Film size={18} />
                      </div>
                    )}

                    <button
                      onClick={() => setPreviewId(previewId === v.id ? null : v.id || null)}
                      className="absolute inset-0 m-auto w-8 h-8 rounded-full bg-cyan-500/90 text-slate-950 flex items-center justify-center shadow-lg active:scale-95 transition-all"
                      title={previewId === v.id ? 'Parar prévia' : 'Pré-visualizar'}
                    >
                      {previewId === v.id ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
                    </button>
                  </div>

                  {/* Informações */}
                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs font-bold text-white break-words">
                      {v.titulo || v.nomeArquivo || `Vídeo #${index + 1}`}
                    </h4>
                    <p className="text-[11px] font-mono text-cyan-300 mt-0.5">
                      Corte: {formatarSegundos(v.inicioSeg)} - {formatarSegundos(v.fimSeg)} ({formatarSegundos(v.fimSeg - v.inicioSeg)})
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          v.ativo ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-400'
                        }`}
                      >
                        {v.ativo ? 'Ativo no App' : 'Desativado'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Ações do Vídeo */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
                  <button
                    onClick={() => alternarStatusVideo(v)}
                    className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1.5 transition-colors ${
                      v.ativo
                        ? 'text-amber-400 hover:bg-amber-500/10'
                        : 'text-emerald-400 hover:bg-emerald-500/10'
                    }`}
                  >
                    {v.ativo ? <EyeOff size={13} /> : <Eye size={13} />}
                    <span>{v.ativo ? 'Desativar' : 'Ativar'}</span>
                  </button>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        setEditandoVideo(v);
                        setTrechoEdicao({ inicioSeg: v.inicioSeg, fimSeg: v.fimSeg });
                      }}
                      className="px-2.5 py-1 rounded-lg font-bold text-cyan-400 hover:bg-cyan-500/10 flex items-center gap-1"
                      title="Reajustar corte"
                    >
                      <Scissors size={13} />
                      <span>Editar Corte</span>
                    </button>

                    <button
                      onClick={() => excluirVideo(v)}
                      className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Excluir vídeo da galeria"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal / Painel de Edição de Corte de Vídeo Existente */}
      {editandoVideo && (
        <div className="p-4 bg-slate-900 rounded-2xl border border-cyan-500/50 space-y-3 shadow-2xl">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-cyan-300 flex items-center gap-2">
              <Scissors size={15} />
              <span>Ajustar Corte: {editandoVideo.titulo || editandoVideo.nomeArquivo}</span>
            </h3>
            <button
              onClick={() => setEditandoVideo(null)}
              className="text-xs text-slate-400 hover:text-white"
            >
              Cancelar
            </button>
          </div>

          <VideoTrimmer
            src={editandoVideo.url}
            valorInicial={trechoEdicao}
            onChange={(novo) => setTrechoEdicao(novo)}
            maxSeg={MAX_TRECHO_SEG}
          />

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setEditandoVideo(null)}
              className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold hover:bg-slate-700"
            >
              Fechar
            </button>
            <button
              onClick={salvarTrechoEdicao}
              disabled={salvandoEdicao}
              className="px-4 py-2 rounded-xl bg-cyan-500 text-slate-950 text-xs font-black hover:bg-cyan-400 disabled:opacity-50 flex items-center gap-1.5"
            >
              {salvandoEdicao ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              <span>Salvar Novo Corte</span>
            </button>
          </div>
        </div>
      )}

      {/* Seção Adicionar Novo Vídeo */}
      <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-4 space-y-4">
        {/* `flex-wrap` + `w-full sm:w-auto`: o título e os dois botões
            ("Upload (até 50MB)" e "Link / URL Direta") somam bem mais que a
            largura de um celular. Num `justify-between` sem quebra isso
            empurrava a página inteira para o lado. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2 min-w-0">
            <Plus size={16} className="text-cyan-400 shrink-0" />
            <span>Adicionar Novo Vídeo à Playlist</span>
          </h3>

          <div className="flex items-center gap-1 bg-slate-800 p-1 rounded-xl w-full sm:w-auto">
            <button
              onClick={() => setAbaInclusao('arquivo')}
              className={`flex-1 sm:flex-none px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                abaInclusao === 'arquivo' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'
              }`}
            >
              Upload (até 50MB)
            </button>
            <button
              onClick={() => setAbaInclusao('url')}
              className={`flex-1 sm:flex-none px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                abaInclusao === 'url' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'
              }`}
            >
              Link / URL Direta
            </button>
          </div>
        </div>

        {abaInclusao === 'arquivo' ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-300">Título / Descrição do Vídeo:</label>
              <input
                type="text"
                placeholder="Ex: Sessão em Ponta do Mel - Pôr do Sol"
                value={tituloVideo}
                onChange={(e) => setTituloVideo(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-700 hover:border-cyan-500/60 rounded-2xl bg-slate-950/40 text-center transition-colors">
              <Upload size={28} className="text-cyan-400 mb-2" />
              <p className="text-xs font-bold text-white">Escolha um vídeo em alta qualidade</p>
              <p className="text-[11px] text-slate-400 mt-0.5">MP4, WebM ou MOV (Full HD / 4K nativo até 50MB)</p>
              <input
                ref={inputRef}
                type="file"
                accept={TIPOS_VIDEO_ACEITOS.join(',')}
                onChange={escolherArquivo}
                className="hidden"
                id="novo-video-upload"
              />
              <label
                htmlFor="novo-video-upload"
                className="mt-3 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-bold cursor-pointer transition-all border border-slate-700"
              >
                Selecionar Arquivo
              </label>
            </div>

            {urlLocal && (
              <div className="space-y-3 pt-2">
                <VideoTrimmer
                  src={urlLocal}
                  valorInicial={trechoNovo}
                  onChange={(novo) => setTrechoNovo(novo)}
                  maxSeg={MAX_TRECHO_SEG}
                />

                {enviando && progresso > 0 && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-cyan-300 font-bold">
                      <span>Enviando em alta definição...</span>
                      <span>{progresso}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-cyan-500 transition-all duration-200"
                        style={{ width: `${progresso}%` }}
                      />
                    </div>
                  </div>
                )}

                <button
                  onClick={enviarArquivo}
                  disabled={enviando}
                  className="w-full py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 disabled:opacity-50"
                >
                  {enviando ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                  <span>{enviando ? 'Processando envio...' : 'Adicionar Vídeo à Playlist'}</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-300">Título do Vídeo:</label>
              <input
                type="text"
                placeholder="Ex: Kite Foil em Tibau - 4K"
                value={tituloVideo}
                onChange={(e) => setTituloVideo(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-300">URL Direta do Vídeo (HTTPS MP4/WebM):</label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <LinkIcon size={14} className="absolute left-3 top-3 text-slate-500" />
                  <input
                    type="url"
                    placeholder="https://meu-cdn.com/videos/abertura-fullhd.mp4"
                    value={urlDireta}
                    onChange={(e) => setUrlDireta(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>
            </div>

            {urlDireta.trim().startsWith('https://') && (
              <div className="space-y-3 pt-2">
                <VideoTrimmer
                  src={urlDireta.trim()}
                  valorInicial={trechoNovo}
                  onChange={(novo) => setTrechoNovo(novo)}
                  maxSeg={MAX_TRECHO_SEG}
                />

                <button
                  onClick={cadastrarUrlDireta}
                  disabled={enviando}
                  className="w-full py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 disabled:opacity-50"
                >
                  {enviando ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  <span>Cadastrar Vídeo Externo na Playlist</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
