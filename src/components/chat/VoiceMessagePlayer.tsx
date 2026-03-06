import { useState, useEffect, useRef } from 'react';
import { Play, Pause } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  audioUrl?: string;
  duration?: string; // "0:05"
  isMe: boolean;
}

const VoiceMessagePlayer = ({ audioUrl, duration, isMe }: Props) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      const p = (audio.currentTime / audio.duration) * 100;
      setProgress(isNaN(p) ? 0 : p);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setProgress(0);
      setCurrentTime(0);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(e => console.error("Playback failed", e));
    }
    setIsPlaying(!isPlaying);
  };

  const formatTime = (time: number) => {
    const m = Math.floor(time / 60);
    const s = Math.floor(time % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-3 min-w-[200px]">
      <audio ref={audioRef} src={audioUrl} className="hidden" />
      
      <button
        onClick={togglePlay}
        className={cn(
          "w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all",
          isMe 
            ? "bg-white/20 hover:bg-white/30 text-white" 
            : "bg-primary/10 hover:bg-primary/20 text-primary"
        )}
      >
        {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
      </button>

      <div className="flex-1 flex flex-col gap-1">
        {/* Fake waveform or progress bar */}
        <div className="h-8 flex items-center gap-[2px] opacity-80">
           {/* Simple visualizer bars */}
           {Array.from({ length: 25 }).map((_, i) => (
             <div 
               key={i} 
               className={cn(
                 "w-[3px] rounded-full transition-all duration-300",
                 isMe ? "bg-white" : "bg-primary"
               )}
               style={{ 
                 height: `${Math.max(20, Math.random() * 80)}%`,
                 opacity: (i / 25) * 100 < progress ? 1 : 0.4
               }}
             />
           ))}
        </div>
        
        <span className={cn("text-xs font-medium", isMe ? "text-blue-100" : "text-muted-foreground")}>
          {isPlaying ? formatTime(currentTime) : (duration || "0:00")}
        </span>
      </div>
    </div>
  );
};

export default VoiceMessagePlayer;
