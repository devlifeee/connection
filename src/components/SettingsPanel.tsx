import { useState } from 'react';
import { Lock, AlertTriangle, RefreshCw, Copy, Upload, Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import GeometricAvatar from './GeometricAvatar';
import SessionInfo from './SessionInfo';
import { generateNodeId } from '@/data/mockData';
import { useToast } from '@/hooks/use-toast';
import Logo from './Logo';
import { roadmapPhases } from '@/content/backendBlueprint';
import { useNodeAgentHealth, useNodeAgentIdentity, useNodeAgentPresence, useNodeAgentProtocols } from "@/hooks/useNodeAgent";
import { useTheme } from '@/hooks/useTheme';

type SettingsTab = 'profile' | 'network' | 'sessions' | 'privacy' | 'audio' | 'interface' | 'about';

interface Props {
  user: { name: string; nodeId: string; avatar: number | string };
  onUpdateUser: (data: Partial<{ name: string; nodeId: string; avatar: number | string }>) => void;
}

const tabs: { id: SettingsTab; label: string }[] = [
  { id: 'profile', label: 'Профиль' },
  { id: 'network', label: 'Сеть' },
  { id: 'sessions', label: 'Сессии' },
  { id: 'privacy', label: 'Приватность' },
  { id: 'audio', label: 'Аудио и видео' },
  { id: 'interface', label: 'Интерфейс' },
  { id: 'about', label: 'О приложении' },
];

const SettingsPanel = ({ user, onUpdateUser }: Props) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const [name, setName] = useState(user.name);
  const { toast } = useToast();
  const health = useNodeAgentHealth();
  const identity = useNodeAgentIdentity();
  const presence = useNodeAgentPresence();
  const protocols = useNodeAgentProtocols();
  const { theme, toggleTheme } = useTheme();

  // Settings state
  const [mdns, setMdns] = useState(true);
  const [udp, setUdp] = useState(false);
  const [port, setPort] = useState('9876');
  const [showIp, setShowIp] = useState(true);
  const [saveHistory, setSaveHistory] = useState(true);
  const [vanishing, setVanishing] = useState(false);
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [echoCancellation, setEchoCancellation] = useState(true);
  const [compactView, setCompactView] = useState(false);
  const [showIdInChat, setShowIdInChat] = useState(false);
  const [networkAnimation, setNetworkAnimation] = useState(true);
  const [fontSize, setFontSize] = useState<'small' | 'medium' | 'large'>('medium');

  const copyId = () => {
    navigator.clipboard.writeText(user.nodeId);
    toast({ title: 'Скопировано', description: user.nodeId });
  };

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {/* Tab list */}
      <div className="w-48 border-r border-border p-3 space-y-1 shrink-0 hidden sm:block">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              activeTab === t.id ? 'bg-card text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-6 space-y-6">
        {/* Mobile tabs */}
        <div className="flex gap-2 overflow-x-auto sm:hidden pb-2">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap ${
                activeTab === t.id ? 'bg-card text-primary' : 'text-muted-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === 'profile' && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Профиль</h3>
            <div className="flex items-center gap-4 mb-4">
              <GeometricAvatar index={user.avatar} size={64} />
              <div className="flex flex-col gap-2">
                <div className="flex gap-2 flex-wrap">
                  {[0, 1, 2, 3, 4, 5].map(i => (
                    <GeometricAvatar key={i} index={i} size={32} selected={user.avatar === i}
                      onClick={() => onUpdateUser({ avatar: i })} />
                  ))}
                  <div className="relative">
                    <input 
                      type="file" 
                      id="settings-avatar-upload"
                      className="hidden" 
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            onUpdateUser({ avatar: reader.result as string });
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                    <Button 
                      variant="outline" 
                      size="icon" 
                      className="h-8 w-8 rounded-full"
                      onClick={() => document.getElementById('settings-avatar-upload')?.click()}
                    >
                      <Upload size={14} />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Имя</label>
              <div className="flex gap-2">
                <Input value={name} onChange={e => setName(e.target.value)} className="bg-card" />
                <Button size="sm" onClick={() => { onUpdateUser({ name }); toast({ title: 'Сохранено' }); }}>
                  Сохранить
                </Button>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Идентификатор</label>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-primary">{user.nodeId}</span>
                <Copy size={14} className="cursor-pointer text-muted-foreground hover:text-foreground" onClick={copyId} />
              </div>
            </div>
            <Button variant="outline" size="sm" className="gap-2"
              onClick={() => {
                const newId = generateNodeId();
                onUpdateUser({ nodeId: newId });
                toast({ title: 'Новый ключ сгенерирован', description: newId });
              }}
            >
              <RefreshCw size={14} /> Сгенерировать новый ключ
            </Button>
            <p className="text-[10px] text-destructive flex items-center gap-1">
              <AlertTriangle size={10} /> Смена ключа приведёт к потере текущей идентичности
            </p>
          </div>
        )}

        {activeTab === 'network' && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Сеть</h3>
            <SettingToggle label="Автообнаружение (mDNS)" checked={mdns} onChange={setMdns} />
            <SettingToggle label="UDP-рассылка (резерв)" checked={udp} onChange={setUdp} />
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Порт</label>
              <Input value={port} onChange={e => setPort(e.target.value)} className="bg-card w-32" />
            </div>
            <SettingToggle label="Показывать IP другим узлам" checked={showIp} onChange={setShowIp} />

            <div className="bg-card border border-border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Node Agent</p>
                <span className={`text-[10px] ${health.data?.ok ? "text-primary" : "text-muted-foreground"}`}>
                  {health.data?.ok ? "online" : "offline"}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground">Peer ID</p>
                  <p className="font-mono break-all">{identity.data?.peer_id ?? "—"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground">Fingerprint</p>
                  <p className="font-mono break-all">{identity.data?.fingerprint ?? "—"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground">Name</p>
                  <p className="font-mono break-all">{presence.data?.display_name ?? "—"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground">Version</p>
                  <p className="font-mono">{presence.data?.version ?? "—"}</p>
                </div>
              </div>
              {protocols.data?.protocols && (
                <div className="pt-2 border-t border-border">
                  <p className="text-[10px] text-muted-foreground mb-2">Protocols</p>
                  <div className="space-y-1 text-[11px] text-muted-foreground font-mono">
                    {Object.entries(protocols.data.protocols).map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between gap-2">
                        <span>{k}</span>
                        <span className="text-foreground/70 break-all">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="text-[10px] text-muted-foreground">
                {health.data?.ok ? `uptime: ${health.data.uptime}` : "запусти node-agent: cd node-agent && go run ."}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'sessions' && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Сессии и терминалы</h3>
            <SessionInfo />
          </div>
        )}

        {activeTab === 'privacy' && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Приватность</h3>
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <Lock size={14} className="text-primary" />
                <span className="text-sm">Сквозное шифрование</span>
              </div>
              <Switch checked disabled />
            </div>
            <SettingToggle label="Сохранять историю локально" checked={saveHistory} onChange={setSaveHistory} />
            <Button variant="destructive" size="sm">Очистить историю</Button>
            <SettingToggle label="Исчезающие сообщения" checked={vanishing} onChange={setVanishing} />
          </div>
        )}

        {activeTab === 'audio' && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Аудио и видео</h3>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Микрофон</label>
              <select className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm">
                <option>Микрофон по умолчанию</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Камера</label>
              <select className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm">
                <option>Камера по умолчанию</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Динамики</label>
              <select className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm">
                <option>Динамики по умолчанию</option>
              </select>
            </div>
            {/* Audio level visualizer */}
            <div>
              <label className="text-xs text-muted-foreground mb-2 block">Уровень звука</label>
              <div className="flex gap-1 h-8 items-end">
                {Array.from({ length: 16 }).map((_, i) => (
                  <div key={i} className="w-2 bg-primary rounded-sm animate-pulse"
                    style={{ height: `${Math.random() * 100}%`, animationDelay: `${i * 0.1}s` }} />
                ))}
              </div>
            </div>
            <SettingToggle label="Шумоподавление" checked={noiseSuppression} onChange={setNoiseSuppression} />
            <SettingToggle label="Эхоподавление" checked={echoCancellation} onChange={setEchoCancellation} />
          </div>
        )}

        {activeTab === 'interface' && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Интерфейс</h3>
            
            <div className="flex items-center justify-between p-4 rounded-lg border bg-card/50">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                    {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
                    <span className="text-sm font-medium">Темная тема</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Переключение между светлым и темным оформлением
                </p>
              </div>
              <Switch checked={theme === 'dark'} onCheckedChange={toggleTheme} />
            </div>

            <SettingToggle label="Компактный вид списка чатов" checked={compactView} onChange={setCompactView} />
            <SettingToggle label="Показывать ID собеседника" checked={showIdInChat} onChange={setShowIdInChat} />
            <SettingToggle label="Анимации сети" checked={networkAnimation} onChange={setNetworkAnimation} />
            
            <div>
              <label className="text-xs text-muted-foreground mb-2 block">Размер шрифта</label>
              <div className="flex gap-2">
                {(['small', 'medium', 'large'] as const).map(s => (
                  <button key={s} onClick={() => setFontSize(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                      fontSize === s ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground'
                    }`}
                  >
                    {s === 'small' ? 'Мелкий' : s === 'medium' ? 'Средний' : 'Крупный'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'about' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Logo size={48} />
              <div>
                <h3 className="text-lg font-semibold">СВЯЗЬ</h3>
                <p className="text-xs text-muted-foreground">v0.1.0</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">Разработано для NuclearHack МИФИ</p>
            <p className="text-sm text-muted-foreground italic">
              «Без серверов. Без аккаунтов. Без компромиссов.»
            </p>
            <div className="bg-card border border-border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Backend Roadmap</p>
                <span className="text-[10px] text-muted-foreground">Runtime Platform</span>
              </div>
              <div className="space-y-2">
                {roadmapPhases.map(phase => (
                  <div key={phase.title} className="border border-border rounded-md px-3 py-2 bg-background/40">
                    <p className="text-xs font-semibold mb-1">{phase.title}</p>
                    <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                      {phase.items.map(item => (
                        <span key={item} className="px-2 py-0.5 rounded-full border border-border bg-card">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

function SettingToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export default SettingsPanel;
