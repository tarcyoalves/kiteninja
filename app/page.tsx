"use client";

import React from "react";
import { AuthProvider } from "@/context/AuthContext";
import { KiteDataProvider } from "@/context/KiteDataContext";
import { DownwindProvider, useDownwind } from "@/context/DownwindContext";
import { DownwindAoVivoView } from "@/views/DownwindAoVivoView";
import { Header } from "@/components/Header";
import { BottomNav } from "@/components/BottomNav";
import { SidebarDrawer } from "@/components/SidebarDrawer";
import { SpotDetailModal } from "@/components/SpotDetailModal";
import { SessionLoggerModal } from "@/components/SessionLoggerModal";
import { KiteCalculatorModal } from "@/components/KiteCalculatorModal";
import { NewPostModal } from "@/components/NewPostModal";
import { NewListingModal } from "@/components/NewListingModal";
import { BuscarVelejadores } from "@/components/BuscarVelejadores";
import { RiderProfileModal } from "@/components/RiderProfileModal";
import { SessionDetailModal } from "@/components/SessionDetailModal";
import { NotificationCenterModal } from "@/components/NotificationCenterModal";
import { ChamadosModal } from "@/components/ChamadosModal";
import { InAppPushToast } from "@/components/InAppPushToast";
import { UpdateNotificationBanner } from "@/components/UpdateNotificationBanner";
import { AndroidAppPromptModal } from "@/components/AndroidAppPromptModal";
import { SosPanel } from "@/components/SosPanel";
import { SosIncomingAlert } from "@/components/SosIncomingAlert";
import { EntrarDownwindModal } from "@/components/activity/EntrarDownwindModal";
import { IniciarAtividadeSheet } from "@/components/activity/IniciarAtividadeSheet";
import { CriarDownwindModal } from "@/components/activity/CriarDownwindModal";
import { SpotsView } from "@/views/SpotsView";
import { MapView } from "@/views/MapView";
import { FeedView } from "@/views/FeedView";
import { SessionsView } from "@/views/SessionsView";
import { PerfilView } from "@/views/PerfilView";
import { EventsAndAlertsView } from "@/views/EventsAndAlertsView";
import { MarketplaceView } from "@/views/MarketplaceView";
import { ChatView } from "@/views/ChatView";
import { useKiteData } from "@/context/KiteDataContext";
import { useAuth } from "@/context/AuthContext";
import { LoginGate } from "@/components/LoginGate";
import { PermissoesOnboarding, permissoesJaPedidas } from "@/components/PermissoesOnboarding";
import { ForcePasswordChangeModal } from "@/components/ForcePasswordChangeModal";
import {
  SplashIntro,
  introJaVista,
  marcarIntroVista,
} from "@/components/SplashIntro";
import { useKeyboardVisible } from "@/lib/useKeyboardVisible";
const MainContent: React.FC = () => {
  const {
    activeTab,
    selectedSpot,
    setSelectedSpot,
    beachMode,
    myActiveSos,
    incomingSosAlert,
    dismissIncomingSos,
    respondToSos,
    cancelMySos,
    setActiveTab,
    isBuscaVelejadoresOpen,
    setIsBuscaVelejadoresOpen,
    riderIdAberto,
    setRiderIdAberto,
    sessaoIdAberta,
    setSessaoIdAberta,
    isNotificacoesAbertas,
    setIsNotificacoesAbertas,
    zerarNotificacoesNaoLidas,
    isChamadosAbertos,
    setIsChamadosAbertos,
    unreadChatCount,
    dmUnreadCount,
    isSheetIniciarOpen,
    setIsSheetIniciarOpen,
    createDownwind,
    avisarInicioDeVelejo,
    spots,
  } = useKiteData();

  const { user } = useAuth();
  const { downwindAtivo, recarregar: recarregarDownwind } = useDownwind();
  const [modalCriarDwGlobalAberto, setModalCriarDwGlobalAberto] = React.useState(false);
  // Um downwind ativo troca apenas o conteúdo da aba Mapa pelo mapa ao vivo.
  // O menu flutuante e as demais abas permanecem disponíveis.
  const emDownwind = Boolean(downwindAtivo);
  // Inicializa painel SOS aberto se há SOS ativo; caso contrário fecha
  const [isSosPanelOpen, setIsSosPanelOpen] = React.useState(() => Boolean(myActiveSos));
  // Marca o estado do teclado no shell para o CSS zerar a folga do menu
  // (que é desmontado quando o teclado abre) e não deixar faixa vazia embaixo.
  const tecladoAberto = useKeyboardVisible();

  // Reabre o painel se um novo SOS do usuário for detectado
  React.useEffect(() => {
    if (myActiveSos) {
      setIsSosPanelOpen(true);
    }
  }, [myActiveSos]);

  const [tokenConviteUrl, setTokenConviteUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const inviteToken = params.get('dw_invite');
    if (inviteToken) {
      setTokenConviteUrl(inviteToken);
    }
  }, []);

  return (
    /*
     * Shell de altura exata da viewport: header e menu são fixos por serem
     * irmãos flex que não encolhem, e só o miolo rola. Sem `fixed` e sem
     * subtrair pixels, o layout fica correto tanto na aba do navegador quanto
     * instalado como web app.
     */
    <div
      data-teclado={tecladoAberto ? "aberto" : "fechado"}
      /*
       * Sem `bg-*` aqui de propósito. A cor de fundo vem de `--app-bg` no
       * globals.css, compartilhada com o `body`. Quando este JSX declarava a
       * cor com uma utility do Tailwind, ela vencia a regra do `.app-shell` e o
       * `body` ficava num tom diferente — e a diferença aparecia como tarja na
       * safe-area do iPhone. O modo praia troca o token no <html>.
       */
      className={`app-shell font-sans flex flex-col antialiased transition-colors ${
        beachMode ? "text-white" : "text-slate-100"
      }`}
    >
      {/* Header — shrink-0 no próprio componente, sempre visível, inclusive
          durante o takeover do downwind (é onde vive o menu do avatar/SOS). */}
      <Header />

      {/* Área central do app. Durante um downwind, a aba Mapa mostra o mapa ao
          vivo; as demais abas e o menu flutuante continuam disponíveis. */}
      <main
        className={`w-full max-w-lg mx-auto ${
          activeTab === "chat" || activeTab === "mapa"
            ? "flex-1 min-h-0 overflow-hidden flex flex-col"
            : "app-scroll"
        }`}
      >
        {activeTab === "favoritos" && (
          <SpotsView onSelectSpot={(spot) => setSelectedSpot(spot)} />
        )}
        {activeTab === "mapa" && (
          emDownwind ? (
            <DownwindAoVivoView />
          ) : (
            <MapView onSelectSpot={(spot) => setSelectedSpot(spot)} />
          )
        )}
        {activeTab === "destaques" && <FeedView />}
        {activeTab === "sessoes" && <SessionsView />}
        {activeTab === "perfil" && <PerfilView />}
        {activeTab === "chat" && <ChatView />}
        {activeTab === "anuncios" && <MarketplaceView />}
        {(activeTab === "alertas" || activeTab === "mais") && (
          <EventsAndAlertsView />
        )}
      </main>

      {/* O gatilho de SOS agora vive dentro do menu do avatar (SidebarDrawer),
          na seção "Segurança & Emergência". O botão flutuante foi removido
          porque cobria a área de envio do chat. */}

      {/* Painel do SOS Ativo emitido pelo próprio usuário (193/185 em destaque) */}
      {myActiveSos && isSosPanelOpen && (
        <SosPanel
          sos={myActiveSos}
          emergencyContactPhone={user?.emergencyContactPhone || null}
          onClose={() => setIsSosPanelOpen(false)}
          onCancel={cancelMySos}
        />
      )}

      {/* Alerta SOS Recebido de Outro Velejador Próximo (Modal Interruptivo) */}
      {incomingSosAlert && (
        <SosIncomingAlert
          sos={{
            id: incomingSosAlert.id,
            authorName: incomingSosAlert.authorName,
            distanceKm: incomingSosAlert.distanceKm,
            spotName: incomingSosAlert.spotName,
            accuracyM: incomingSosAlert.accuracyM,
            lat: incomingSosAlert.lat,
            lng: incomingSosAlert.lng,
            message: incomingSosAlert.message,
            createdAt: incomingSosAlert.createdAt,
            temCoordenada: incomingSosAlert.temCoordenada,
            motivo: incomingSosAlert.motivo,
          }}
          onRespond={respondToSos}
          onViewMap={() => {
            setSelectedSpot(null);
            setActiveTab("mapa");
          }}
          onDismiss={dismissIncomingSos}
        />
      )}

      {/* Fixed Bottom Tab Navigation */}
      <BottomNav />

      {/* Slide-over Sidebar Drawer (matching Screenshot 4) */}
      <SidebarDrawer />

      {/* Full-Screen Spot Forecast Detail Sheet (matching Screenshot 2) */}
      <SpotDetailModal
        spot={selectedSpot}
        onClose={() => setSelectedSpot(null)}
      />

      {/* Interactive Modals */}
      <SessionLoggerModal />
      <KiteCalculatorModal />
      <NewPostModal />
      <NewListingModal />

      {/* Busca de velejadores + perfil público (Fase 4 do plano de rede
          social) — fecham o ciclo achar → seguir → ver o velejo. O perfil é
          renderizado DEPOIS da busca no DOM de propósito: os dois usam
          `z-modal` (mesma camada), e quem monta por último empilha por cima
          quando o velejador abre um perfil a partir de um resultado de busca. */}
      {isBuscaVelejadoresOpen && (
        <BuscarVelejadores
          onClose={() => setIsBuscaVelejadoresOpen(false)}
          onAbrirPerfil={setRiderIdAberto}
        />
      )}
      <RiderProfileModal
        riderId={riderIdAberto}
        onClose={() => setRiderIdAberto(null)}
        onAbrirPerfil={setRiderIdAberto}
        onAbrirDetalhe={setSessaoIdAberta}
      />

      {/* Detalhe da sessão (Fase 5 do plano de rede social) — mapa full-bleed
          + estatísticas completas + comentários, aberto de qualquer
          CardSessaoFeed (feed ou perfil público). */}
      <SessionDetailModal
        sessionId={sessaoIdAberta}
        onClose={() => setSessaoIdAberta(null)}
        onAbrirPerfil={setRiderIdAberto}
      />

      {/* Central de notificações in-app (Fase 6 do plano de rede social) —
          aberta pelo sininho do Header, mesmo padrão de estado único
          controlado aqui e montado uma vez só. */}
      <NotificationCenterModal
        aberto={isNotificacoesAbertas}
        onClose={() => {
          // Zera o badge do sininho ao FECHAR também: o modal marca tudo como
          // lido ao abrir, então quando o usuário sai não há mais nada não
          // lido. Sem isto o badge só sumia no próximo poll, até 20s depois —
          // parecia que a leitura não tinha sido registrada.
          zerarNotificacoesNaoLidas();
          setIsNotificacoesAbertas(false);
        }}
        onAbrirSessao={setSessaoIdAberta}
        onAbrirPerfil={setRiderIdAberto}
        totalChatUnread={unreadChatCount + dmUnreadCount}
        onIrParaChat={() => setActiveTab('chat')}
        onAbrirDownwind={() => setActiveTab('mapa')}
      />

      {tokenConviteUrl && (
        <EntrarDownwindModal
          token={tokenConviteUrl}
          isOpen={Boolean(tokenConviteUrl)}
          onClose={() => {
            setTokenConviteUrl(null);
            if (typeof window !== 'undefined') {
              const url = new URL(window.location.href);
              url.searchParams.delete('dw_invite');
              window.history.replaceState({}, '', url.pathname + url.search);
            }
          }}
          spots={useKiteData().spots}
          onEntrou={() => {
            setActiveTab('mapa');
          }}
        />
      )}

      {/* Central de chamados (reportar bug/melhoria) — aberta pelo menu
          lateral, mesmo padrão de estado único controlado aqui. */}
      <ChamadosModal
        aberto={isChamadosAbertos}
        onClose={() => setIsChamadosAbertos(false)}
        telaAtual={activeTab}
      />

      {/* Menu Global de Iniciar Atividade (acionado pelo botão PLAY central do BottomNav ou do Mapa) */}
      {isSheetIniciarOpen && (
        <IniciarAtividadeSheet
          isOpen={isSheetIniciarOpen}
          onClose={() => setIsSheetIniciarOpen(false)}
          selectedSpot={selectedSpot}
          downwindAtivo={downwindAtivo}
          modoNavegacaoAtivo={false}
          onIniciarVelejoSolo={() => {
            // Lê o spot ANTES do setSelectedSpot(null) logo abaixo — depois
            // dele a informação some, e o aviso viraria "entrou na água" sem
            // dizer onde, que é bem menos útil para quem recebe.
            avisarInicioDeVelejo(selectedSpot?.name ?? null);
            setIsSheetIniciarOpen(false);
            setSelectedSpot(null);
            setActiveTab('mapa');
          }}
          onAbrirCriarDownwind={() => {
            setIsSheetIniciarOpen(false);
            setModalCriarDwGlobalAberto(true);
          }}
          onAbrirEntrarPorLink={() => {
            setIsSheetIniciarOpen(false);
            const token = window.prompt('Cole o link ou token do convite de downwind:');
            if (token) {
              const cleanToken = token.trim().replace(/^.*dw_invite=/, '');
              setTokenConviteUrl(cleanToken);
            }
          }}
          onContinuarDownwindAtivo={() => {
            setIsSheetIniciarOpen(false);
            setSelectedSpot(null);
            setActiveTab('mapa');
          }}
          onCompartilharSoloLink={async () => {
            const shareData = {
              title: 'Acompanhar Velejo KiteNinja',
              text: `Estou iniciando um velejo solo em ${selectedSpot?.name || 'KiteNinja'}! Acompanhe comigo.`,
              url: typeof window !== 'undefined' ? window.location.origin : '',
            };
            if (navigator.share) {
              try {
                await navigator.share(shareData);
              } catch {}
            } else if (navigator.clipboard) {
              await navigator.clipboard.writeText(shareData.url);
              alert('Link copiado para a área de transferência!');
            }
          }}
        />
      )}

      {/* Modal Global de Criar Downwind */}
      {modalCriarDwGlobalAberto && (
        <CriarDownwindModal
          isOpen={modalCriarDwGlobalAberto}
          onClose={() => setModalCriarDwGlobalAberto(false)}
          spots={spots}
          defaultSpotId={selectedSpot?.id}
          onCriarDownwind={async (dados) => {
            try {
              const res = await fetch('/api/downwind', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dados),
              });
              const data = await res.json();
              if (!res.ok) return { ok: false, error: data.error || 'Falha ao criar downwind.' };
              await recarregarDownwind();
              setModalCriarDwGlobalAberto(false);
              setActiveTab('mapa');
              return { ok: true, downwindId: data.id };
            } catch {
              return { ok: false, error: 'Erro de conexão ao criar downwind.' };
            }
          }}
        />
      )}

      {/* In-App Push Notification Toast */}
      <InAppPushToast />

      {/* Banner Automático de Nova Versão/Atualização do App */}
      <UpdateNotificationBanner />

      {/* Modal/Prompt de Download Automático para Usuários Android no Navegador */}
      <AndroidAppPromptModal />
    </div>
  );
};

