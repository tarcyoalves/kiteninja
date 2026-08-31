'use client';

import React, { useCallback, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Bell, Check, Loader2, MapPin, Siren } from 'lucide-react';
import { ativarWebPush, pedirLocalizacao } from '../lib/pushClient';
import { useIsNativeApp } from '../lib/usePushNotifications';
import { precisaInstalarParaPush, type AmbienteInstalacao } from '../lib/instalacaoIos';

/**
 * Pede localização e notificações UMA VEZ, logo depois do login.
 *
 * Antes, as duas permissões eram pedidas de forma espalhada e implícita:
 * a de notificação só se o velejador achasse o botão dentro do menu do
 * avatar (a maioria nunca achou — o banco tinha 9 usuários e ZERO
 * inscrições), e a de localização era disparada por qualquer tela que
 * chamasse `getCurrentPosition`, no meio de outra ação, sem explicar por quê.
 *
 * Aqui as duas são pedidas juntas, com o motivo na tela, no único momento em
 * que o velejador está parado e prestando atenção. Os prompts em si continuam
 * sendo os do sistema — não dá (nem deveria dar) para conceder permissão sem
 * o usuário ver o diálogo nativo.
 *
 * DECISÃO — não bloqueia o app: quem fecha ou nega continua usando tudo. O
 * SOS e o rastreio ficam degradados, e as telas que dependem deles já avisam
 * isso por conta própria (ver components/ModoNavegacao.tsx). Transformar isso
 * num muro obrigatório afastaria gente da parte do app que funciona sem
 * permissão nenhuma (previsão, spots, feed).
 *
 * DECISÃO — só aparece uma vez, marcado em localStorage por usuário: pedir de
 * novo a cada abertura seria assédio, e o navegador nem mostraria o prompt
 * outra vez depois de negado (a decisão fica no nível do site, não do app).
 * Quem negou e mudou de ideia usa o botão no menu do avatar, que continua lá.
 */

/**
 * Uma linha da lista de permissões.
 *
 * Fica no escopo do módulo, não dentro do componente: definir um componente
 * durante o render cria um TIPO novo a cada render, e o React desmonta e
 * remonta a subárvore inteira em vez de atualizá-la — é o que a regra
 * `react-hooks/static-components` do React 19 acusa. Aqui isso apagaria a
 * animação de "concedido" toda vez que o pai renderizasse.
 */
