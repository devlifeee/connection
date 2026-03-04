import { useState, useEffect, useCallback } from 'react';
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

interface UserData {
  name: string;
  nodeId: string;
  avatar: number | string;
}

type AppState = 'loading' | 'registration' | 'main';

const Index = () => {
  const isMobile = useIsMobile();
  const { sessionState } = useSession();
  const [appState, setAppState] = useState<AppState>('loading');
  const [user, setUser] = useState<UserData | null>(null);
  const [activeSection, setActiveSection] = useState<NavSection>('chats');
  const [activeDialog, setActiveDialog] = useState<string | null>('УЗЛ-4a7c1f9e');
  const [selectedNode, setSelectedNode] = useState<string | null>('УЗЛ-4a7c1f9e');
  const [showMobileChat, setShowMobileChat] = useState(false);

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
    setAppState('registration');
  }, []);

  if (appState === 'loading') {
    return <LoadingScreen onComplete={handleLoadingComplete} />;
  }

  if (appState === 'registration' || !user) {
    return <RegistrationScreen onRegister={handleRegister} />;
  }

  const renderMainContent = () => {
    switch (activeSection) {
      case 'chats':
        return <ChatPanel dialogNodeId={activeDialog} onSelectNode={setSelectedNode} />;
      case 'files':
        return <FilesPanel />;
      case 'calls':
        return <CallsPanel />;
      case 'nodes':
        return <NodesPanel onChatWith={handleChatWith} userAvatar={user.avatar} />;
      case 'settings':
        return <SettingsPanel user={user} onUpdateUser={handleUpdateUser} />;
      default:
        return null;
    }
  };

  // Mobile layout
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

  // Desktop layout
  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <Sidebar
        user={user}
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        activeDialog={activeDialog}
        onDialogSelect={handleDialogSelect}
        onLogout={handleLogout}
      />
      <div className="flex-1 flex flex-col min-w-0">
        {renderMainContent()}
      </div>
      {activeSection === 'chats' && (
        <NodeInfoPanel nodeId={selectedNode} />
      )}
    </div>
  );
};

export default Index;
