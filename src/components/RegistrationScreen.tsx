import { useState, useRef, useEffect } from 'react';
import { RefreshCw, Upload, User, ShieldCheck, Sun, Moon } from 'lucide-react';
import Logo from './Logo';
import GeometricAvatar from './GeometricAvatar';
import { generateNodeId } from '@/data/mockData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTheme } from '@/hooks/useTheme';

interface Props {
  onRegister: (data: { name: string; nodeId: string; avatar: number | string }) => void;
}

const RegistrationScreen = ({ onRegister }: Props) => {
  const [name, setName] = useState('');
  const [nodeId, setNodeId] = useState(generateNodeId());
  const [avatar, setAvatar] = useState<number | string | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { theme, toggleTheme } = useTheme();
  const isDarkMode = theme === 'dark';

  const handleSubmit = () => {
    if (!name.trim()) return;
    onRegister({ name: name.trim(), nodeId, avatar: 0 });
  };

  const handleFileChange = (_e: React.ChangeEvent<HTMLInputElement>) => {};

  return (
    <div className={`fixed inset-0 flex items-center justify-center p-4 sm:p-6 md:p-8 overflow-hidden transition-colors duration-500 min-h-[100dvh] pb-[env(safe-area-inset-bottom)] ${isDarkMode ? 'bg-[#0a0a0a] text-white' : 'bg-[#f5f5f7] text-gray-900'}`}>
      
      {/* Background Elements */}
      {isDarkMode ? (
        <>
          <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-blue-600/10 blur-[150px] animate-pulse-slow pointer-events-none" />
          <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-indigo-600/10 blur-[150px] animate-pulse-slow delay-1000 pointer-events-none" />
          <div className="absolute top-[40%] left-[50%] -translate-x-1/2 w-[40%] h-[40%] rounded-full bg-blue-900/5 blur-[100px] pointer-events-none" />
        </>
      ) : (
        <>
          <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-400/10 blur-[120px] animate-pulse-slow pointer-events-none" />
          <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-300/10 blur-[120px] animate-pulse-slow delay-1000 pointer-events-none" />
        </>
      )}

      {/* Theme Toggle */}
      <button 
        onClick={toggleTheme}
        className={`absolute top-6 right-6 p-3 rounded-full backdrop-blur-md shadow-sm border transition-all duration-300 hover:scale-105 active:scale-95 z-50 ${
          isDarkMode 
            ? 'bg-white/10 border-white/10 text-white/80 hover:text-white hover:bg-white/20' 
            : 'bg-white/80 border-gray-200 text-gray-600 hover:text-blue-600 hover:bg-white'
        }`}
      >
        {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
      </button>

      <div className={`w-full max-w-[360px] relative z-10 backdrop-blur-2xl border rounded-[20px] p-5 flex flex-col items-center gap-5 transition-all duration-500 ease-out ${
        isDarkMode 
          ? 'bg-[#1c1c1e]/60 border-white/5 shadow-[0_40px_80px_-12px_rgba(0,0,0,0.5)]' 
          : 'bg-white/70 border-white/40 shadow-[0_20px_60px_rgba(0,0,0,0.08)]'
      }`}>
        
        {/* Header */}
        <div className="flex flex-col items-center gap-6 w-full">
          <div className="relative group cursor-default">
            <div className={`absolute inset-0 blur-3xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-700 ${isDarkMode ? 'bg-blue-500/30' : 'bg-blue-400/20'}`} />
            <Logo size={72} className="relative drop-shadow-2xl transition-transform duration-500 group-hover:scale-105 rounded-2xl" />
          </div>
          
          <div className="text-center space-y-2">
            <h1 className={`text-2xl font-bold tracking-tight font-sans ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              hex p2p
            </h1>
            <p className={`text-[14px] font-normal tracking-wide text-center max-w-[240px] leading-relaxed ${isDarkMode ? 'text-blue-200/60' : 'text-gray-500'}`}>
              Децентрализованная связь. <br/>Без серверов. Без интернета.
            </p>
          </div>
        </div>

        {/* Avatar Section */}
        <div className="flex flex-col items-center gap-4 w-full">
            <div className="relative group">
            <div 
                className={`relative w-[96px] h-[96px] rounded-full shadow-[0_12px_32px_rgba(0,0,0,0.15)] flex items-center justify-center overflow-hidden border ${
                isDarkMode 
                    ? 'bg-gradient-to-b from-[#2c2c2e] to-[#1c1c1e] border-white/10' 
                    : 'bg-gradient-to-b from-white to-gray-50 border-white/80'
                }`}
            >
                <User size={52} className={isDarkMode ? 'text-white/20' : 'text-gray-300'} strokeWidth={1.5} />
            </div>
            {/* Status Badge */}
            {name.trim() && (
                <div className={`absolute bottom-1 right-1 rounded-full p-[4px] shadow-lg animate-in fade-in zoom-in duration-300 ${isDarkMode ? 'bg-[#1c1c1e]' : 'bg-white'}`}>
                <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center shadow-[0_0_12px_rgba(59,130,246,0.5)]">
                    <ShieldCheck size={14} className="text-white" strokeWidth={3} />
                </div>
                </div>
            )}
            <input 
                type="file" 
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden" 
                accept="image/*"
            />
            </div>
        </div>

        {/* Form Fields */}
        <div className="w-full space-y-4">
          <div className="space-y-1.5">
            <Input
              placeholder="Введите имя"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              className={`h-11 border rounded-2xl text-[15px] px-4 font-medium transition-all duration-200 text-center tracking-wide focus:ring-[3px] ${
                isDarkMode 
                  ? 'bg-black/20 border-white/10 hover:border-white/20 focus:border-blue-500 focus:bg-black/30 focus:ring-blue-500/10 text-white shadow-inner placeholder:text-white/20' 
                  : 'bg-white border-gray-200 hover:border-gray-300 focus:border-blue-500 focus:bg-white focus:ring-blue-500/15 text-gray-900 shadow-sm placeholder:text-gray-400'
              }`}
            />
          </div>

          <div className="relative group">
            <div className={`relative flex items-center border rounded-2xl px-5 py-4 shadow-sm transition-all ${
              isDarkMode 
                ? 'bg-[#2c2c2e]/50 border-white/5 hover:bg-[#2c2c2e]/80 hover:border-white/10 group-hover:shadow-[0_0_20px_rgba(59,130,246,0.05)]' 
                : 'bg-white/60 border-gray-200 hover:bg-white hover:border-gray-300'
            }`}>
              <div className="flex-1 flex flex-col min-w-0 mr-3 text-center sm:text-left">
                <span className={`text-[10px] uppercase tracking-widest font-bold mb-1 ${isDarkMode ? 'text-blue-300/40' : 'text-blue-600/60'}`}>Secure Token ID</span>
                <span className={`font-mono text-[14px] tracking-tight truncate select-all font-medium ${isDarkMode ? 'text-white/90' : 'text-gray-800'}`}>
                  {nodeId}
                </span>
              </div>
              <button
                onClick={() => setNodeId(generateNodeId())}
                className={`p-2.5 rounded-xl transition-all duration-200 active:scale-95 ${
                  isDarkMode 
                    ? 'text-blue-400/80 hover:text-white hover:bg-blue-500/20' 
                    : 'text-blue-500/80 hover:text-blue-600 hover:bg-blue-50'
                }`}
                title="Обновить ID"
              >
                <RefreshCw size={20} className="transition-transform duration-500 active:rotate-180" strokeWidth={2} />
              </button>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="w-full space-y-4 mt-2">
          <Button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className={`w-full h-[48px] text-[15px] font-bold tracking-wide rounded-[20px] active:scale-[0.98] transition-all duration-300 hover:brightness-110 disabled:opacity-30 disabled:shadow-none disabled:cursor-not-allowed ${
              isDarkMode 
                ? 'shadow-[0_8px_40px_-8px_rgba(0,122,255,0.4)] hover:shadow-[0_12px_50px_-8px_rgba(0,122,255,0.6)] bg-gradient-to-r from-[#007AFF] to-[#0A84FF] border-t border-white/10' 
                : 'shadow-[0_12px_30px_rgba(0,122,255,0.25)] hover:shadow-[0_15px_35px_rgba(0,122,255,0.35)] bg-gradient-to-r from-[#007AFF] to-[#0062CC]'
            }`}
          >
            Войти в сеть
          </Button>
          
          <p className={`text-[11px] text-center font-semibold tracking-[0.2em] uppercase ${isDarkMode ? 'text-white/20' : 'text-gray-400/60'}`}>Сквозное шифрование</p>
        </div>
      </div>
      
      {/* Version info footer */}
      <div className={`absolute bottom-6 sm:bottom-8 text-[10px] font-mono tracking-widest mix-blend-plus-lighter ${isDarkMode ? 'text-white/10' : 'text-gray-400/50'}`}>
        HEX P2P v0.2.0 (Dual Core)
      </div>
    </div>
  );
};

export default RegistrationScreen;
