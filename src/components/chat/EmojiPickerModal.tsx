import { useEffect, useRef } from 'react';
import EmojiPicker, { EmojiClickData, Theme } from 'emoji-picker-react';
import { useTheme } from '@/hooks/useTheme';

interface Props {
  onEmojiClick: (emojiData: EmojiClickData) => void;
  onClose: () => void;
  isOpen: boolean;
}

const EmojiPickerModal = ({ onEmojiClick, onClose, isOpen }: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="absolute bottom-full right-0 mb-4 z-50 animate-in fade-in zoom-in-95 duration-200" ref={ref}>
      <div className="shadow-2xl rounded-2xl overflow-hidden border border-border/50">
        <EmojiPicker
          onEmojiClick={onEmojiClick}
          theme={theme === 'dark' ? Theme.DARK : Theme.LIGHT}
          width={320}
          height={400}
          previewConfig={{ showPreview: false }}
          skinTonesDisabled
        />
      </div>
    </div>
  );
};

export default EmojiPickerModal;
