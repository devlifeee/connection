import { MessageSquare, FolderOpen, Phone, Network, Settings, LogOut, Search } from 'lucide-react';
import GeometricAvatar from './GeometricAvatar';
import { dialogs, getNodeByNodeId } from '@/data/mockData';
import { ScrollArea } from '@/components/ui/scroll-area';

export type NavSection = 'chats' | 'files' | 'calls' | 'nodes' | 'settings';

interface Props {
  user: { name: string; nodeId: string; avatar: number | string };
  activeSection: NavSection;
  onSectionChange: (s: NavSection) => void;
  activeDialog: string | null;
  onDialogSelect: (nodeId: string) => void;
  className?: string;
  onLogout?: () => void;
}

const navItems: { id: NavSection; icon: typeof MessageSquare; label: string }[] = [
  { id: 'chats', icon: MessageSquare, label: 'Чаты' },
  { id: 'files', icon: FolderOpen, label: 'Файлы' },
  { id: 'calls', icon: Phone, label: 'Звонки' },
  { id: 'nodes', icon: Network, label: 'Узлы' },
  { id: 'settings', icon: Settings, label: 'Настройки' },
];

const Sidebar = ({ user, activeSection, onSectionChange, activeDialog, onDialogSelect, className = '', onLogout }: Props) => {
  return (
    <div className={`w-[320px] bg-background/80 dark:bg-card/90 backdrop-blur-xl flex flex-col h-full border-r border-border/40 shadow-xl z-20 ${className}`}>
      {/* App Title */}
      <div className="h-16 flex items-center px-6 shrink-0 gap-3">
        <div className="relative">
          <div className="absolute inset-0 bg-primary/20 blur-lg rounded-full" />
          <img src="src/assets/logo.png" alt="logo" className="w-9 h-9 relative z-10 rounded-xl shadow-sm"/>
        </div>
        <span className="font-bold text-xl tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
          HEX MVP
        </span>
      </div>

      {/* Navigation */}
      <div className="px-4 py-2 space-y-1.5">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => onSectionChange(item.id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
              activeSection === item.id
                ? 'bg-secondary/30 text-foreground border-l-2 border-primary/40'
                : 'text-muted-foreground hover:bg-secondary/40 hover:text-foreground'
            }`}
          >
            <item.icon size={18} strokeWidth={2} />
            <span>{item.label}</span>
            {item.id === 'chats' && (
               <span className="ml-auto bg-secondary/50 text-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-md">3</span>
            )}
          </button>
        ))}
      </div>

      {/* Chat List */}
      {activeSection === 'chats' && (
        <div className="flex-1 flex flex-col min-h-0 mt-2">
            <div className="px-4 py-2">
                <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input 
                        type="text" 
                        placeholder="Поиск..." 
                        className="w-full bg-secondary/50 border-none rounded-lg py-2 pl-9 pr-4 text-sm focus:ring-1 focus:ring-primary/50 outline-none placeholder:text-muted-foreground/50 transition-all dark:bg-white/5"
                    />
                </div>
            </div>
            <ScrollArea className="flex-1 px-2">
                <div className="space-y-1 p-2">
                    {dialogs.map(dialog => {
                        const node = getNodeByNodeId(dialog.nodeId);
                        if (!node) return null;
                        const isActive = activeDialog === dialog.nodeId;
                        
                        return (
                            <button
                                key={dialog.nodeId}
                                onClick={() => onDialogSelect(dialog.nodeId)}
                                className={`w-full flex items-center gap-3 p-3 rounded-2xl transition-all duration-200 text-left group ${
                                    isActive 
                                    ? 'bg-secondary/40 shadow-sm' 
                                    : 'hover:bg-secondary/40'
                                }`}
                            >
                                <div className="relative shrink-0">
                                    <GeometricAvatar index={node.avatar} size={44} selected={isActive} />
                                    {node.online && (
                                        <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500/80 border-2 border-background rounded-full" />
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-0.5">
                                        <span className={`text-sm font-semibold truncate ${isActive ? 'text-foreground' : 'text-foreground'}`}>
                                            {node.name}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground font-medium opacity-70">{dialog.time}</span>
                                    </div>
                                    <p className={`text-xs truncate leading-relaxed text-muted-foreground`}>
                                        {dialog.lastMessage}
                                    </p>
                                </div>
                                {dialog.unread > 0 && (
                                    <div className="shrink-0 flex items-center justify-center w-5 h-5 bg-secondary/60 text-foreground text-[10px] font-bold rounded-full">
                                        {dialog.unread}
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>
            </ScrollArea>
        </div>
      )}

      {/* Spacer if not in chats to push profile down */}
      {activeSection !== 'chats' && <div className="flex-1" />}

      {/* User Profile */}
      <div className="p-4 mt-auto border-t border-border/40 bg-background/50 dark:bg-card/60 backdrop-blur-sm">
        <div className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-secondary/60 transition-colors cursor-pointer group">
          <GeometricAvatar index={user.avatar} size={40} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate text-foreground">{user.name}</p>
            <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500/80" />
                <p className="text-xs text-muted-foreground truncate font-medium">Online</p>
            </div>
          </div>
          <button 
            onClick={onLogout}
            className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Выйти"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
