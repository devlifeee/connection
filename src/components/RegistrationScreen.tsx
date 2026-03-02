import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import Logo from './Logo';
import GeometricAvatar from './GeometricAvatar';
import { generateNodeId } from '@/data/mockData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Props {
  onRegister: (data: { name: string; nodeId: string; avatar: number }) => void;
}

const RegistrationScreen = ({ onRegister }: Props) => {
  const [name, setName] = useState('');
  const [nodeId, setNodeId] = useState(generateNodeId());
  const [selectedAvatar, setSelectedAvatar] = useState(0);

  const handleSubmit = () => {
    if (!name.trim()) return;
    onRegister({ name: name.trim(), nodeId, avatar: selectedAvatar });
  };

  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md flex flex-col items-center gap-6">
        <Logo size={64} />
        <p className="text-muted-foreground text-sm text-center">
          Децентрализованная связь. Без серверов. Без интернета.
        </p>

        <div className="w-full space-y-4">
          <Input
            placeholder="Введите имя"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            className="bg-card border-border"
          />

          <div className="flex items-center gap-2">
            <span className="font-mono text-primary text-sm">{nodeId}</span>
            <button
              onClick={() => setNodeId(generateNodeId())}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw size={14} />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Ваш уникальный идентификатор в сети</p>
        </div>

        <div className="w-full">
          <p className="text-xs text-muted-foreground mb-3">Выберите аватар</p>
          <div className="flex gap-3 justify-center flex-wrap">
            {[0, 1, 2, 3, 4, 5].map(i => (
              <GeometricAvatar
                key={i}
                index={i}
                size={52}
                selected={selectedAvatar === i}
                onClick={() => setSelectedAvatar(i)}
              />
            ))}
          </div>
        </div>

        <Button
          onClick={handleSubmit}
          disabled={!name.trim()}
          className="w-full"
        >
          Войти в сеть
        </Button>

        <p className="text-xs text-muted-foreground text-center">
          Без регистрации. Данные хранятся локально.
        </p>
      </div>
    </div>
  );
};

export default RegistrationScreen;
