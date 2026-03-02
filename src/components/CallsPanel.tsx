import { useState } from 'react';
import { Phone, PhoneOff, Video, MicOff, Volume2, Lock, Wifi, Camera, CameraOff } from 'lucide-react';
import GeometricAvatar from './GeometricAvatar';
import { callRecords, getNodeByNodeId, nodes } from '@/data/mockData';
import { Button } from '@/components/ui/button';

type CallState = 'idle' | 'incoming' | 'voice' | 'video';

const CallsPanel = () => {
  const [callState, setCallState] = useState<CallState>('idle');
  const [callTimer, setCallTimer] = useState('00:00:00');
  const [timerInterval, setTimerInterval] = useState<NodeJS.Timeout | null>(null);

  const startCall = (type: 'voice' | 'video') => {
    setCallState(type);
    let s = 0;
    const iv = setInterval(() => {
      s++;
      const h = String(Math.floor(s / 3600)).padStart(2, '0');
      const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
      const sec = String(s % 60).padStart(2, '0');
      setCallTimer(`${h}:${m}:${sec}`);
    }, 1000);
    setTimerInterval(iv);
  };

  const endCall = () => {
    if (timerInterval) clearInterval(timerInterval);
    setTimerInterval(null);
    setCallState('idle');
    setCallTimer('00:00:00');
  };

  const callingNode = nodes[0];

  // Active call screen
  if (callState === 'voice' || callState === 'video') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-background relative">
        {callState === 'video' && (
          <div className="absolute inset-0 bg-card flex items-center justify-center">
            <p className="text-muted-foreground text-sm">Видеопоток собеседника</p>
          </div>
        )}
        <div className={`relative z-10 flex flex-col items-center gap-4 ${callState === 'video' ? 'mt-auto mb-32' : ''}`}>
          {callState === 'voice' && <GeometricAvatar index={callingNode.avatar} size={96} />}
          <p className="text-lg font-semibold">{callingNode.name}</p>
          <p className="font-mono text-2xl">{callTimer}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Wifi size={12} /> LAN · 8 мс · Высокое качество
          </div>
          <div className="flex items-center gap-4 mt-6">
            <button className="w-12 h-12 rounded-full bg-card border border-border flex items-center justify-center text-foreground hover:bg-muted">
              <MicOff size={18} />
            </button>
            <button className="w-12 h-12 rounded-full bg-card border border-border flex items-center justify-center text-foreground hover:bg-muted">
              <Volume2 size={18} />
            </button>
            <button className="w-12 h-12 rounded-full bg-card border border-border flex items-center justify-center text-foreground hover:bg-muted">
              {callState === 'video' ? <CameraOff size={18} /> : <Video size={18} />}
            </button>
            <button onClick={endCall} className="w-14 h-14 rounded-full bg-destructive flex items-center justify-center text-destructive-foreground">
              <PhoneOff size={20} />
            </button>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-4">
            <Lock size={10} /> Зашифровано · P2P · 14 мс
          </div>
        </div>
        {callState === 'video' && (
          <div className="absolute bottom-4 right-4 w-32 h-24 bg-card rounded-lg border border-border flex items-center justify-center z-20">
            <Camera size={16} className="text-muted-foreground" />
          </div>
        )}
      </div>
    );
  }

  // Incoming call modal
  if (callState === 'incoming') {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 bg-card border border-border rounded-modal p-8 w-80">
          <div className="relative">
            <GeometricAvatar index={callingNode.avatar} size={80} />
            <div className="absolute inset-0 rounded-full border-2 border-primary animate-pulse-ring" />
          </div>
          <p className="text-lg font-semibold">{callingNode.name}</p>
          <p className="font-mono text-xs text-muted-foreground">{callingNode.nodeId}</p>
          <p className="text-xs text-muted-foreground">P2P голосовой звонок · LAN</p>
          <div className="flex gap-4 mt-2">
            <Button onClick={() => startCall('voice')} className="gap-2">
              <Phone size={16} /> Принять
            </Button>
            <Button onClick={() => setCallState('idle')} variant="destructive" className="gap-2">
              <PhoneOff size={16} /> Отклонить
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Call history
  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-6 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">Звонки</h2>
        <Button size="sm" variant="outline" onClick={() => setCallState('incoming')}>
          Имитировать входящий
        </Button>
      </div>

      <div className="space-y-2">
        {callRecords.map(c => {
          const n = getNodeByNodeId(c.nodeId);
          if (!n) return null;
          return (
            <div key={c.id} className="bg-card rounded-lg border border-border p-3 flex items-center gap-3">
              <GeometricAvatar index={n.avatar} size={36} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{n.name}</p>
                <p className="text-xs text-muted-foreground">
                  {c.direction === 'incoming' ? 'Входящий' : c.direction === 'outgoing' ? 'Исходящий' : 'Пропущен'}
                  {' · '}{c.type === 'voice' ? 'Голосовой' : 'Видео'} · {c.duration}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">{c.time}</span>
              <div className="flex gap-2">
                <button onClick={() => startCall('voice')} className="text-muted-foreground hover:text-primary">
                  <Phone size={16} />
                </button>
                <button onClick={() => startCall('video')} className="text-muted-foreground hover:text-primary">
                  <Video size={16} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CallsPanel;
