"use client";

import React from "react";
import { AuthProvider } from "../context/AuthContext";
import { KiteDataProvider } from "../context/KiteDataContext";
import { DownwindProvider, useDownwind } from "../context/DownwindContext";
import { DownwindAoVivoView } from "../views/DownwindAoVivoView";
import { Header } from "../components/Header";
import { BottomNav } from "../components/BottomNav";
import { SidebarDrawer } from "../components/SidebarDrawer";
import { SpotDetailModal } from "../components/SpotDetailModal";
import { SessionLoggerModal } from "../components/SessionLoggerModal";
import { KiteCalculatorModal } from "../components/KiteCalculatorModal";
import { NewPostModal } from "../components/NewPostModal";
import { NewListingModal } from "../components/NewListingModal";
import { InAppPushToast } from "../components/InAppPushToast";
import { SosPanel } from "../components/SosPanel";
import { SosIncomingAlert } from "../components/SosIncomingAlert";
import { SpotsView } from "../views/SpotsView";
import { MapView } from "../views/MapView";
import { FeedView } from "../views/FeedView";
import { SessionsView } from "../views/SessionsView";
import { PerfilView } from "../views/PerfilView";
import { EventsAndAlertsView } from "../views/EventsAndAlertsView";
import { MarketplaceView } from "../views/MarketplaceView";
import { ChatView } from "../views/ChatView";
import { useKiteData } from "../context/KiteDataContext";
import { useAuth } from "../context/AuthContext";
import { LoginGate } from "../components/LoginGate";
import { ForcePasswordChangeModal } from "../components/ForcePasswordChangeModal";
import {
  SplashIntro,
  introJaVista,
  marcarIntroVista,
} from "../components/SplashIntro";
import { useKeyboardVisible } from "../lib/useKeyboardVisible";
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
  } = useKiteData();

  const { user } = useAuth();
  const { downwindAtivo } = useDownwind();
  // Trava real: enquanto o velejador participa de um downwind aberto/em
  // andamento, o app substitui as abas normais pelo mapa ao vivo — decisão de
  // produto documentada em context/DownwindContext.tsx. Só some quando o
  // downwind é de fato encerrado/cancelado ou a própria participação termina
  // (o servidor deixa de devolvê-lo em GET /api/downwind/ativo).
  const emDownwind = Boolean(downwindAtivo);
  const [isSosPanelOpen, setIsSosPanelOpen] = React.useState(true);
  // Marca o estado do teclado no shell para o CSS zerar a folga do menu
  // (que é desmontado quando o teclado abre) e não deixar faixa vazia embaixo.
  const tecladoAberto = useKeyboardVisible();

  // Reabre o painel se um novo SOS do usuário for detectado
  React.useEffect(() => {
    if (myActiveSos) {
      setIsSosPanelOpen(true);
    }
  }, [myActiveSos]);

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

      {emDownwind ? (
        <div className="w-full max-w-lg mx-auto flex-1 min-h-0 overflow-hidden flex flex-col">
          <DownwindAoVivoView />
        </div>
      ) : (
        /* Área central do app: quando for chat ou mapa, gerencia scroll internamente */
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
            <MapView onSelectSpot={(spot) => setSelectedSpot(spot)} />
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
      )}

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

      {/* In-App Push Notification Toast */}
      <InAppPushToast />
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
  const { isAuthenticated, isLoading, mustChangePassword } = useAuth();
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

