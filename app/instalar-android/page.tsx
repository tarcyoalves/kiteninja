import Link from 'next/link';

export const metadata = { title: 'Instalar no Android | KiteNinja' };

/**
 * Como instalar o KiteNinja no Android.
 *
 * POR QUE ESTA PÁGINA EXISTE
 *
 * O botão "Baixar Aplicativo Android (.APK)" mandava para uma release do
 * GitHub que não existe, num repositório privado — e o usuário caía no 404 do
 * GitHub. Ver o bloco em app/api/download/android/route.ts.
 *
 * Hoje NÃO HÁ APK publicado, e o jeito real de instalar é adicionar à tela
 * inicial: o app vira ícone, abre em tela cheia, sem barra do navegador, e
 * recebe notificação. Esta página ensina isso em vez de fingir um download.
 *
 * Quando existir APK, basta preencher `NEXT_PUBLIC_ANDROID_APK_URL` — a rota
 * volta a redirecionar direto e ninguém passa por aqui.
 */
export default function InstalarAndroidPage() {
  const passos = [
    {
      n: 1,
      titulo: 'Abra o menu do navegador',
      texto: 'Toque nos três pontinhos, no canto superior direito do Chrome.',
    },
    {
      n: 2,
      titulo: 'Toque em "Instalar app"',
      texto:
        'Em alguns aparelhos aparece como "Adicionar à tela inicial". As duas opções fazem a mesma coisa.',
    },
    {
      n: 3,
      titulo: 'Confirme',
      texto: 'O ícone do KiteNinja aparece na sua tela inicial, junto dos outros apps.',
    },
  ];

  return (
    <main className="flex-1 min-h-0 overflow-y-auto bg-[var(--app-bg)] text-slate-100">
      <div className="w-full max-w-md mx-auto px-5 py-10 space-y-7">
        <header className="text-center space-y-3">
          <div className="text-5xl" aria-hidden="true">
            🪁
          </div>
          <h1 className="text-2xl font-black tracking-tight">Instalar no Android</h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            O KiteNinja instala direto pelo navegador — sem loja, sem APK, sem liberar
            &quot;fontes desconhecidas&quot;. Fica igual a um app instalado.
          </p>
        </header>

        <ol className="space-y-3">
          {passos.map((p) => (
            <li
              key={p.n}
              className="flex gap-3 p-4 rounded-2xl bg-[#0F172A] border border-slate-800"
            >
              <span
                className="shrink-0 w-7 h-7 rounded-full bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 font-black text-xs flex items-center justify-center"
                aria-hidden="true"
              >
                {p.n}
              </span>
              <div className="min-w-0">
                <p className="font-black text-sm text-white">{p.titulo}</p>
                <p className="text-xs text-slate-400 leading-relaxed mt-0.5">{p.texto}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-1.5">
          <p className="font-black text-xs text-emerald-300">O que você ganha instalando</p>
          <ul className="text-xs text-emerald-100/80 leading-relaxed space-y-1">
            <li>• Notificação de SOS e de downwind novo chega no celular.</li>
            <li>• Abre em tela cheia, sem a barra do navegador atrapalhando o mapa.</li>
            <li>• O rastreamento do velejo fica mais estável em segundo plano.</li>
          </ul>
        </div>

        <Link
          href="/"
          className="block w-full text-center py-3 rounded-2xl bg-gradient-to-r from-cyan-400 to-blue-600 text-slate-950 font-black text-sm active:scale-[0.98] transition-transform"
        >
          Voltar ao KiteNinja
        </Link>
      </div>
    </main>
  );
}
