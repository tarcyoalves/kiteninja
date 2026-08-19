"use client";

import React from "react";
import { AuthProvider } from "../context/AuthContext";
import { KiteDataProvider } from "../context/KiteDataContext";
import { Header } from "../components/Header";
import { BottomNav } from "../components/BottomNav";
import { SidebarDrawer } from "../components/SidebarDrawer";
import { SpotDetailModal } from "../components/SpotDetailModal";
import { SessionLoggerModal } from "../components/SessionLoggerModal";
import { KiteCalculatorModal } from "../components/KiteCalculatorModal";
import { NewPostModal } from "../components/NewPostModal";
import { NewListingModal } from "../components/NewListingModal";
import { InAppPushToast } from "../components/InAppPushToast";
import { SosButton } from "../components/SosButton";
import { SosPanel } from "../components/SosPanel";
import { SosIncomingAlert } from "../components/SosIncomingAlert";
import { SpotsView } from "../views/SpotsView";
import { MapView } from "../views/MapView";
import { FeedView } from "../views/FeedView";
import { SessionsView } from "../views/SessionsView";
import { EventsAndAlertsView } from "../views/EventsAndAlertsView";
import { MarketplaceView } from "../views/MarketplaceView";
import { ChatView } from "../views/ChatView";
import { useKiteData } from "../context/KiteDataContext";
import { useAuth } from "../context/AuthContext";
import { LoginGate } from "../components/LoginGate";
import {
  SplashIntro,
  introJaVista,
  marcarIntroVista,
} from "../components/SplashIntro";

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
    fetchActiveSos,
    setActiveTab,
  } = useKiteData();

  const { user } = useAuth();
  const [isSosPanelOpen, setIsSosPanelOpen] = React.useState(true);

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
      className={`app-shell font-sans flex flex-col antialiased transition-colors ${
        beachMode
          ? "bg-[#020617] text-white"
          : "bg-[#0F172A] text-slate-100"
      }`}
    >
      {/* Header — shrink-0 no próprio componente, sempre visível */}
      <Header />

      {/* Área central do app: quando for chat ou mapa, gerencia scroll internamente */}
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
        {activeTab === "chat" && <ChatView />}
        {activeTab === "anuncios" && <MarketplaceView />}
        {(activeTab === "alertas" || activeTab === "mais") && (
          <EventsAndAlertsView />
        )}
      </main>

      {/* Botão SOS de Emergência (press-and-hold de 800ms) */}
      <SosButton
        hasActiveSos={Boolean(myActiveSos)}
        onSosTriggered={() => {
          setIsSosPanelOpen(true);
          fetchActiveSos();
        }}
      />

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
  const { isAuthenticated, isLoading } = useAuth();
  const [introDone, setIntroDone] = React.useState(false);

  // Enquanto verifica o cookie inicial da sessão, mantém fundo escuro sólido
  if (isLoading) {
    return <div className="min-h-screen bg-[#0B1220]" />;
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
      ) : (
        <KiteDataProvider>
          <MainContent />
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

