import { MessageSquare, FolderOpen, Phone, Network, Settings } from 'lucide-react';
import type { NavSection } from './Sidebar';

interface Props {
  active: NavSection;
  onChange: (s: NavSection) => void;
}

const items: { id: NavSection; icon: typeof MessageSquare; label: string }[] = [
  { id: 'chats', icon: MessageSquare, label: 'Чаты' },
  { id: 'files', icon: FolderOpen, label: 'Файлы' },
  { id: 'calls', icon: Phone, label: 'Звонки' },
  { id: 'nodes', icon: Network, label: 'Узлы' },
  { id: 'settings', icon: Settings, label: 'Настройки' },
];

const MobileNav = ({ active, onChange }: Props) => (
  <nav className="fixed bottom-0 left-0 right-0 bg-background border-t border-border flex justify-around py-2 z-40 md:hidden">
    {items.map(item => (
      <button
        key={item.id}
        onClick={() => onChange(item.id)}
        className={`flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] transition-colors ${
          active === item.id ? 'text-primary' : 'text-muted-foreground'
        }`}
      >
        <item.icon size={18} />
        <span>{item.label}</span>
      </button>
    ))}
  </nav>
);

export default MobileNav;
