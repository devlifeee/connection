import { avatarShapes } from '@/data/mockData';

interface Props {
  index: number;
  size?: number;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

const GeometricAvatar = ({ index, size = 40, selected = false, onClick, className = '' }: Props) => {
  const safeIndex = index % avatarShapes.length;
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
