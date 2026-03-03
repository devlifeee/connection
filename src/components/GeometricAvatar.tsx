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
  
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      onClick={onClick}
      className={`cursor-pointer transition-all ${selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''} ${className}`}
      style={{ borderRadius: 'var(--radius)' }}
    >
      <rect width="100" height="100" rx="8" fill="hsl(var(--surface))" />
      <path d={avatarShapes[safeIndex]} fill="hsl(var(--primary))" opacity="0.8" />
    </svg>
  );
};

export default GeometricAvatar;
