"use client";

import React from "react";
import { useAoMudar } from "@/lib/useAoMudar";
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
    modoNavegacaoSolo,
    setModoNavegacaoSolo,
    createDownwind,
    avisarInicioDeVelejo,
    spots,
  } = useKiteData();

  const { user } = useAuth();
  const {
    downwindAtivo,
    recarregar: recarregarDownwind,
    mostrarTelaDoDownwind,
    abrirTelaDoDownwind,
  } = useDownwind();
  const [modalCriarDwGlobalAberto, setModalCriarDwGlobalAberto] = React.useState(false);
  /*
   * SÓ TRAVESSIA EM ANDAMENTO troca a aba Mapa pelo mapa ao vivo.
   *
   * Era `Boolean(downwindAtivo)`, e /api/downwind/ativo devolve também os
   * downwinds `aberto` (agendados). Consequência relatada pelo dono: criar um
   * downwind para 5 de setembro tomava a aba Mapa NA HORA, mostrando o ponto A
   * como se fosse para começar. Um compromisso marcado não é uma travessia
   * acontecendo — quem quer começar entra no downwind e inicia por lá.
   *
   * O menu flutuante e as demais abas seguem disponíveis, como antes.
   */
  const emDownwind = mostrarTelaDoDownwind;
  // Inicializa painel SOS aberto se há SOS ativo; caso contrário fecha
  const [isSosPanelOpen, setIsSosPanelOpen] = React.useState(() => Boolean(myActiveSos));
  // Marca o estado do teclado no shell para o CSS zerar a folga do menu
  // (que é desmontado quando o teclado abre) e não deixar faixa vazia embaixo.
  const tecladoAberto = useKeyboardVisible();

  // Reabre o painel se um novo SOS do usuário for detectado. Ajuste no render
  // e não em efeito: o SOS é a tela mais urgente do app, e em efeito o React
  // pintava um quadro inteiro sem o painel antes de abri-lo. A chave é o ID,
  // não o objeto — o poll do contexto devolve um objeto novo a cada resposta,
  // e comparar identidade reabriria o painel que o velejador acabou de fechar.
  useAoMudar(myActiveSos?.id ?? null, () => {
    if (myActiveSos) setIsSosPanelOpen(true);
  });

  const [tokenConviteUrl, setTokenConviteUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const inviteToken = params.get('dw_invite');
    // Este setState-em-efeito fica: `window.location` não existe no servidor,
    // então ler a URL num inicializador de `useState` (que roda também no
    // SSR) daria divergência de hidratação justamente para quem chegou pelo
    // link de convite. Um render extra na montagem é o preço, e ele só
    // acontece quando o parâmetro está presente.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (inviteToken) setTokenConviteUrl(inviteToken);
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
          spots={spots}
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
          modoNavegacaoAtivo={modoNavegacaoSolo}
          onIniciarVelejoSolo={() => {
            // Lê o spot ANTES do setSelectedSpot(null) logo abaixo — depois
            // dele a informação some, e o aviso viraria "entrou na água" sem
            // dizer onde, que é bem menos útil para quem recebe.
            avisarInicioDeVelejo(selectedSpot?.name ?? null);
            setIsSheetIniciarOpen(false);
            setSelectedSpot(null);
            setActiveTab('mapa');
            /*
             * LIGA O MODO NAVEGAÇÃO. Faltava exatamente esta linha.
             *
             * O botão avisava os seguidores que o velejador entrou na água,
             * fechava a folha, ia para a aba Mapa — e parava aí. O relato foi
             * "cliquei em play, iniciar velejo solo, e voltou para o mapa
             * normal sem gravar", que é literalmente o que o código fazia.
             *
             * A causa não era esquecimento numa linha: `modoNavegacaoAtivo`
             * era estado LOCAL de views/MapView.tsx, e daqui não havia como
             * alcançá-lo. A outra folha (a do próprio mapa) funcionava, então
             * o defeito só aparecia por este caminho — o do menu inferior, que
             * é o que a maioria usa. O estado foi para o KiteDataContext, que
             * é onde já moram `isSheetIniciarOpen` e `activeTab`.
             *
             * Pior que não funcionar: o aviso de "entrei na água" ia para os
             * seguidores enquanto nada era gravado.
             */
            setModoNavegacaoSolo(true);
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
            // Pedido explícito de abrir o downwind. Necessário para o
            // AGENDADO: ele não toma a aba Mapa sozinho (ver
            // mapaMostraDownwind em lib/activity.ts), então sem isto o
            // botão levaria ao mapa normal.
            abrirTelaDoDownwind();
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
  // A leitura do localStorage no render é segura AQUI porque só acontece
  // depois de `isAuthenticated` virar true — o que exige uma resposta de rede,
  // ou seja, bem depois da hidratação. No primeiro render (servidor e
  // cliente) a chave é `null` e nada é lido.
  const idParaChecarPermissoes =
    isAuthenticated && !mustChangePassword ? (user?.id ?? null) : null;
  useAoMudar(idParaChecarPermissoes, () => {
    if (idParaChecarPermissoes) setPermissoesFeitas(permissoesJaPedidas(idParaChecarPermissoes));
  });
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

