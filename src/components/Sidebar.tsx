import { MessageSquare, FolderOpen, Phone, Network, Settings, Plus, Hash } from 'lucide-react';
import Logo from './Logo';
import GeometricAvatar from './GeometricAvatar';
import NetworkMiniGraph from './NetworkMiniGraph';
import { nodes, dialogs, getNodeByNodeId, channels } from '@/data/mockData';

export type NavSection = 'chats' | 'files' | 'calls' | 'nodes' | 'settings';

interface Props {
  user: { name: string; nodeId: string; avatar: number };
  activeSection: NavSection;
  onSectionChange: (s: NavSection) => void;
  activeDialog: string | null;
  onDialogSelect: (nodeId: string) => void;
  className?: string;
}

const navItems: { id: NavSection; icon: typeof MessageSquare; label: string }[] = [
  { id: 'chats', icon: MessageSquare, label: 'Чаты' },
  { id: 'files', icon: FolderOpen, label: 'Файлы' },
  { id: 'calls', icon: Phone, label: 'Звонки' },
  { id: 'nodes', icon: Network, label: 'Узлы' },
  { id: 'settings', icon: Settings, label: 'Настройки' },
];

const Sidebar = ({ user, activeSection, onSectionChange, activeDialog, onDialogSelect, className = '' }: Props) => {
  const onlineCount = nodes.filter(n => n.online).length;

  return (
    <div className={`w-[260px] bg-background border-r border-border flex flex-col h-full overflow-hidden ${className}`}>
      {/* Profile */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-3 mb-2">
          <Logo size={28} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <GeometricAvatar index={user.avatar} size={32} />
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{user.name}</p>
                <p className="font-mono text-xs text-primary truncate">{user.nodeId}</p>
              </div>
            </div>
          </div>
          <button onClick={() => onSectionChange('settings')} className="text-muted-foreground hover:text-foreground">
            <Settings size={16} />
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse-dot" />
          <span>Подключён</span>
        </div>
      </div>

      {/* Network status */}
      <div className="px-4 py-3 border-b border-border">
        <p className="text-xs text-muted-foreground mb-1">{onlineCount + 1} узлов · 12 мс · LAN</p>
        <NetworkMiniGraph />
      </div>

      {/* Navigation */}
      <div className="px-2 py-2 border-b border-border">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => onSectionChange(item.id)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              activeSection === item.id
                ? 'bg-card text-primary border border-primary/25'
                : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
            }`}
          >
            <item.icon size={16} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      {/* Dialogs */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="px-4 py-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Личные сообщения</span>
          <Plus size={14} className="text-muted-foreground cursor-pointer hover:text-foreground" />
        </div>
        {dialogs.map(d => {
          const node = getNodeByNodeId(d.nodeId);
          if (!node) return null;
          const isActive = activeDialog === d.nodeId;
          return (
            <button
              key={d.nodeId}
              onClick={() => { onDialogSelect(d.nodeId); onSectionChange('chats'); }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors ${
                isActive ? 'bg-card border-l-2 border-primary' : 'hover:bg-card/50'
              }`}
            >
              <GeometricAvatar index={node.avatar} size={36} />
              <div className="flex-1 min-w-0 text-left">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium truncate">{node.name}</span>
                  <span className="text-[10px] text-muted-foreground">{d.time}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{d.lastMessage}</p>
              </div>
              {d.unread > 0 && (
                <span className="bg-primary text-primary-foreground text-[10px] rounded-full w-5 h-5 flex items-center justify-center font-medium">
                  {d.unread}
                </span>
              )}
            </button>
          );
        })}

        {/* Channels */}
        <div className="px-4 py-2 flex items-center justify-between mt-2">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Каналы</span>
          <Plus size={14} className="text-muted-foreground cursor-pointer hover:text-foreground" />
        </div>
        {channels.map(ch => (
          <button
            key={ch.name}
            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-card/50 transition-colors"
          >
            <Hash size={14} />
            <span>{ch.name}</span>
            <span className="text-[10px] ml-auto">{ch.members}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default Sidebar;
