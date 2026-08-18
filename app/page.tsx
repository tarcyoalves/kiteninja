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
import { AuthModal } from "../components/AuthModal";
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
    isHydrated,
  } = useKiteData();

  if (!isHydrated) {
    // Render a silent placeholder while the client hydrates localStorage state.
    return (
      <div className="min-h-screen bg-[#0F172A]" />
    );
  }

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

      {/* Único elemento que rola no app. Ver .app-scroll em globals.css. */}
      <main className="app-scroll w-full max-w-lg mx-auto">
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
      <AuthModal />
    </div>
  );
};

/**
 * Portão de acesso.
 * A abertura com o vídeo selecionado pelo admin é exibida sempre que o app abre.
 * Após a finalização (ou clique em Pular), o velejador segue para o conteúdo do app
 * se estiver autenticado, ou para o LoginGate se for visitante.
 */
const Gate: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  const [introDone, setIntroDone] = React.useState(false);

  // Enquanto verifica o cookie inicial da sessão, mantém fundo escuro sólido
  if (isLoading) {
    return <div className="min-h-screen bg-[#0B1220]" />;
  }

  // Abertura com vídeo selecionado (ou animação de reserva) sempre na inicialização
  if (!introDone) {
    return (
      <SplashIntro
        onDone={() => {
          marcarIntroVista();
          setIntroDone(true);
        }}
      />
    );
  }

  // Visitante sem sessão ativa vai para a tela de acesso/login
  if (!isAuthenticated) {
    return <LoginGate />;
  }

  // Velejador autenticado entra direto na experiência completa
  return (
    <KiteDataProvider>
      <MainContent />
    </KiteDataProvider>
  );
};

export default function Page() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

