import { Activity, MessageSquare, FolderOpen, Lock, Key, ShieldCheck, Phone, Video, Paperclip, ShieldX, Copy } from 'lucide-react';
import GeometricAvatar from './GeometricAvatar';
import { getNodeByNodeId } from '@/data/mockData';
import { useToast } from '@/hooks/use-toast';

interface Props {
  nodeId: string | null;
  className?: string;
}

const NodeInfoPanel = ({ nodeId, className = '' }: Props) => {
  const node = nodeId ? getNodeByNodeId(nodeId) : null;
  const { toast } = useToast();

  if (!node) {
    return (
      <div className={`w-[280px] border-l border-border bg-background p-6 flex items-center justify-center ${className}`}>
        <p className="text-xs text-muted-foreground text-center">Выберите узел для просмотра информации</p>
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
    <div className={`w-[280px] border-l border-border bg-background overflow-y-auto scrollbar-thin ${className}`}>
      {/* Profile */}
      <div className="flex flex-col items-center p-6 border-b border-border">
        <GeometricAvatar index={node.avatar} size={80} />
        <p className="text-base font-semibold mt-3">{node.name}</p>
        <button onClick={copyId} className="flex items-center gap-1 font-mono text-xs text-primary hover:underline mt-1">
          {node.nodeId} <Copy size={10} />
        </button>
        <p className="text-xs text-muted-foreground mt-1">
          {node.online ? `Онлайн · ${node.sessionTime}` : 'Нет связи'}
        </p>
      </div>

      {/* Stats */}
      <div className="p-4 border-b border-border space-y-3">
        <StatRow icon={Activity} label="Задержка" value={`${node.latency} мс`} />
        <StatRow icon={MessageSquare} label="Сообщений" value={`${node.messagesSent} / ${node.messagesReceived}`} />
        <StatRow icon={FolderOpen} label="Файлов" value={`${node.filesCount} · ${node.filesSize}`} />
      </div>

      {/* Security */}
      <div className="p-4 border-b border-border space-y-3">
        <div className="flex items-center gap-2 text-xs">
          <Lock size={14} className="text-primary shrink-0" />
          <span>Канал зашифрован (Noise Protocol)</span>
        </div>
        <button onClick={copyFingerprint} className="flex items-center gap-2 text-xs hover:text-foreground text-muted-foreground">
          <Key size={14} className="shrink-0" />
          <span className="font-mono">Отпечаток: {node.fingerprint}</span>
        </button>
        <div className="flex items-center gap-2 text-xs">
          <ShieldCheck size={14} className="text-primary shrink-0" />
          <span>Личность подтверждена</span>
        </div>
      </div>

      {/* Actions */}
      <div className="p-4 space-y-2">
        <ActionBtn icon={MessageSquare} label="Написать" />
        <ActionBtn icon={Phone} label="Голосовой звонок" />
        <ActionBtn icon={Video} label="Видеозвонок" />
        <ActionBtn icon={Paperclip} label="Отправить файл" />
        <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors mt-4">
          <ShieldX size={14} /> Заблокировать
        </button>
      </div>
    </div>
  );
};

function StatRow({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon size={14} /> {label}
      </div>
      <span>{value}</span>
    </div>
  );
}

function ActionBtn({ icon: Icon, label }: { icon: typeof MessageSquare; label: string }) {
  return (
    <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-card transition-colors">
      <Icon size={14} className="text-primary" /> {label}
    </button>
  );
}

export default NodeInfoPanel;
