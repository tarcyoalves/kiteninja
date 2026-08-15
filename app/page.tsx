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

      {/* Main Active View Container */}
      <main className="flex-1 w-full max-w-lg mx-auto">
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

export default function Page() {
  return (
    <AuthProvider>
      <KiteDataProvider>
        <MainContent />
      </KiteDataProvider>
    </AuthProvider>
  );
}
