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
} from 'lucide-react';
import { VideoTrimmer, type TrechoVideo } from '../../components/VideoTrimmer';
import {
  erroDoTrecho,
  MAX_BYTES_VIDEO,
  MAX_TRECHO_SEG,
  TIPOS_VIDEO_ACEITOS,
} from '../../lib/introVideo';

/**
 * Vídeo de abertura do app: upload, escolha do trecho e liga/desliga.
 *
 * O corte não re-encoda o arquivo — guardamos os pontos de entrada e saída como
 * metadado e o player toca só aquele intervalo. Assim dá para reajustar o corte
 * depois sem subir o vídeo de novo, e não dependemos de ffmpeg no servidor
 * (indisponível em função serverless).
 */

interface VideoSalvo {
  url?: string;
  inicioSeg?: number;
  fimSeg?: number;
  posterDataUrl?: string;
  nomeArquivo?: string;
  duracaoSeg?: number;
  ativo: boolean;
}

export const IntroVideoManager: React.FC = () => {
  const [salvo, setSalvo] = useState<VideoSalvo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Estado do arquivo novo, antes de enviar.
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [urlLocal, setUrlLocal] = useState<string | null>(null);
  const [trecho, setTrecho] = useState<TrechoVideo>({ inicioSeg: 0, fimSeg: 6 });
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState(0);

  // Trecho do vídeo já salvo, para reajuste sem novo upload.
  const [trechoSalvo, setTrechoSalvo] = useState<TrechoVideo | null>(null);
  const [salvandoTrecho, setSalvandoTrecho] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void carregar();
  }, []);

  // A URL de objeto é liberada ao trocar de arquivo; sem isso o vídeo anterior
  // fica retido na memória da aba.
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
      const data = (await res.json()) as { video: VideoSalvo | null };
      setSalvo(data.video);
      if (data.video?.url) {
        setTrechoSalvo({
          inicioSeg: data.video.inicioSeg ?? 0,
          fimSeg: data.video.fimSeg ?? 6,
        });
      } else {
        setTrechoSalvo(null);
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

    // Validamos aqui e no servidor: aqui é para o admin não esperar um upload
    // de 12MB só para receber a recusa no fim.
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
    setTrecho({ inicioSeg: 0, fimSeg: 6 });
  }

  /**
   * Captura um quadro do trecho para servir de poster. Sem isso o vídeo mostra
   * um retângulo preto enquanto carrega, o que parece falha de carregamento.
   */
  async function capturarPoster(src: string, segundo: number): Promise<string | undefined> {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.src = src;
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';

      const desistir = setTimeout(() => resolve(undefined), 5000);

      v.addEventListener('loadeddata', () => {
        v.currentTime = Math.min(segundo, Math.max(0, v.duration - 0.1));
      });

      // O seek é assíncrono: desenhar antes do `seeked` captura o quadro errado.
      v.addEventListener('seeked', () => {
        try {
          const c = document.createElement('canvas');
          // Largura modesta: o poster é placeholder, e um data URL grande
          // inflaria a linha do banco sem ganho visível.
          const largura = 480;
          c.width = largura;
          c.height = Math.round((v.videoHeight / v.videoWidth) * largura) || 854;
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
        // Ignora caso load não seja suportado em algum browser
      }
    });
  }

  async function enviar() {
    if (!arquivo || !urlLocal) return;

    const problema = erroDoTrecho(trecho.inicioSeg, trecho.fimSeg);
    if (problema) {
      setErro(problema);
      return;
    }

    setEnviando(true);
    setErro(null);
    setAviso(null);
    setProgresso(0);

    try {
      const poster = await capturarPoster(urlLocal, trecho.inicioSeg);

      const form = new FormData();
      form.append('file', arquivo);
      form.append('inicioSeg', String(trecho.inicioSeg));
      form.append('fimSeg', String(trecho.fimSeg));
      if (poster) form.append('posterDataUrl', poster);

      // XHR em vez de fetch: precisamos de progresso, e o upload de vídeo em
      // 4G leva tempo suficiente para uma barra parada parecer travamento.
      const duracao = await duracaoDoArquivo(urlLocal);
      if (duracao > 0) form.append('duracaoSeg', String(duracao));

      await enviarComProgresso(form, setProgresso);

      setAviso('Abertura atualizada. Abra o app em uma aba nova para ver.');
      setArquivo(null);
      if (urlLocal) URL.revokeObjectURL(urlLocal);
      setUrlLocal(null);
      if (inputRef.current) inputRef.current.value = '';
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha no envio.');
    } finally {
      setEnviando(false);
      setProgresso(0);
    }
  }

  async function salvarTrechoExistente() {
    if (!trechoSalvo) return;
    const problema = erroDoTrecho(trechoSalvo.inicioSeg, trechoSalvo.fimSeg);
    if (problema) {
      setErro(problema);
      return;
    }
    setSalvandoTrecho(true);
    setErro(null);
    try {
      const res = await fetch('/api/admin/intro-video', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trechoSalvo),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Falha ao salvar o trecho.');
      setAviso('Trecho atualizado.');
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao salvar.');
    } finally {
      setSalvandoTrecho(false);
    }
  }

  async function alternarAtivo() {
    if (!salvo) return;
    setErro(null);
    try {
      const res = await fetch('/api/admin/intro-video', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo: !salvo.ativo }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Falha ao alternar.');
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao alternar.');
    }
  }

  async function remover() {
    if (!confirm('Remover o vídeo de abertura? O app volta a usar a animação.')) return;
    setErro(null);
    try {
      const res = await fetch('/api/admin/intro-video', { method: 'DELETE' });
      if (!res.ok) throw new Error('Falha ao remover.');
      setSalvo(null);
      setTrechoSalvo(null);
      setAviso('Vídeo removido. A abertura voltou para a animação.');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao remover.');
    }
  }

  if (carregando) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-sm py-8 justify-center">
        <Loader2 size={16} className="animate-spin" />
        Carregando configuração…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
          <Film size={18} className="text-emerald-300" />
        </div>
        <div>
          <h2 className="text-white font-black text-base">Vídeo de abertura</h2>
          <p className="text-xs text-slate-400 leading-relaxed mt-0.5">
            Substitui a animação na primeira tela. Escolha o trecho que vai tocar —
            o arquivo não é recortado, então dá para reajustar depois sem enviar de novo.
          </p>
        </div>
      </header>

      {erro && (
        <p
          role="alert"
          className="flex items-start gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {erro}
        </p>
      )}
      {aviso && (
        <p className="flex items-start gap-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
          {aviso}
        </p>
      )}

      {/* Vídeo já configurado */}
      {salvo?.url && (
        <section className="rounded-2xl bg-[#0F172A] border border-slate-700/80 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <p className="text-xs font-bold text-white truncate">
                {salvo.nomeArquivo || 'abertura'}
              </p>
              <p className="text-[11px] text-slate-400">
                {salvo.ativo ? 'Em uso na abertura' : 'Desativado — o app usa a animação'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={alternarAtivo}
                className="flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 transition-colors"
              >
                {salvo.ativo ? <EyeOff size={13} /> : <Eye size={13} />}
                {salvo.ativo ? 'Desativar' : 'Ativar'}
              </button>
              <button
                onClick={remover}
                className="flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 transition-colors"
              >
                <Trash2 size={13} />
                Remover
              </button>
            </div>
          </div>

          {trechoSalvo && (
            <>
              <VideoTrimmer
                src={salvo.url}
                valorInicial={trechoSalvo}
                onChange={setTrechoSalvo}
                maxSeg={MAX_TRECHO_SEG}
              />
              <button
                onClick={salvarTrechoExistente}
                disabled={salvandoTrecho}
                className="w-full py-2.5 rounded-xl bg-emerald-500 text-[#0B1220] font-black text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {salvandoTrecho && <Loader2 size={14} className="animate-spin" />}
                Salvar trecho
              </button>
            </>
          )}
        </section>
      )}

      {/* Upload de arquivo novo */}
      <section className="rounded-2xl bg-[#0F172A] border border-slate-700/80 p-4 space-y-3">
        <p className="text-xs font-bold text-slate-300">
          {salvo?.url ? 'Trocar por outro vídeo' : 'Enviar vídeo'}
        </p>

        <input
          ref={inputRef}
          type="file"
          accept={TIPOS_VIDEO_ACEITOS.join(',')}
          onChange={escolherArquivo}
          className="block w-full text-xs text-slate-400 file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-slate-800 file:text-emerald-300 hover:file:bg-slate-700 file:cursor-pointer"
        />
        <p className="text-[11px] text-slate-500">
          MP4, WebM ou MOV, até {MAX_BYTES_VIDEO / 1024 / 1024}MB. O trecho pode ter no
          máximo {MAX_TRECHO_SEG}s.
        </p>

        {urlLocal && (
          <>
            <VideoTrimmer
              src={urlLocal}
              valorInicial={trecho}
              onChange={setTrecho}
              maxSeg={MAX_TRECHO_SEG}
            />

            {enviando && (
              <div
                className="h-1.5 rounded-full bg-slate-800 overflow-hidden"
                role="progressbar"
                aria-valuenow={progresso}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Progresso do envio"
              >
                <div
                  className="h-full bg-emerald-400 transition-all"
                  style={{ width: `${progresso}%` }}
                />
              </div>
            )}

            <button
              onClick={enviar}
              disabled={enviando}
              className="w-full py-3 rounded-xl bg-emerald-500 text-[#0B1220] font-black text-sm disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {enviando ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Enviando… {progresso}%
                </>
              ) : (
                <>
                  <Upload size={15} />
                  Enviar e usar como abertura
                </>
              )}
            </button>
          </>
        )}
      </section>
    </div>
  );
};

