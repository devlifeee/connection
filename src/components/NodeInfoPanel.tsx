import { Activity, MessageSquare, FolderOpen, Lock, Key, ShieldCheck, Phone, Video, Paperclip, ShieldX, Copy, MoreHorizontal, Bell, FileText, Share2 } from 'lucide-react';
import GeometricAvatar from './GeometricAvatar';
import { getNodeByNodeId } from '@/data/mockData';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Props {
  nodeId: string | null;
  className?: string;
}

const NodeInfoPanel = ({ nodeId, className = '' }: Props) => {
  const node = nodeId ? getNodeByNodeId(nodeId) : null;
  const { toast } = useToast();

  if (!node) {
    return (
      <div className={`w-[350px] border-l border-white/5 bg-background/60 dark:bg-[#0a0b10]/90 backdrop-blur-xl p-6 flex items-center justify-center ${className}`}>
        <p className="text-sm text-muted-foreground text-center font-medium">Выберите узел для просмотра информации</p>
      </div>
    );
  }

  const copyId = () => {
    navigator.clipboard.writeText(node.nodeId);
    toast({ title: 'Скопировано', description: node.nodeId });
  };

  const copyFingerprint = () => {
    navigator.clipboard.writeText(node.fingerprint);
    toast({ title: 'Скопировано', description: node.fingerprint });
  };

  return (
    <div className={`w-[350px] border-l border-white/5 bg-background/60 dark:bg-card/90 backdrop-blur-xl flex flex-col h-full shadow-2xl z-10 ${className}`}>
        <div className="p-4 flex items-center justify-between shrink-0">
            <span className="font-bold text-sm text-muted-foreground tracking-wider uppercase">Информация</span>
            
        </div>
        
        <ScrollArea className="flex-1 px-5">
            <div className="pb-6 space-y-6">
                {/* Profile Card */}
                <div className="flex flex-col items-center bg-gradient-to-b from-secondary/30 to-background dark:from-[#15181D] dark:to-[#0F1115] border border-white/10 rounded-3xl p-6 shadow-sm relative overflow-hidden group">
                    <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                    <GeometricAvatar index={node.avatar} size={100} className="shadow-2xl shadow-primary/20" />
                    <div className="mt-4 text-center relative z-10">
                        <h2 className="text-xl font-bold tracking-tight">{node.name}</h2>
                        <button onClick={copyId} className="flex items-center justify-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/40 px-2 py-1 rounded-md transition-all mt-1 mx-auto cursor-pointer">
                            {node.nodeId} <Copy size={10} />
                        </button>
                        <div className={`mt-2 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${node.online ? 'bg-green-500/10 text-green-600 border-green-500/20' : 'bg-secondary text-muted-foreground border-transparent'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${node.online ? 'bg-green-500 animate-pulse shadow-[0_0_5px_rgba(34,197,94,0.5)]' : 'bg-muted-foreground'}`} />
                            {node.online ? 'Online' : 'Offline'}
                        </div>
                    </div>
                </div>

                {/* Quick Actions */}
                <div className="grid grid-cols-4 gap-2">
                    <ActionButton icon={MessageSquare} label="Чат" active />
                    <ActionButton icon={Phone} label="Звонок" />
                    <ActionButton icon={Video} label="Видео" />
                    <ActionButton icon={Bell} label="Увед." />
                </div>

                {/* Stats Grid */}
                <div className="space-y-3">
                    <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider ml-1">Статистика</h3>
                    <div className="grid grid-cols-2 gap-3">
                        <StatCard 
                            icon={Activity} 
                            label="Задержка" 
                            value={`${node.latency} ms`} 
                            trend={node.latency < 50 ? 'good' : 'bad'}
                            subtext="Стабильно"
                            highlightValue
                        />
                        <StatCard 
                            icon={MessageSquare} 
                            label="Сообщения" 
                            value={String(node.messagesSent + node.messagesReceived)}
                            subtext={`${node.messagesSent} отправлено`}
                            highlightValue
                        />
                        <StatCard 
                            icon={FolderOpen} 
                            label="Файлы" 
                            value={String(node.filesCount)}
                            subtext={node.filesSize}
                        />
                        <StatCard 
                            icon={ShieldCheck} 
                            label="Сессия" 
                            value={node.sessionTime.split(':')[0] + 'ч'}
                            subtext={node.sessionTime}
                        />
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
                        <button onClick={copyFingerprint} className="w-full flex items-center justify-between group">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-secondary/40 rounded-xl text-muted-foreground group-hover:bg-secondary group-hover:text-foreground transition-colors">
                                    <Key size={18} />
                                </div>
                                <div className="text-left">
                                    <p className="text-sm font-semibold group-hover:text-primary transition-colors">Отпечаток</p>
                                    <p className="text-[10px] text-muted-foreground font-mono truncate w-32 group-hover:text-primary/70">{node.fingerprint}</p>
                                </div>
                            </div>
                            <Copy size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                    </div>
                </div>

                {/* Shared Media */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                         <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider ml-1">Медиа и файлы</h3>
                         <button className="text-xs text-primary hover:underline hover:glow-text-blue">Все</button>
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
                        <div className="w-20 h-20 bg-secondary/30 dark:bg-[#1a1b20] rounded-xl flex items-center justify-center shrink-0 border border-white/5 hover:border-primary/30 transition-colors">
                            <FileText size={24} className="text-muted-foreground" />
                        </div>
                        <div className="w-20 h-20 bg-secondary/30 dark:bg-[#1a1b20] rounded-xl flex items-center justify-center shrink-0 border border-white/5 hover:border-primary/30 transition-colors">
                            <FolderOpen size={24} className="text-muted-foreground" />
                        </div>
                        <div className="w-20 h-20 bg-secondary/30 dark:bg-[#1a1b20] rounded-xl flex items-center justify-center shrink-0 border border-white/5 hover:border-primary/30 transition-colors">
                            <Share2 size={24} className="text-muted-foreground" />
                        </div>
                    </div>
                </div>

                <button className="w-full py-3 rounded-xl text-sm font-medium text-destructive bg-destructive/5 hover:bg-destructive/10 border border-destructive/10 transition-colors flex items-center justify-center gap-2 mt-4">
                    <ShieldX size={16} /> Заблокировать контакт
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
