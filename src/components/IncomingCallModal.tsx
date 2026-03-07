import { useSession } from '@/hooks/useSession';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import GeometricAvatar from './GeometricAvatar';
import { useNavigate } from 'react-router-dom';

const IncomingCallModal = () => {
  const { incomingCall, acceptCall, rejectCall } = useSession();
  const navigate = useNavigate();

  if (!incomingCall) return null;

  const handleAccept = async (video: boolean) => {
      // Save intent to open calls panel with correct state
      localStorage.setItem('svyaz-call-intent', JSON.stringify({ 
          peerId: incomingCall.peer_id, 
          video,
          autoAccept: true 
      }));
      
      await acceptCall(video);
      navigate('/home?tab=calls');
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-300">
      <div className="bg-card border border-white/10 p-8 rounded-3xl shadow-2xl max-w-sm w-full flex flex-col items-center">
        <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center mb-6 relative overflow-hidden border-4 border-background shadow-xl">
            <GeometricAvatar index={1} size={96} />
            <div className="absolute inset-0 bg-primary/10 animate-pulse" />
        </div>
        
        <h2 className="text-2xl font-bold mb-1 text-center">
            {incomingCall.peer_id.substring(0, 8)}...
        </h2>
        <p className="text-muted-foreground mb-8 text-center flex items-center gap-2">
            {incomingCall.type === 'video' ? <Video size={16} /> : <Phone size={16} />}
            Входящий {incomingCall.type === 'video' ? 'видеозвонок' : 'аудиозвонок'}
        </p>
        
        <div className="flex gap-6 w-full justify-center">
            <div className="flex flex-col items-center gap-2">
                <Button 
                    size="lg" 
                    className="h-16 w-16 rounded-full bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/20" 
                    onClick={rejectCall}
                >
                    <PhoneOff size={28} />
                </Button>
                <span className="text-xs text-muted-foreground font-medium">Отклонить</span>
            </div>

            <div className="flex flex-col items-center gap-2">
                <Button 
                    size="lg" 
                    className="h-16 w-16 rounded-full bg-green-500 hover:bg-green-600 shadow-lg shadow-green-500/20 animate-bounce" 
                    onClick={() => handleAccept(incomingCall.type === 'video')}
                >
                    {incomingCall.type === 'video' ? <Video size={28} /> : <Phone size={28} />}
                </Button>
                <span className="text-xs text-muted-foreground font-medium">Принять</span>
            </div>
        </div>
      </div>
    </div>
  );
};

export default IncomingCallModal;