/** Lê a duração do arquivo local, para o editor reabrir no lugar certo depois. */
function duracaoDoArquivo(src: string): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.src = src;
    const desistir = setTimeout(() => resolve(0), 4000);
    v.addEventListener('loadedmetadata', () => {
      clearTimeout(desistir);
      resolve(Number.isFinite(v.duration) ? v.duration : 0);
    });
    v.addEventListener('error', () => {
      clearTimeout(desistir);
      resolve(0);
    });
  });
}

/**
 * Envia via XHR para ter progresso real. `fetch` não expõe progresso de upload,
 * e uma barra parada num envio de 12MB em 4G parece travamento.
 */
function enviarComProgresso(form: FormData, onProgresso: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/admin/intro-video');
    xhr.withCredentials = true;

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        onProgresso(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      let msg = `Falha no envio (HTTP ${xhr.status}).`;
      try {
        const body = JSON.parse(xhr.responseText) as { error?: string };
        if (body.error) msg = body.error;
      } catch {
        // Resposta não-JSON (proxy, timeout de borda): a mensagem genérica serve.
      }
      reject(new Error(msg));
    });

    xhr.addEventListener('error', () =>
      reject(new Error('Conexão interrompida durante o envio.'))
    );
    xhr.addEventListener('abort', () => reject(new Error('Envio cancelado.')));

    xhr.send(form);
  });
}
