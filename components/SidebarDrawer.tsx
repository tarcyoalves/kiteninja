'use client';

import React, { useEffect, useState, useRef } from 'react';
import {
  X,
  Pin,
  MapPin,
  Calendar,
  Megaphone,
  Star,
  Users,
  BookOpen,
  MessageSquare,
  Bell,
  Calculator,
  PlusCircle,
  LogOut,
  LogIn,
  Sun,
  Shield,
  Camera,
  ChevronRight,
  Loader2,
  Siren,
  UserCog,
  MessageSquareWarning,
  AlertTriangle,
  RefreshCw,
  Download,
} from 'lucide-react';
import { ActiveTab, useKiteData } from '../context/KiteDataContext';
import { useAuth } from '../context/AuthContext';
import { compressImage } from '../lib/imageCompress';
import { useSosHold } from '../lib/useSosHold';
import { urlBase64ToUint8Array } from '../lib/pushClient';
import { useIsNativeApp } from '../lib/usePushNotifications';
import { BotoesEmergencia } from './BotoesEmergencia';

export const SidebarDrawer: React.FC = () => {
  const {
    isSidebarOpen,
    setIsSidebarOpen,
    setActiveTab,
    setIsLoggerOpen,
    setIsCalculatorOpen,
    setIsNewAlertOpen,
    beachMode,
    setBeachMode,
    windUnit,
    setWindUnit,
    selectedSpot,
    setSelectedSpot,
    myActiveSos,
    fetchActiveSos,
    setIsBuscaVelejadoresOpen,
    setIsNotificacoesAbertas,
    setIsChamadosAbertos,
    pushNativo,
  } = useKiteData();

  const { user, isAdmin, logout, openAuthModal, updateProfile } = useAuth();

  // Gatilho de SOS (press-and-hold). Ao disparar, fecha o menu e leva ao mapa
  // para o velejador acompanhar quem está a caminho.
  const sos = useSosHold({
    hasActiveSos: Boolean(myActiveSos),
    onSosTriggered: () => {
      fetchActiveSos();
      setIsSidebarOpen(false);
    },
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // Contato de Emergência
  const [emergencyName, setEmergencyName] = useState(user?.emergencyContactName || '');
  const [emergencyPhone, setEmergencyPhone] = useState(user?.emergencyContactPhone || '');
  const [savingContact, setSavingContact] = useState(false);
  const [contactSaved, setContactSaved] = useState(false);

  // Web Push
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushErro, setPushErro] = useState<string | null>(null);
  // App Android usa FCM nativo, nao Web Push - ver handleTogglePush abaixo.
  const ehAppNativo = useIsNativeApp();

  const isIos = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  const isStandalone =
    typeof window !== 'undefined' &&
    (Boolean((window.navigator as unknown as { standalone?: boolean }).standalone) ||
      window.matchMedia('(display-mode: standalone)').matches);

  useEffect(() => {
    if (user) {
      setEmergencyName(user.emergencyContactName || '');
      setEmergencyPhone(user.emergencyContactPhone || '');
    }
  }, [user]);

  useEffect(() => {
    // No app nativo a Push API do navegador não existe na WebView, mas o push
    // FUNCIONA (via FCM, registrado por usePushNotifications no provider).
    // Sem este ramo o botão diria "Ativar Notificações" para sempre, mesmo
    // com o push já ativo — checar `Notification.permission` ali é a
    // pergunta errada para o Android.
    if (ehAppNativo) {
      setPushEnabled(true);
      return;
    }
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPushEnabled(Notification.permission === 'granted');
    }
  }, [ehAppNativo]);

  const handleSaveContact = async () => {
    setSavingContact(true);
    try {
      await updateProfile({
        emergencyContactName: emergencyName.trim(),
        emergencyContactPhone: emergencyPhone.trim(),
      });
      setContactSaved(true);
      setTimeout(() => setContactSaved(false), 3000);
    } catch {
      // Ignora erro
    } finally {
      setSavingContact(false);
    }
  };

  const handleTogglePush = async () => {
    // No app Android (Capacitor) o push é FCM nativo, registrado por
    // `usePushNotifications` no provider — não Web Push. Sem esta guarda, a
    // WebView caía no ramo abaixo (não tem Push API) e mostrava
    // "Notificações Push não são suportadas neste navegador", mensagem
    // enganosa: o suporte existe, só por outro caminho.
    if (ehAppNativo) {
      setPushErro(
        'No app Android as notificações são gerenciadas pelo sistema. Se estiverem desligadas, ative em Ajustes do Android → Apps → KiteNinja → Notificações.'
      );
      return;
    }

    if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) {
      alert('Notificações Push não são suportadas neste navegador.');
      return;
    }

    setPushBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPushEnabled(perm === 'granted');

      if (perm === 'granted') {
        const reg = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;

        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!vapidKey) {
          throw new Error(
            'Chave VAPID pública ausente no build. Confira NEXT_PUBLIC_VAPID_PUBLIC_KEY na Vercel — variáveis NEXT_PUBLIC_* entram no bundle em tempo de BUILD, então mudá-la exige um redeploy.'
          );
        }

        // `applicationServerKey` PRECISA ser Uint8Array, não a string
        // base64url crua — ver lib/pushClient.ts. Passar a string fazia o
        // Safari do iOS recusar a inscrição em silêncio.
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });

        const subJson = sub.toJSON();
        if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
          throw new Error('Inscrição de push veio incompleta do navegador.');
        }

        const res = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: subJson.endpoint,
            p256dh: subJson.keys.p256dh,
            auth: subJson.keys.auth,
          }),
        });
        // Sem checar `ok`, um 4xx/5xx aqui passaria por sucesso: `fetch` só
        // rejeita em falha de rede. Foi assim que a inscrição parecia ter
        // funcionado enquanto o banco seguia vazio.
        if (!res.ok) {
          throw new Error(`Servidor recusou a inscrição (HTTP ${res.status}).`);
        }
        setPushErro(null);
      }
    } catch (err) {
      // Antes isto era só console.error: a tela dizia "ativado" (a PERMISSÃO
      // realmente foi concedida) enquanto nenhuma inscrição chegava ao banco,
      // e o SOS ficava sem ninguém para notificar sem nenhum sinal visível.
      console.error('[push] Erro ao ativar notificações:', err);
      setPushEnabled(false);
      setPushErro(
        err instanceof Error ? err.message : 'Não foi possível ativar as notificações.'
      );
    } finally {
      setPushBusy(false);
    }
  };

  /**
   * Contagem real de velejadores online, para o badge do Chat.
   *
   * Antes era um "6" fixo no JSX. Badge com número inventado é pior que badge
   * nenhum: o velejador abre o chat esperando seis pessoas, encontra a sala
   * vazia e passa a ignorar todos os badges do app.
   *
   * Busca só quando o menu abre (não em intervalo): o drawer é efêmero e o
   * número vale para a decisão de tocar em "Chat", não para acompanhar em tempo
   * real. Fica antes do early return abaixo porque hook não pode ser condicional.
   */
  const [onlineCount, setOnlineCount] = useState(0);

  useEffect(() => {
    if (!isSidebarOpen) return;

    let ativo = true;
    fetch('/api/chat/presence', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        // `ativo` evita setState depois de o menu fechar (o fetch pode voltar
        // com o componente já desmontado).
        if (ativo && body) setOnlineCount(Number(body.count) || 0);
      })
      .catch(() => {
        // Sem rede o badge simplesmente não aparece — melhor que um número velho.
      });

    return () => {
      ativo = false;
    };
  }, [isSidebarOpen]);

  if (!isSidebarOpen) return null;

  const navigateTo = (tabName: ActiveTab) => {
    if (selectedSpot) {
      setSelectedSpot(null);
    }
    setActiveTab(tabName);
    setIsSidebarOpen(false);
  };

  /**
   * Antes isto sorteava uma foto do Unsplash: o velejador clicava em "Alterar
   * Foto" e recebia o rosto de um desconhecido. Agora abre a câmera/galeria e
   * envia a imagem de verdade, comprimida no cliente.
   */
  const handlePhotoPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Zerar o value permite reescolher o MESMO arquivo depois de um erro.
    e.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setPhotoError('Escolha um arquivo de imagem.');
      return;
    }

    setPhotoBusy(true);
    setPhotoError(null);
    try {
      // Avatar aparece em 56px; 512 já cobre telas retina com folga.
      const dataUrl = await compressImage(file, 512, 0.8);
      const res = await updateProfile({ avatarUrl: dataUrl });
      if (res && res.ok === false) {
        setPhotoError(res.error ?? 'Não foi possível salvar a foto.');
      }
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Falha ao processar a foto.');
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-drawer flex">
      {/* Dark Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
        onClick={() => setIsSidebarOpen(false)}
      />

      {/* Drawer Body (Left aligned matching screenshot 4) */}
      <div
        className={`relative z-10 w-[85%] max-w-[320px] h-full flex flex-col overflow-y-auto overlay-safe-top overlay-safe-bottom transition-transform shadow-2xl ${
          beachMode ? 'bg-[#020617] text-white' : 'bg-[#0F172A] text-slate-100 border-r border-slate-800'
        }`}
      >
        {/* Profile Card Header matching Screenshot 4 */}
        <div className="p-4 bg-[#1E293B] border-b border-slate-800 relative">
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="absolute top-3 right-3 p-1.5 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white"
          >
            <X size={18} />
          </button>

          {user ? (
            <div className="flex flex-col gap-3">
              {/* Alterar Foto Top Button + Flag */}
              <div className="flex items-center justify-between gap-2 pr-10">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={photoBusy}
                  className="flex items-center gap-1.5 px-3 py-2 min-h-11 rounded-lg bg-[#0F172A] hover:bg-slate-900 border border-slate-700 text-xs font-bold text-slate-200 transition-colors shadow-xs disabled:opacity-60"
                >
                  {photoBusy ? (
                    <Loader2 size={13} className="text-cyan-400 animate-spin" />
                  ) : (
                    <Camera size={13} className="text-cyan-400" />
                  )}
                  <span>{photoBusy ? 'Enviando...' : 'Alterar Foto'}</span>
                </button>
                <span className="text-2xl shrink-0" title={user.nationality || 'Brasil'}>
                  {user.countryFlag || '🇧🇷'}
                </span>
              </div>

              {/*
                Sem o atributo `capture`: com ele o celular abre DIRETO a câmera
                e a galeria fica inacessível. Sem ele, o sistema mostra o próprio
                seletor com as duas opções (Câmera / Fototeca / Arquivos), que é
                o comportamento esperado para foto de perfil.
                heic/heif no accept: é o formato padrão do iPhone.
              */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*"
                onChange={handlePhotoPicked}
                className="hidden"
                aria-label="Escolher foto de perfil da câmera ou galeria"
              />

              {photoError && (
                <p role="alert" className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-2 py-1.5">
                  {photoError}
                </p>
              )}

              {/* Avatar + Info */}
              <div className="flex items-center gap-3 mt-1">
                <div className="relative">
                  <div className="w-14 h-14 rounded-full bg-slate-800 ring-2 ring-cyan-400 overflow-hidden flex items-center justify-center shadow-lg">
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" />
                    ) : (
                      <Users size={28} className="text-slate-400" />
                    )}
                  </div>
                  <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-400 rounded-full ring-2 ring-[#1E293B]" />
                </div>

                <div className="flex-1 min-w-0">
                  <h3 className="font-black text-base text-white truncate">{user.name}</h3>
                  <p className="text-xs text-slate-400 truncate">{user.email}</p>
                  <p className="text-[11px] font-mono text-cyan-400 tracking-tight mt-0.5 font-bold">
                    ID: {user.riderId}
                  </p>
                </div>
              </div>

              {/* Quick stats badge */}
              <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-slate-700/80 text-center">
                <div className="bg-[#0F172A] p-2 rounded-xl border border-slate-700/60">
                  <span className="block text-[10px] text-slate-400 font-bold uppercase">Velejos</span>
                  <span className="font-black text-xs text-emerald-400 font-sans">{user.totalSessions}</span>
                </div>
                <div className="bg-[#0F172A] p-2 rounded-xl border border-slate-700/60">
                  <span className="block text-[10px] text-slate-400 font-bold uppercase">Horas</span>
                  <span className="font-black text-xs text-cyan-400 font-sans">{user.totalHours}h</span>
                </div>
                <div className="bg-[#0F172A] p-2 rounded-xl border border-slate-700/60">
                  <span className="block text-[10px] text-slate-400 font-bold uppercase">Peso</span>
                  <span className="font-black text-xs text-amber-400 font-sans">{user.weightKg}kg</span>
                </div>
              </div>

              {/* Editar Perfil: leva à aba 'perfil', onde o velejador ajusta
                  peso, altura, nível, quiver e demais dados usados pelo app. */}
              <button
                onClick={() => navigateTo('perfil')}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-[#0F172A] hover:bg-slate-900 border border-slate-700 text-xs font-bold text-cyan-300 transition-colors"
              >
                <UserCog size={13} />
                <span>Editar Perfil</span>
              </button>
            </div>
          ) : (
            <div className="py-2 text-center">
              <h3 className="font-black text-white text-base">Olá, Velejador!</h3>
              <p className="text-xs text-slate-400 mb-3">Conecte sua conta para salvar velejos e favoritos.</p>
              <button
                onClick={() => {
                  setIsSidebarOpen(false);
                  openAuthModal();
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20"
              >
                <LogIn size={15} />
                <span>Entrar / Cadastrar Rider</span>
              </button>
            </div>
          )}
        </div>

        {/* Menu Navigation List matching Screenshot 4 */}
        <div className="flex-1 py-2 px-2 space-y-0.5 text-sm font-semibold">
          {/* Destaques */}
          <button
            onClick={() => navigateTo('destaques')}
            className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-colors text-left"
          >
            <Pin size={18} className="text-cyan-400" />
            <span className="flex-1">Destaques</span>
          </button>

          {/* Mapa (Novo) */}
          <button
            onClick={() => navigateTo('mapa')}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-colors text-left"
          >
            <div className="flex items-center gap-3.5">
              <MapPin size={18} className="text-rose-400" />
              <span>Mapa</span>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-cyan-500 text-slate-950 text-[10px] font-black uppercase tracking-wider shadow-xs">
              Novo
            </span>
          </button>

          {/*
            Um único destino para a tela que já contém as duas subabas.
            Antes havia "Eventos" aqui e "Ocorrências" logo abaixo, ambos
            chamando navigateTo('alertas'). Além da duplicidade, "Eventos"
            abria a subaba inicial de Ocorrências — o botão não cumpria o nome.
          */}
          <button
            onClick={() => navigateTo('alertas')}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-colors text-left"
          >
            <div className="flex items-center gap-3.5">
              <Calendar size={18} className="text-rose-400" />
              <span>Eventos & Ocorrências</span>
            </div>
            <ChevronRight size={15} className="text-slate-500" aria-hidden="true" />
          </button>

          {/* Anúncios — marketplace de equipamento usado da comunidade */}
          <button
            onClick={() => navigateTo('anuncios')}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-colors text-left"
          >
            <div className="flex items-center gap-3.5">
              <Megaphone size={18} className="text-emerald-400" />
              <span>Anúncios</span>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-black uppercase tracking-wider shadow-xs">
              Novo
            </span>
          </button>

          {/* Favoritos */}
          <button
            onClick={() => navigateTo('favoritos')}
            className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-colors text-left"
          >
            <Star size={18} className="text-amber-400 fill-amber-400/30" />
            <span className="flex-1">Favoritos</span>
          </button>

          {/*
            Riders não é sinônimo de Destaques: abre a busca/lista de pessoas
            diretamente. Antes os dois itens chamavam a mesma aba e exibiam a
            mesma página — duplicidade percebida pelo dono na navegação real.
          */}
          <button
            onClick={() => {
              setIsSidebarOpen(false);
              setIsBuscaVelejadoresOpen(true);
            }}
            className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-colors text-left"
          >
            <Users size={18} className="text-emerald-400" />
            <span className="flex-1">Riders</span>
          </button>

          {/*
            A tela já existia (`activeTab === 'sessoes'`), mas não havia nenhum
            botão capaz de chegar nela. Isso tornava o logbook pessoal uma rota
            órfã e aumentava a impressão de que Destaques/Rides eram a mesma
            coisa. Aqui ficam explicitamente separados: Riders são pessoas;
            Meu Logbook são as minhas sessões.
          */}
          <button
            onClick={() => navigateTo('sessoes')}
            className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-colors text-left"
          >
            <BookOpen size={18} className="text-cyan-400" />
            <span className="flex-1">Meu Logbook</span>
          </button>

          {/* Chat — badge mostra quantos velejadores estão online de verdade. */}
          <button
            onClick={() => navigateTo('chat')}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-colors text-left"
          >
            <div className="flex items-center gap-3.5">
              <MessageSquare size={18} className="text-cyan-400" />
              <span>Chat</span>
            </div>
            {onlineCount > 0 && (
              <span
                className="min-w-5 h-5 px-1.5 rounded-full bg-emerald-400 text-slate-950 text-xs font-black flex items-center justify-center shadow-xs"
                title={`${onlineCount} velejador(es) online agora`}
              >
                {onlineCount}
              </span>
            )}
          </button>

          {/* A central de notificações é modal, não a tela de ocorrências. */}
          <button
            onClick={() => {
              setIsSidebarOpen(false);
              setIsNotificacoesAbertas(true);
            }}
            className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-colors text-left"
          >
            <Bell size={18} className="text-slate-400" />
            <span className="flex-1">Notificações</span>
          </button>

          {/* Central de chamados — propositalmente mais chamativa enquanto é
              novidade: bloco inteiro pisca, ícone emite um ping e o selo se
              move. prefers-reduced-motion desliga todos os movimentos. */}
          <button
            onClick={() => {
              setIsSidebarOpen(false);
              setIsChamadosAbertos(true);
            }}
            className="chamados-destaque relative isolate w-full flex items-center gap-3 px-3 py-3 rounded-xl overflow-hidden border-2 border-cyan-300 bg-gradient-to-r from-cyan-500/30 via-blue-500/25 to-violet-500/25 text-white hover:from-cyan-400/40 hover:via-blue-400/35 hover:to-violet-400/35 transition-colors text-left"
          >
            <span
              aria-hidden="true"
              className="chamados-destaque-luz pointer-events-none absolute inset-0 -z-10"
            />
            <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-300 text-slate-950 shadow-[0_0_16px_rgba(103,232,249,0.75)]">
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-lg bg-cyan-300 animate-ping motion-reduce:animate-none"
              />
              <MessageSquareWarning size={21} aria-hidden="true" className="relative" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-black leading-tight">Reportar Bug/Melhoria</span>
              <span className="mt-0.5 text-[10px] font-bold leading-tight text-cyan-100">
                Ajude a melhorar o KiteNinja
              </span>
            </span>
            <span className="rounded-full bg-amber-300 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-slate-950 shadow-[0_0_12px_rgba(253,224,71,0.65)] animate-bounce motion-reduce:animate-none">
              Novo
            </span>
          </button>

          <div className="my-2 border-t border-slate-800 pt-2" />

          {/* Action: Calculadora de Pipa */}
          <button
            onClick={() => {
              setIsSidebarOpen(false);
              setIsCalculatorOpen(true);
            }}
            className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors text-left font-black border border-emerald-500/30"
          >
            <Calculator size={18} />
            <span className="flex-1">Calculadora de Pipa</span>
          </button>

          {/* Action: Registrar Velejo */}
          <button
            onClick={() => {
              setIsSidebarOpen(false);
              setIsLoggerOpen(true);
            }}
            className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25 transition-colors text-left font-black border border-cyan-500/30"
          >
            <PlusCircle size={18} />
            <span className="flex-1">Registrar Velejo</span>
          </button>
        </div>

        {/* Footer Settings & Auth */}
        <div className="p-3 bg-[#1E293B]/90 border-t border-slate-800 text-xs space-y-3">
          {/* Seção SOS e Contato de Emergência (apenas para usuário logado) */}
          {user && (
            <div className="p-3 rounded-2xl bg-[#0F172A] border border-rose-500/30 space-y-2.5">
              <div className="flex items-center gap-2 text-rose-400 font-black">
                <Shield size={15} />
                <span className="text-[11px] uppercase tracking-wider">Segurança & Emergência</span>
              </div>

              {/* Gatilho de SOS — segure para pedir socorro. Substitui o antigo
                  botão flutuante que cobria a área de envio do chat. */}
              {myActiveSos ? (
                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-rose-600/20 border border-rose-500/50">
                  <Siren size={16} className="text-rose-300 animate-pulse shrink-0" />
                  <span className="text-[11px] text-rose-200 font-bold leading-tight">
                    SOS ativo. Acompanhe quem está a caminho no mapa.
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  onPointerDown={sos.startHold}
                  onPointerUp={sos.cancelHold}
                  onPointerLeave={sos.cancelHold}
                  onPointerCancel={sos.cancelHold}
                  disabled={sos.sending}
                  className={`relative w-full py-2.5 rounded-xl font-black text-xs flex items-center justify-center gap-2 border-2 transition-all active:scale-95 select-none overflow-hidden ${
                    sos.sending
                      ? 'bg-rose-800 border-rose-400/60 cursor-wait text-white'
                      : sos.holdProgress > 0
                      ? 'bg-rose-600 border-rose-300 text-white'
                      : 'bg-rose-600/90 hover:bg-rose-500 border-rose-400/60 text-white'
                  }`}
                  aria-label="SOS — segure para pedir socorro"
                >
                  {/* Barra de progresso do hold preenchendo o botão da esquerda p/ direita */}
                  {sos.holdProgress > 0 && sos.holdProgress < 1 && (
                    <span
                      className="absolute inset-y-0 left-0 bg-white/25"
                      style={{ width: `${sos.holdProgress * 100}%` }}
                    />
                  )}
                  {sos.sending ? (
                    <Loader2 size={15} className="animate-spin relative" />
                  ) : (
                    <Siren size={15} className="relative" />
                  )}
                  <span className="relative tracking-wider">
                    {sos.sending ? 'ENVIANDO SOS...' : 'SOS — SEGURE PARA PEDIR SOCORRO'}
                  </span>
                </button>
              )}

              {/* Erro de rede: números de emergência para discagem direta */}
              {sos.error && (
                <div className="p-2.5 rounded-xl bg-rose-950/80 border border-rose-500/50 space-y-2">
                  <p className="text-[11px] text-rose-200 font-bold leading-tight">{sos.error}</p>
                  <BotoesEmergencia variante="compacto" />
                  <button
                    type="button"
                    onClick={() => sos.setError(null)}
                    className="w-full text-[10px] text-slate-400 py-0.5"
                  >
                    Fechar
                  </button>
                </div>
              )}

              {/* Autoridades — SEMPRE acessíveis, sem precisar disparar SOS.
                  O app avisa a comunidade; a autoridade tem barco e mandato, e
                  não pode ficar atrás de um fluxo nosso. `tel:` funciona sem
                  internet, basta sinal de voz. */}
              <div className="pt-1 space-y-1.5">
                <span className="text-[10px] text-slate-400 font-bold block">
                  Ligar para autoridades:
                </span>
                <BotoesEmergencia variante="completo" />
              </div>

              {/* Contato de Emergência */}
              <div className="space-y-1.5 pt-1">
                <span className="text-[10px] text-slate-400 font-bold block">
                  Contato de Emergência (Recebe sua posição):
                </span>
                <input
                  type="text"
                  placeholder="Nome do contato (ex: Maria)"
                  value={emergencyName}
                  onChange={(e) => setEmergencyName(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-hidden focus:border-cyan-400"
                />
                <input
                  type="text"
                  placeholder="WhatsApp com DDD (ex: 84999998888)"
                  value={emergencyPhone}
                  onChange={(e) => setEmergencyPhone(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-hidden focus:border-cyan-400"
                />
                <button
                  type="button"
                  onClick={handleSaveContact}
                  disabled={savingContact}
                  className="w-full py-1.5 rounded-lg bg-rose-600/30 hover:bg-rose-600/40 border border-rose-500/50 text-rose-300 font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all disabled:opacity-50"
                >
                  {savingContact ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : contactSaved ? (
                    <span className="text-emerald-400 font-bold">Salvo com sucesso!</span>
                  ) : (
                    <span>Salvar Contato de Emergência</span>
                  )}
                </button>
              </div>

              {/* Ativação de Notificações Push */}
              <div className="pt-2 border-t border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 font-bold">Alertas SOS Próximos:</span>
                  <button
                    type="button"
                    onClick={handleTogglePush}
                    disabled={pushBusy}
                    className={`px-2.5 py-1 rounded-lg font-bold text-[10px] transition-all flex items-center gap-1 ${
                      pushEnabled
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30'
                    }`}
                  >
                    {pushBusy ? (
                      <Loader2 size={10} className="animate-spin" />
                    ) : pushEnabled ? (
                      'Ativo'
                    ) : (
                      'Ativar Notificações'
                    )}
                  </button>
                </div>

                {/* Falha real da inscrição precisa aparecer: o SOS depende
                    dela, e antes o erro só ia pro console — a tela mostrava
                    "Ativo" com o banco vazio. */}
                {pushErro && (
                  <p className="text-[10px] text-rose-300 leading-tight bg-rose-500/10 border border-rose-500/25 p-2 rounded-lg flex items-start gap-1.5">
                    <AlertTriangle size={11} className="shrink-0 mt-px" />
                    <span>{pushErro}</span>
                  </p>
                )}

                {/* Instrução especial para iPhone / iOS Safari */}
                {/* Diagnóstico do FCM no app Android. Sem isto, descobrir por
                    que `fcm_tokens` está vazio exige cabo USB e logcat — o
                    hook loga tudo, mas ninguém vê console dentro da WebView.
                    Some sozinho quando o token registra (o estado normal). */}
                {ehAppNativo && !pushNativo.isRegistered && (
                  <div className="text-[10px] leading-tight bg-slate-800/60 border border-slate-700 p-2 rounded-lg text-slate-300 space-y-0.5">
                    <p className="font-bold text-slate-200">Registro do push (Android)</p>
                    <p>plugin: {pushNativo.isSupported ? 'ok' : 'não carregou'}</p>
                    <p>permissão: {pushNativo.isEnabled ? 'concedida' : 'não concedida'}</p>
                    <p>token no servidor: {pushNativo.isRegistered ? 'sim' : 'ainda não'}</p>
                    {pushNativo.isLoading && <p>estado: registrando…</p>}
                    {pushNativo.error && (
                      <p className="text-rose-300">erro: {pushNativo.error}</p>
                    )}
                  </div>
                )}

                {!ehAppNativo && isIos && !isStandalone && (
                  <p className="text-[10px] text-amber-300/90 leading-tight bg-amber-500/10 border border-amber-500/20 p-2 rounded-lg">
                    📱 <strong>No iPhone:</strong> para receber push de socorro, instale o app tocando em <strong>Compartilhar ➔ Adicionar à Tela de Início</strong>.
                  </p>
                )}

                {!ehAppNativo && isAndroid && !isStandalone && (
                  <a
                    href="/api/download/android"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 hover:bg-cyan-500/30 text-cyan-300 font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md shadow-cyan-500/10 active:scale-95"
                  >
                    <Download size={14} className="stroke-[2.2]" />
                    <span>Baixar App Android (.APK)</span>
                  </a>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between text-slate-400 px-1 font-medium">
            <span>Unidade de Vento:</span>
            <button
              onClick={() => setWindUnit(windUnit === 'nós' ? 'km/h' : windUnit === 'km/h' ? 'mph' : 'nós')}
              className="px-2 py-0.5 rounded-lg bg-[#0F172A] border border-slate-700 text-white font-mono font-bold uppercase"
            >
              {windUnit}
            </button>
          </div>

          <div className="flex items-center justify-between text-slate-400 px-1 font-medium">
            <span>Modo Sol Forte (Praia):</span>
            <button
              onClick={() => setBeachMode((prev) => !prev)}
              className={`px-2.5 py-0.5 rounded-lg font-bold transition-all ${
                beachMode ? 'bg-amber-400 text-black' : 'bg-[#0F172A] border border-slate-700 text-slate-300'
              }`}
            >
              {beachMode ? 'Ativo' : 'Desativado'}
            </button>
          </div>

          {/* O painel existia só por URL digitada. O link aparece apenas para
              admin: para os outros seria um botão que só leva a um redirect. */}
          {isAdmin && (
            <a
              href="/admin"
              onClick={() => setIsSidebarOpen(false)}
              className="w-full mt-2 py-2.5 px-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 text-emerald-300 font-bold flex items-center justify-center gap-2 transition-colors"
            >
              <Shield size={14} />
              <span>Painel do Admin</span>
            </a>
          )}
          {/* O painel "Diagnóstico de tela" (components/DiagTela.tsx) foi
              removido junto com o bug que ele existia para caçar: a tarja do
              rodapé e o vão do teclado, hoje resolvidos por --bottom-nav-height
              e lib/keyboardInset.ts. O próprio código pedia isso ("some quando
              o bug morrer"). Se voltar a fazer falta, está no histórico do git. */}

          {user && (
            <button
              onClick={async () => {
                await logout();
                setIsSidebarOpen(false);
              }}
              className="w-full mt-2 py-2.5 px-3 rounded-xl bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 text-rose-400 font-bold flex items-center justify-center gap-2 transition-colors"
            >
              <LogOut size={14} />
              <span>Sair da Conta</span>
            </button>
          )}

          {/* Rodapé de Versão e Atualização Automática */}
          <div className="pt-2 pb-1 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
            <span>KiteNinja v0.1.0</span>
            <button
              type="button"
              onClick={async () => {
                if ('caches' in window) {
                  const keys = await caches.keys();
                  await Promise.all(keys.map((k) => caches.delete(k)));
                }
                if ('serviceWorker' in navigator) {
                  const regs = await navigator.serviceWorker.getRegistrations();
                  for (const reg of regs) {
                    await reg.update().catch(() => {});
                  }
                }
                window.location.reload();
              }}
              className="text-cyan-400 hover:text-cyan-300 font-medium flex items-center gap-1 active:scale-95 transition-all"
            >
              <RefreshCw size={10} />
              <span>Verificar atualização</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
