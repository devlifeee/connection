import { avatarShapes } from '@/data/mockData';

interface Props {
  index: number | string;
  size?: number;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

const GeometricAvatar = ({ index, size = 40, selected = false, onClick, className = '' }: Props) => {
  const isImage = typeof index === 'string' && (index.startsWith('data:') || index.startsWith('http') || index.startsWith('blob:'));
  
  if (isImage) {
    return (
      <div 
        onClick={onClick}
        className={`relative overflow-hidden rounded-lg cursor-pointer transition-all ${selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''} ${className}`}
        style={{ width: size, height: size }}
      >
        <img 
          src={index as string} 
          alt="Avatar" 
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  const safeIndex = typeof index === 'number' ? index % avatarShapes.length : 0;
  
  // Hexagon path for background
  const hexPath = "M50 0 L93.3 25 V75 L50 100 L6.7 75 V25 Z";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      onClick={onClick}
      className={`cursor-pointer transition-all drop-shadow-md hover:drop-shadow-lg ${selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''} ${className}`}
      style={{ filter: 'drop-shadow(0 0 8px rgba(37, 99, 235, 0.6))' }}
    >
      <defs>
        <linearGradient id="hexGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1d4ed8" /> {/* Deep Blue */}
          <stop offset="100%" stopColor="#06b6d4" /> {/* Cyan/Turquoise */}
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3.5" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      
      {/* Background Hexagon with Gradient and Stroke */}
      <path 
        d={hexPath} 
        fill="url(#hexGradient)" 
        stroke="rgba(255,255,255,0.1)" 
        strokeWidth="1.5"
      />
      
      {/* Inner Shape */}
      <path 
        d={avatarShapes[safeIndex]} 
        fill="white" 
        opacity="0.95" 
        transform="scale(0.65) translate(26, 26)"
        style={{ filter: 'drop-shadow(0 0 5px rgba(255,255,255,0.5))' }}
      />
      
      {/* Shine effect */}
      <path
        d="M50 0 L93.3 25 L50 40 L6.7 25 Z"
        fill="white"
        opacity="0.15"
      />
    </svg>
  );
};

export default GeometricAvatar;