const Item = ({
  icone,
  titulo,
  texto,
  estado,
}: {
  icone: React.ReactNode;
  titulo: string;
  texto: string;
  estado: EstadoItem;
}) => (
  <div className="flex items-start gap-3">
    <div
      className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${
        estado === 'concedido'
          ? 'bg-emerald-500/20 text-emerald-300'
          : estado === 'negado'
            ? 'bg-slate-800 text-slate-500'
            : 'bg-cyan-500/15 text-cyan-300'
      }`}
    >
      {estado === 'concedido' ? <Check size={17} /> : icone}
    </div>
    <div className="min-w-0">
      <p className="text-[13px] font-black text-white">{titulo}</p>
      <p className="text-[11px] text-slate-400 leading-snug">{texto}</p>
    </div>
  </div>
);

/** O que só o navegador sabe — ver lib/instalacaoIos.ts. */
type AmbienteDoNavegador = Omit<AmbienteInstalacao, 'ehAppNativo'>;

/**
 * Nada aqui muda durante a sessão: o aparelho não deixa de ser um iPhone, e
 * instalar o app na tela de início abre uma janela nova. Por isso a inscrição
 * é vazia e o snapshot é cacheado — `useSyncExternalStore` exige que
 * `getSnapshot` devolva SEMPRE o mesmo objeto enquanto nada mudou, senão o
 * React entra em laço de render.
 */
function assinarAmbiente(): () => void {
  return () => {};
}

let cacheAmbiente: AmbienteDoNavegador | null = null;

function lerAmbienteNoCliente(): AmbienteDoNavegador {
  if (!cacheAmbiente) {
    cacheAmbiente = {
      userAgent: navigator.userAgent,
      standalone: Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone),
      displayModeStandalone: window.matchMedia('(display-mode: standalone)').matches,
    };
  }
  return cacheAmbiente;
}

/**
 * No servidor não há aparelho nenhum. Devolver "não é iOS" faz o SSR e o
 * primeiro render do cliente combinarem: o aviso aparece na hidratação, sem
 * erro de hidratação.
 */
const AMBIENTE_NO_SERVIDOR: AmbienteDoNavegador = {
  userAgent: '',
  standalone: false,
  displayModeStandalone: false,
};

function lerAmbienteNoServidor(): AmbienteDoNavegador {
  return AMBIENTE_NO_SERVIDOR;
}

const CHAVE_STORAGE = 'kiteninja:permissoes-pedidas';

/** Já pedimos para ESTE usuário neste aparelho? */
export function permissoesJaPedidas(userId: string): boolean {
  try {
    const bruto = localStorage.getItem(CHAVE_STORAGE);
    if (!bruto) return false;
    const lista = JSON.parse(bruto);
    return Array.isArray(lista) && lista.includes(userId);
  } catch {
    // localStorage bloqueado (modo privado): trata como "já pedido" para não
    // reabrir o onboarding a cada navegação — irritante, e sem storage não há
    // como lembrar da resposta mesmo.
    return true;
  }
}

function marcarPedido(userId: string): void {
  try {
    const bruto = localStorage.getItem(CHAVE_STORAGE);
    const lista: unknown = bruto ? JSON.parse(bruto) : [];
    const atual = Array.isArray(lista) ? (lista as string[]) : [];
    if (!atual.includes(userId)) atual.push(userId);
    localStorage.setItem(CHAVE_STORAGE, JSON.stringify(atual));
  } catch {
    // Sem storage o onboarding repetiria; `permissoesJaPedidas` já devolve
    // true nesse caso, então isto é só best-effort.
  }
}

type EstadoItem = 'pendente' | 'concedido' | 'negado';

export const PermissoesOnboarding: React.FC<{ userId: string; onFechar: () => void }> = ({
  userId,
  onFechar,
}) => {
  const [local, setLocal] = useState<EstadoItem>('pendente');
  const [push, setPush] = useState<EstadoItem>('pendente');
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // No app Android (Capacitor) o push NÃO é Web Push: quem registra é
  // `usePushNotifications` via FCM nativo, montado no provider e disparado
  // sozinho. Chamar `ativarWebPush()` dentro da WebView cai no ramo de
  // "navegador não suporta" (a WebView não tem Push API), e o velejador via
  // a mensagem "Notificações Push não são suportadas neste navegador" —
  // que era ENGANOSA: o suporte existe, só por outro caminho.
  const ehAppNativo = useIsNativeApp();

  // iOS só entrega Web Push quando o app está instalado na tela de início.
  // A leitura do ambiente passa por `useSyncExternalStore` — a API que o React
  // dá justamente para valores que existem só no cliente. Ela entrega o
  // snapshot do servidor no SSR e o do navegador na hidratação, sem efeito e
  // sem o render extra que um `useEffect` com setState causava aqui.
  const ambiente = useSyncExternalStore(
    assinarAmbiente,
    lerAmbienteNoCliente,
    lerAmbienteNoServidor
  );
  const precisaInstalar = precisaInstalarParaPush({ ...ambiente, ehAppNativo });

  const conceder = useCallback(async () => {
    setRodando(true);
    setErro(null);

    // Sequencial, não em paralelo: dois prompts nativos ao mesmo tempo — o
    // segundo é engolido pelo sistema em alguns navegadores, e o velejador
    // acha que só concedeu um.
    const okLocal = await pedirLocalizacao();
    setLocal(okLocal ? 'concedido' : 'negado');

    if (ehAppNativo) {
      // App Android: o registro FCM é feito por `usePushNotifications`, que
      // já roda no provider e pede a permissão nativa por conta própria.
      // Aqui não há nada a fazer além de refletir isso na tela — chamar Web
      // Push seria o erro que gerava "não suportadas neste navegador".
      setPush('concedido');
    } else if (!precisaInstalar) {
      try {
        const okPush = await ativarWebPush();
        setPush(okPush ? 'concedido' : 'negado');
      } catch (e) {
        setPush('negado');
        setErro(e instanceof Error ? e.message : 'Falha ao ativar notificações.');
      }
    }

    marcarPedido(userId);
    setRodando(false);

    // Fecha sozinho só quando deu tudo certo — se algo falhou, o velejador
    // precisa ver o que aconteceu antes da tela sumir.
    if (okLocal && (ehAppNativo || !precisaInstalar)) setTimeout(onFechar, 900);
  }, [userId, precisaInstalar, ehAppNativo, onFechar]);

  const pular = useCallback(() => {
    marcarPedido(userId);
    onFechar();
  }, [userId, onFechar]);


  return (
    <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-3xl bg-[#0F172A] border border-slate-700 p-5 space-y-4 overlay-safe-bottom">
        <div className="flex items-center gap-2">
          <Siren size={18} className="text-cyan-400" />
          <h2 className="text-base font-black text-white">Antes de velejar</h2>
        </div>

        <p className="text-[12px] text-slate-300 leading-snug">
          O KiteNinja usa duas permissões para o socorro funcionar. Sem elas, um
          SOS seu não encontra ninguém — e o de outro velejador não chega até
          você.
        </p>

        <div className="space-y-3 py-1">
          <Item
            icone={<MapPin size={17} />}
            titulo="Localização"
            texto="Mostra sua posição para quem pode socorrer, e permite achar quem está perto num SOS."
            estado={local}
          />
          <Item
            icone={<Bell size={17} />}
            titulo="Notificações"
            texto="Avisa você quando alguém dispara um SOS por perto, mesmo com o app fechado."
            estado={push}
          />
        </div>

        {precisaInstalar && (
          <p className="text-[11px] text-amber-300 leading-snug bg-amber-500/10 border border-amber-500/25 p-2.5 rounded-xl">
            📱 <strong>No iPhone</strong>, notificações só funcionam com o app
            instalado: toque em <strong>Compartilhar → Adicionar à Tela de
            Início</strong> e abra por lá. A localização já pode ser liberada
            agora.
          </p>
        )}

        {erro && (
          <p className="text-[11px] text-rose-300 leading-snug bg-rose-500/10 border border-rose-500/25 p-2.5 rounded-xl flex items-start gap-1.5">
            <AlertTriangle size={12} className="shrink-0 mt-px" />
            <span>{erro}</span>
          </p>
        )}

        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            onClick={conceder}
            disabled={rodando}
            className="w-full py-3 rounded-2xl bg-cyan-500 text-slate-950 font-black text-sm active:scale-[.98] transition-transform disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {rodando ? <Loader2 size={15} className="animate-spin" /> : null}
            {rodando ? 'Aguardando sua resposta…' : 'Permitir'}
          </button>
          <button
            type="button"
            onClick={pular}
            className="w-full py-2 text-[11px] font-bold text-slate-500"
          >
            Agora não
          </button>
        </div>
      </div>
    </div>
  );
};
