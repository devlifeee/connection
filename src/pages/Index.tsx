import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import LoadingScreen from '@/components/LoadingScreen';
import RegistrationScreen from '@/components/RegistrationScreen';
import Sidebar, { type NavSection } from '@/components/Sidebar';
import ChatPanel from '@/components/ChatPanel';
import FilesPanel from '@/components/FilesPanel';
import CallsPanel from '@/components/CallsPanel';
import NodesPanel from '@/components/NodesPanel';
import SettingsPanel from '@/components/SettingsPanel';
import NodeInfoPanel from '@/components/NodeInfoPanel';
import MobileNav from '@/components/MobileNav';
import { useIsMobile } from '@/hooks/use-mobile';
import { useSession } from '@/hooks/useSession';
import { toast } from 'sonner';

interface UserData {
  name: string;
  nodeId: string;
  avatar: number | string;
}

type AppState = 'loading' | 'registration' | 'main';

const Index = () => {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { sessionState, events } = useSession();
  const [appState, setAppState] = useState<AppState>('loading');
  const [user, setUser] = useState<UserData | null>(null);
  const [activeSection, setActiveSection] = useState<NavSection>('chats');
  const [activeDialog, setActiveDialog] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [showMobileChat, setShowMobileChat] = useState(false);
  const [showInfoPanel, setShowInfoPanel] = useState(false);

  // Load user from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('svyaz-user');
    if (saved) {
      setUser(JSON.parse(saved));
    }
  }, []);

  const handleLoadingComplete = useCallback(() => {
    const saved = localStorage.getItem('svyaz-user');
    setAppState(saved ? 'main' : 'registration');
  }, []);

  const handleRegister = useCallback((data: UserData) => {
    setUser(data);
    localStorage.setItem('svyaz-user', JSON.stringify(data));
    setAppState('main');
  }, []);

  const handleUpdateUser = useCallback((updates: Partial<UserData>) => {
    setUser(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...updates };
      localStorage.setItem('svyaz-user', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const handleDialogSelect = useCallback((nodeId: string) => {
    setActiveDialog(nodeId);
    setSelectedNode(nodeId);
    setActiveSection('chats');
    if (isMobile) setShowMobileChat(true);
  }, [isMobile]);

  const handleChatWith = useCallback((nodeId: string) => {
    setActiveDialog(nodeId);
    setSelectedNode(nodeId);
    setActiveSection('chats');
    if (isMobile) setShowMobileChat(true);
  }, [isMobile]);

  const handleLogout = useCallback(() => {
    setUser(null);
    localStorage.removeItem('svyaz-user');
    // Force reload to clear App state and ensure clean registration screen
    window.location.href = "/registration";
  }, []);

  // Global notifications for chat/call events
  useEffect(() => {
    const latest = (window as any).__events_notif_cache__ as Set<string> | undefined;
    if (!latest) (window as any).__events_notif_cache__ = new Set<string>();
    const cache = (window as any).__events_notif_cache__ as Set<string>;
    (events.slice(-10)).forEach(ev => {
      const id = `${ev.type}-${ev.timestamp}`;
      if (cache.has(id)) return;
      cache.add(id);
      if (ev.type === 'chat_message' && ev.env?.payload) {
        try {
          const txt = typeof ev.env.payload === 'object' ? ev.env.payload.text : '';
          if (txt) toast(`Сообщение от ${String(ev.env.sender).slice(0,8)}…`, { description: txt });
        } catch (_e) { void 0 }
      }
      if (ev.type === 'incoming_call' && ev.call) {
        toast('Входящий звонок', { description: `От ${String(ev.call.peer_id).slice(0,8)}…` });
      }
    });
    // limit cache size
    if ((window as any).__events_notif_cache__) {
      const arr = Array.from((window as any).__events_notif_cache__ as Set<string>);
      if (arr.length > 100) (window as any).__events_notif_cache__ = new Set(arr.slice(-50));
    }
  }, [events]);

  if (appState === 'loading') {
    return <LoadingScreen onComplete={handleLoadingComplete} />;
  }

  const renderMainContent = () => {
    switch (activeSection) {
      case 'chats':
        return <ChatPanel 
          dialogNodeId={activeDialog} 
          onSelectNode={setSelectedNode} 
          onToggleInfoPanel={() => setShowInfoPanel(v => !v)}
          onStartCall={(video) => {
             setActiveSection('calls');
             // We need to pass target peer to calls panel, but currently calls panel manages its own state
             // In a real app we would use a global call context or URL params
             // For now, let's just switch tab. The user will need to select peer again or we need to refactor CallsPanel to accept props
             // To fix this properly, let's save intent to localStorage so CallsPanel can pick it up
             if (activeDialog) {
                 localStorage.setItem('svyaz-call-intent', JSON.stringify({ peerId: activeDialog, video }));
             }
          }}
        />;
      case 'files':
        return <FilesPanel />;
      case 'calls':
        // Check for call intent on mount
        const intent = localStorage.getItem('svyaz-call-intent');
        let initialPeerId = null;
        let autoVideo = false;
        if (intent) {
            try {
                const data = JSON.parse(intent);
                initialPeerId = data.peerId;
                autoVideo = data.video;
                localStorage.removeItem('svyaz-call-intent');
            } catch {}
        }
        return <CallsPanel initialPeerId={initialPeerId} autoStart={!!initialPeerId} autoVideo={autoVideo} />;
      case 'nodes':
        return <NodesPanel onChatWith={handleChatWith} userAvatar={user!.avatar} />;
      case 'settings':
        return <SettingsPanel user={user!} onUpdateUser={handleUpdateUser} />;
      default:
        return null;
    }
  };

  if (isMobile) {
    return (
      <div className="h-[100dvh] flex flex-col bg-background">
        <div className="flex-1 overflow-hidden">
          {renderMainContent()}
        </div>
        <MobileNav active={activeSection} onChange={s => { setActiveSection(s); setShowMobileChat(false); }} />
        <div className="h-[env(safe-area-inset-bottom)]" />
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <Sidebar
        user={user!}
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        activeDialog={activeDialog}
        onDialogSelect={handleDialogSelect}
        onLogout={handleLogout}
      />
      <div
        className="flex flex-col min-w-0 transition-[width] duration-300 ease-out"
        style={{ width: showInfoPanel ? 'calc(100% - 350px)' : '100%' }}
      >
        {renderMainContent()}
      </div>
      {activeSection === 'chats' && showInfoPanel && <NodeInfoPanel nodeId={selectedNode} />}
    </div>
  );
};

export default Index;
