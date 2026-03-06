import { useState, useRef, useEffect } from 'react';
import { Mic, Trash2, Send, Square } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  onSend: (blob: Blob, duration: string) => void;
  onCancel: () => void;
}

const VoiceRecorder = ({ onSend, onCancel }: Props) => {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const source = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationFrame = useRef<number | null>(null);
  const chunks = useRef<BlobPart[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    startRecording();
    return () => stopRecordingCleanup();
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Setup Audio Context for visualization
      audioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyser.current = audioContext.current.createAnalyser();
      source.current = audioContext.current.createMediaStreamSource(stream);
      source.current.connect(analyser.current);
      analyser.current.fftSize = 256;
      
      const bufferLength = analyser.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateLevel = () => {
        if (!analyser.current) return;
        analyser.current.getByteFrequencyData(dataArray);
        // Calculate average volume
        let sum = 0;
        for(let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        setAudioLevel(sum / bufferLength);
        animationFrame.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();

      // Setup Recorder
      mediaRecorder.current = new MediaRecorder(stream);
      chunks.current = [];

      mediaRecorder.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.current.push(e.data);
        }
      };

      mediaRecorder.current.start();
      setIsRecording(true);

      // Timer
      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.error("Failed to start recording", err);
      onCancel();
    }
  };

  const stopRecordingCleanup = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
    
    if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
      mediaRecorder.current.stop();
      mediaRecorder.current.stream.getTracks().forEach(t => t.stop());
    }
    
    if (audioContext.current) {
      audioContext.current.close();
    }
  };

  const handleSend = () => {
    if (!mediaRecorder.current) return;
    
    mediaRecorder.current.onstop = () => {
      const blob = new Blob(chunks.current, { type: 'audio/webm' });
      onSend(blob, formatTime(duration));
    };
    
    stopRecordingCleanup();
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-4 w-full animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-center gap-2 text-destructive animate-pulse">
        <div className="w-2.5 h-2.5 rounded-full bg-destructive" />
        <span className="font-mono font-medium">{formatTime(duration)}</span>
      </div>

      {/* Waveform Visualization */}
      <div className="flex-1 h-8 flex items-center gap-1 overflow-hidden opacity-50">
        {Array.from({ length: 30 }).map((_, i) => (
          <div 
            key={i}
            className="w-1 bg-foreground rounded-full transition-all duration-75"
            style={{ 
              height: `${Math.min(100, Math.max(10, audioLevel * (Math.random() + 0.5)))}%` 
            }}
          />
        ))}
      </div>

      <button 
        onClick={onCancel}
        className="p-2 text-muted-foreground hover:text-destructive transition-colors"
      >
        <span className="text-sm font-medium uppercase tracking-wide">Отмена</span>
      </button>

      <button
        onClick={handleSend}
        className="p-3 bg-primary text-primary-foreground rounded-full hover:bg-primary/90 transition-all shadow-lg hover:scale-105 active:scale-95"
      >
        <Send size={20} className="ml-0.5" />
      </button>
    </div>
  );
};

export default VoiceRecorder;
