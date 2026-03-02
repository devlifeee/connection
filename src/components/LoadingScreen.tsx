import { useState, useEffect } from 'react';
import Logo from './Logo';

const stages = [
  'Сканирование сети...',
  'Обнаружение узлов...',
  'Установка защищённых каналов...',
];

interface Props {
  onComplete: () => void;
}

const LoadingScreen = ({ onComplete }: Props) => {
  const [stageIndex, setStageIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(prev => {
        const next = prev + 2;
        if (next >= 100) {
          clearInterval(interval);
          setTimeout(onComplete, 300);
          return 100;
        }
        if (next > 66) setStageIndex(2);
        else if (next > 33) setStageIndex(1);
        return next;
      });
    }, 40);
    return () => clearInterval(interval);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center gap-8 z-50">
      <Logo size={80} />
      <p className="text-muted-foreground text-sm transition-all duration-300">
        {stages[stageIndex]}
      </p>
      <div className="w-64 h-0.5 bg-border rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-100"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};

export default LoadingScreen;
