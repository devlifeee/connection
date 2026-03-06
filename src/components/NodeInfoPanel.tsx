import { Activity, MessageSquare, FolderOpen, Lock, Key, ShieldCheck, Phone, Video, Paperclip, ShieldX, Copy, MoreHorizontal, Bell, FileText, Share2 } from 'lucide-react';
import GeometricAvatar from './GeometricAvatar';
import { useNodeAgentPresencePeers, useChatHistory } from '@/hooks/useNodeAgent';
import { useEffect, useState } from 'react';
import { nodeAgentApi } from '@/api/nodeAgent';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Props {
  nodeId: string | null;
  className?: string;
}

const NodeInfoPanel = ({ nodeId, className = '' }: Props) => {
  const { data } = useNodeAgentPresencePeers();
  const peer = nodeId ? (data?.peers ?? []).find(p => p.payload.peer_id === nodeId) ?? null : null;
  const [peerInfo, setPeerInfo] = useState<{ p2p_addrs: string[]; fingerprint?: string } | null>(null);
  const chatHistory = useChatHistory(nodeId || undefined);
  
  useEffect(() => {
    let cancelled = false;
    if (peer?.payload.peer_id) {
      nodeAgentApi.peerAddrs(peer.payload.peer_id).then(info => { if (!cancelled) setPeerInfo({ p2p_addrs: info.p2p_addrs, fingerprint: info.fingerprint }); }).catch(() => setPeerInfo(null));
    } else {
      setPeerInfo(null);
    }
    return () => { cancelled = true };
  }, [peer?.payload.peer_id]);
  const { toast } = useToast();

  if (!peer) {
    return (
      <div className={`w-[350px] border-l border-white/5 bg-background/60 dark:bg-[#0a0b10]/90 backdrop-blur-xl p-6 flex items-center justify-center ${className}`}>
        <p className="text-sm text-muted-foreground text-center font-medium">Выберите узел для просмотра информации</p>
      </div>
    );
  }

  const copyId = () => {
    navigator.clipboard.writeText(peer.payload.peer_id);
    toast({ title: 'Скопировано', description: peer.payload.peer_id });
  };

  // Calculate stats
  const messages = chatHistory.data?.messages ?? [];
  const sentCount = messages.filter((m: any) => m.from === 'me' || m.sender === 'me').length;
  const receivedCount = messages.length - sentCount;
  
  const files = messages.filter((m: any) => m.type === 'file' || m.payload?.type === 'file' || m.payload?.text?.startsWith('[file]'));
  const filesCount = files.length;
  const totalSizeMB = (filesCount * 1.4).toFixed(1);

  // Format ID like "УЗЛ-..."
  const formattedId = `УЗЛ-${peer.payload.peer_id.substring(0, 8)}`;

  // Block contact logic (mock DB)
  const [isBlocked, setIsBlocked] = useState(false);
  useEffect(() => {
      try {
          const blocked = JSON.parse(localStorage.getItem('svyaz-blocked-contacts') || '[]');
          setIsBlocked(blocked.includes(nodeId));
      } catch {}
  }, [nodeId]);

  const toggleBlock = () => {
      if (!nodeId) return;
      try {
          const blocked = JSON.parse(localStorage.getItem('svyaz-blocked-contacts') || '[]');
          let newBlocked;
          if (isBlocked) {
              newBlocked = blocked.filter((id: string) => id !== nodeId);
              toast({ title: 'Контакт разблокирован' });
          } else {
              newBlocked = [...blocked, nodeId];
              toast({ title: 'Контакт заблокирован', variant: 'destructive' });
          }
          localStorage.setItem('svyaz-blocked-contacts', JSON.stringify(newBlocked));
          setIsBlocked(!isBlocked);
      } catch {}
  };

  return (
    <div className={`w-[500px] border-l border-white/5 bg-background/60 dark:bg-[#0a0b10]/90 backdrop-blur-xl flex flex-col h-full shadow-2xl z-10 ${className}`}>
        <div className="p-6 flex items-center justify-between shrink-0">
            <span className="font-bold text-sm text-muted-foreground tracking-wider uppercase">Информация</span>
        </div>
        
        <ScrollArea className="flex-1 px-6">
            <div className="pb-6 space-y-6">
                {/* Profile Card */}
                <div className="flex flex-col items-center bg-gradient-to-b from-secondary/30 to-background dark:from-[#15181D] dark:to-[#0F1115] border border-white/10 rounded-3xl p-6 shadow-sm relative overflow-hidden group">
                    <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                    <GeometricAvatar index={1} size={100} className="shadow-2xl shadow-primary/20" />
                    <div className="mt-4 text-center relative z-10 w-full">
                        <h2 className="text-xl font-bold tracking-tight truncate px-4">{peer.payload.display_name || formattedId}</h2>
                        <button onClick={copyId} className="flex items-center justify-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/40 px-3 py-1.5 rounded-md transition-all mt-2 mx-auto cursor-pointer">
                            {formattedId} <Copy size={12} />
                        </button>
                        <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border bg-green-500/10 text-green-600 border-green-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shadow-[0_0_5px_rgba(34,197,94,0.5)]" />
                            Online
                        </div>
                        <div className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-green-500/80 font-medium bg-green-500/5 px-3 py-1 rounded-full border border-green-500/10">
                            <ShieldCheck size={12} /> Личность подтверждена
                        </div>
                    </div>
                </div>

                

                {/* Stats Grid */}
                <div className="space-y-3">
                    <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider ml-1">Статистика</h3>
                    <div className="grid grid-cols-2 gap-3">
                        <StatCard icon={Activity} label="Задержка" value="12 ms" trend="good" />
                        <StatCard icon={MessageSquare} label="Сообщения" value={`${sentCount} / ${receivedCount}`} subtext="отпр. / получ." />
                        <StatCard icon={FolderOpen} label="Файлы" value={`${filesCount}`} subtext={`${totalSizeMB} МБ`} />
                        <StatCard icon={ShieldCheck} label="Сессия" value="24m" subtext="активна" highlightValue />
                    </div>
                </div>

                {/* Security */}
                <div className="space-y-3">
                    <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider ml-1">Безопасность</h3>
                    <div className="bg-secondary/20 dark:bg-[#1a1b20]/50 border border-white/5 rounded-2xl p-4 space-y-3 backdrop-blur-sm">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-green-500/10 rounded-xl text-green-500 shadow-[0_0_10px_rgba(34,197,94,0.2)]">
                                <Lock size={18} />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-semibold">Noise Protocol</p>
                                <p className="text-[10px] text-muted-foreground">End-to-end шифрование</p>
                            </div>
                        </div>
                        <div className="h-px bg-border/40" />
                        <div className="w-full flex items-center justify-between group">
                            <div className="flex items-center gap-3 overflow-hidden">
                                <div className="p-2 bg-secondary/40 rounded-xl text-muted-foreground shrink-0">
                                    <Key size={18} />
                                </div>
                                <div className="text-left min-w-0">
                                    <p className="text-sm font-semibold">Отпечаток</p>
                                    <p className="text-[10px] text-muted-foreground font-mono truncate w-48" title={peerInfo?.fingerprint}>
                                        {peerInfo?.fingerprint ? `${peerInfo.fingerprint.substring(0, 20)}...` : 'недоступно'}
                                    </p>
                                </div>
                            </div>
                            <Copy size={14} className="text-muted-foreground opacity-60 cursor-pointer hover:text-primary" onClick={() => {
                                if (peerInfo?.fingerprint) {
                                    navigator.clipboard.writeText(peerInfo.fingerprint);
                                    toast({ title: 'Отпечаток скопирован' });
                                }
                            }} />
                        </div>
                    </div>
                </div>

                {/* Shared Media */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                         <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider ml-1">Медиа и файлы</h3>
                    </div>
                    
                    <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
                        <div className="w-20 h-20 bg-secondary/30 dark:bg-[#1a1b20] rounded-2xl flex items-center justify-center shrink-0 border border-white/5 hover:border-primary/30 transition-colors">
                            <FileText size={24} className="text-muted-foreground" />
                        </div>
                        <div className="w-20 h-20 bg-secondary/30 dark:bg-[#1a1b20] rounded-2xl flex items-center justify-center shrink-0 border border-white/5 hover:border-primary/30 transition-colors">
                            <FolderOpen size={24} className="text-muted-foreground" />
                        </div>
                        <div className="w-20 h-20 bg-secondary/30 dark:bg-[#1a1b20] rounded-2xl flex items-center justify-center shrink-0 border border-white/5 hover:border-primary/30 transition-colors">
                            <Share2 size={24} className="text-muted-foreground" />
                        </div>
                    </div>
                </div>

                <button 
                    onClick={toggleBlock}
                    className={`w-full py-3 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2 mt-4 ${
                        isBlocked 
                        ? 'text-white bg-destructive hover:bg-destructive/90 shadow-lg shadow-destructive/20' 
                        : 'text-destructive bg-destructive/5 hover:bg-destructive/10 border border-destructive/10'
                    }`}
                >
                    <ShieldX size={16} /> {isBlocked ? 'Разблокировать контакт' : 'Заблокировать контакт'}
                </button>
            </div>
        </ScrollArea>
    </div>
  );
};

function StatCard({ icon: Icon, label, value, subtext, trend, highlightValue }: { icon: any, label: string, value: string, subtext?: string, trend?: 'good' | 'bad', highlightValue?: boolean }) {
    return (
        <div className="bg-background/40 dark:bg-[#1a1b20]/40 border border-white/5 p-3 rounded-2xl shadow-sm hover:bg-secondary/40 transition-colors group">
            <div className="flex items-start justify-between mb-2">
                <div className="p-1.5 bg-secondary dark:bg-black/40 rounded-lg text-muted-foreground group-hover:text-primary transition-colors">
                    <Icon size={14} />
                </div>
                {trend && (
                    <div className={`w-1.5 h-1.5 rounded-full ${trend === 'good' ? 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.5)]' : 'bg-red-500'}`} />
                )}
            </div>
            <p className={`text-lg font-bold leading-tight ${highlightValue ? 'text-primary glow-text-blue' : ''}`}>{value}</p>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mt-1">{label}</p>
            {subtext && <p className="text-[10px] text-muted-foreground/60 mt-0.5 truncate">{subtext}</p>}
        </div>
    )
}

function ActionButton({ icon: Icon, label, active }: { icon: any, label: string, active?: boolean }) {
    return (
        <button className={`flex flex-col items-center justify-center gap-1.5 p-2 rounded-2xl transition-all ${active ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/25 scale-105 glow-blue' : 'bg-secondary/50 dark:bg-[#1a1b20]/50 text-muted-foreground hover:bg-secondary hover:text-foreground border border-transparent hover:border-primary/20'}`}>
            <Icon size={20} strokeWidth={2} />
            <span className="text-[10px] font-medium">{label}</span>
        </button>
    )
}

export default NodeInfoPanel;
