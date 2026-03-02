import logoSrc from '@/assets/logo.png';

interface LogoProps {
  size?: number;
  className?: string;
}

const Logo = ({ size = 48, className = '' }: LogoProps) => (
  <img src={logoSrc} alt="СВЯЗЬ" width={size} height={size} className={`object-contain ${className}`} />
);

export default Logo;