/**
 * Portão de acesso.
 * O app carrega em segundo plano enquanto a abertura roda sobreposta.
 * Ao clicar em Pular (ou no término do vídeo), a abertura desmonta em 0ms
 * com o app já pronto e hidratado na tela, sem qualquer atraso ou tela preta.
 */
const Gate: React.FC = () => {
  const { isAuthenticated, isLoading, mustChangePassword, user } = useAuth();
  // Pedido único de localização + notificações, logo depois do login. Só
  // decide DEPOIS de saber quem é o usuário (o marcador é por conta, em
  // localStorage) e nunca por cima do splash ou da troca de senha
  // obrigatória — ver components/PermissoesOnboarding.tsx.
  const [permissoesFeitas, setPermissoesFeitas] = React.useState(true);
  React.useEffect(() => {
    if (!isAuthenticated || !user?.id || mustChangePassword) return;
    setPermissoesFeitas(permissoesJaPedidas(user.id));
  }, [isAuthenticated, user?.id, mustChangePassword]);
  // Lazy init: o link para /admin é navegação de página inteira (não rota
  // client-side), então toda volta remonta o Gate do zero. Sem checar
  // introJaVista() aqui, o vídeo tocava de novo a cada ida e volta ao admin
  // dentro da MESMA sessão, mesmo a intro já tendo sido vista.
  const [introDone, setIntroDone] = React.useState(introJaVista);

  // Enquanto verifica o cookie inicial da sessão, mantém fundo escuro sólido.
  // Sem cor própria (herda --app-bg do body) e sem min-h-screen: este div é o
  // primeiro pixel que o app instalado mostra, e tinha as duas coisas erradas —
  // #0B1220 (tom antigo, divergente do shell) e 100vh, a conta que sobra faixa
  // no iOS. `flex-1` preenche o body, que já é flex-col de altura cheia.
  if (isLoading) {
    return <div className="flex-1" />;
  }

  return (
    <>
      {!introDone && (
        <SplashIntro
          onDone={() => {
            marcarIntroVista();
            setIntroDone(true);
          }}
        />
      )}
      {!isAuthenticated ? (
        <LoginGate />
      ) : mustChangePassword ? (
        // Senha temporária ainda ativa: bloqueia o app inteiro até a troca,
        // igual ao LoginGate bloqueia quem não está logado. Nada de SOS, feed
        // ou qualquer outra tela nasce atrás dessa flag.
        <ForcePasswordChangeModal />
      ) : (
        <KiteDataProvider>
          {/* DownwindProvider DENTRO de KiteDataProvider, nunca fora:
              components/ModoNavegacao.tsx (Fase 7) lê useKiteData() e vai
              precisar ler useDownwind() também. */}
          <DownwindProvider>
            <MainContent />
          </DownwindProvider>
        </KiteDataProvider>
      )}

      {/* Depois do splash e do login, e nunca sobre a troca de senha
          obrigatória: o velejador precisa estar parado e com o app já
          visível para entender por que as permissões importam. */}
      {isAuthenticated && !mustChangePassword && introDone && !permissoesFeitas && user?.id && (
        <PermissoesOnboarding userId={user.id} onFechar={() => setPermissoesFeitas(true)} />
      )}
    </>
  );
};

export default function Page() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

