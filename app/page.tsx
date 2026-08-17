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
import { AuthModal } from "../components/AuthModal";
import { SpotsView } from "../views/SpotsView";
import { MapView } from "../views/MapView";
import { FeedView } from "../views/FeedView";
import { SessionsView } from "../views/SessionsView";
import { EventsAndAlertsView } from "../views/EventsAndAlertsView";
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
    <div
      className={`min-h-screen font-sans flex flex-col antialiased transition-colors ${
        beachMode
          ? "bg-[#020617] text-white"
          : "bg-[#0F172A] text-slate-100"
      }`}
    >
      {/* Mobile Header */}
      <Header />

      {/*
        O menu inferior é `fixed`, então sai do fluxo e não empurra nada. Sem
        reservar a altura dele aqui (h-16 + safe area do iPhone), o fim de cada
        tela ficava escondido atrás do menu — o "corte" nos cards.
      */}
      <main className="flex-1 w-full max-w-lg mx-auto pb-nav">
        {activeTab === "favoritos" && (
          <SpotsView onSelectSpot={(spot) => setSelectedSpot(spot)} />
        )}
        {activeTab === "mapa" && (
          <MapView onSelectSpot={(spot) => setSelectedSpot(spot)} />
        )}
        {activeTab === "destaques" && <FeedView />}
        {activeTab === "sessoes" && <SessionsView />}
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
      <AuthModal />
    </div>
  );
};

/**
 * Portão de acesso. O conteúdo do app só é montado com sessão válida — a
 * proteção real está nas rotas de API, e aqui garantimos que quem não entrou
 * não recebe nem o HTML das telas internas.
 *
 * A abertura animada roda só para visitante sem sessão, e só uma vez por aba:
 * quem já está logado abre direto no vento, sem espera artificial.
 */
const Gate: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  const [introDone, setIntroDone] = React.useState(() => introJaVista());

  // Enquanto verificamos o cookie não sabemos se é visitante ou velejador
  // logado. Mostrar a intro aqui puniria quem já tem sessão.
  if (isLoading) {
    return <div className="min-h-screen bg-[#0B1220]" />;
  }

  if (!isAuthenticated) {
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
    return <LoginGate />;
  }

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
