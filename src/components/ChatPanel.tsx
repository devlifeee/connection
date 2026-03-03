import { useState, useRef, useEffect } from 'react';
import {
  Phone, Video, Paperclip, MoreVertical, Lock, Send, Smile, Mic,
  ChevronDown, File, Download, CheckCheck,
} from 'lucide-react';
import GeometricAvatar from './GeometricAvatar';
import { getNodeByNodeId, messagesAlexey, type Message } from '@/data/mockData';
import { messageEnvelope, messagingRules } from '@/content/backendBlueprint';

interface Props {
  dialogNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}

const ChatPanel = ({ dialogNodeId, onSelectNode }: Props) => {
  const node = dialogNodeId ? getNodeByNodeId(dialogNodeId) : null;
  const [messages, setMessages] = useState<Message[]>(messagesAlexey);
  const [input, setInput] = useState('');
  const [showScroll, setShowScroll] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setShowScroll(scrollHeight - scrollTop - clientHeight > 100);
  };

  const sendMessage = () => {
    if (!input.trim()) return;
    const msg: Message = {
      id: Date.now().toString(),
      from: 'me',
      text: input.trim(),
      time: new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }),
      delivered: true,
      type: 'text',
    };
    setMessages(prev => [...prev, msg]);
    setInput('');
  };

  if (!node) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <MessageSquareEmpty />
          <p className="text-muted-foreground text-sm mt-3">Напишите первым. Сообщение уйдёт напрямую.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      {/* Header */}
      <div className="h-14 px-4 border-b border-border flex items-center justify-between shrink-0">
        <button onClick={() => onSelectNode(node.nodeId)} className="flex items-center gap-3 hover:opacity-80">
          <GeometricAvatar index={node.avatar} size={32} />
          <div>
            <p className="text-sm font-semibold">{node.name}</p>
            <p className="text-[11px] text-muted-foreground font-mono">
              {node.online ? 'Онлайн' : 'Нет связи'} · {node.nodeId} · {node.ip}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-3 text-muted-foreground">
          <Phone size={16} className="cursor-pointer hover:text-foreground" />
          <Video size={16} className="cursor-pointer hover:text-foreground" />
          <Paperclip size={16} className="cursor-pointer hover:text-foreground" />
          <MoreVertical size={16} className="cursor-pointer hover:text-foreground" />
        </div>
      </div>

      {/* Encryption banner */}
      <div className="flex items-center justify-center gap-2 py-1.5 text-[10px] text-muted-foreground border-b border-border">
        <Lock size={10} /> Сквозное шифрование активно
      </div>

      <div className="px-4 py-3 border-b border-border bg-card/20">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="bg-card border border-border rounded-lg p-3">
            <p className="text-xs font-semibold mb-2">Messaging Protocol</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] text-muted-foreground font-mono">
              {messageEnvelope.map(item => (
                <div key={item.field} className="flex items-center justify-between gap-2">
                  <span>{item.field}</span>
                  <span className="text-foreground/70">{item.note}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <p className="text-xs font-semibold mb-2">Правила доставки</p>
            <ul className="text-[11px] text-muted-foreground space-y-1">
              {messagingRules.map(rule => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 space-y-2 relative">
        {messages.map(msg => {
          if (msg.type === 'system') {
            return (
              <p key={msg.id} className="text-center text-xs text-muted-foreground italic py-1">
                — {msg.text} —
              </p>
            );
          }

          const isMe = msg.from === 'me';

          return (
            <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[70%] px-3 py-2 rounded-lg text-sm ${
                isMe ? 'bg-msg-outgoing' : 'bg-msg-incoming'
              }`}>
                {msg.type === 'file' ? (
                  <div className="flex items-center gap-2">
                    <File size={16} className="text-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm truncate">{msg.fileName}</p>
                      <p className="text-[10px] text-muted-foreground">{msg.fileSize}</p>
                    </div>
                    <Download size={14} className="text-primary cursor-pointer shrink-0" />
                  </div>
                ) : (
                  <p>{msg.text}</p>
                )}
                <div className={`flex items-center gap-1 mt-1 ${isMe ? 'justify-end' : ''}`}>
                  <span className="text-[10px] text-muted-foreground">{msg.time}</span>
                  {isMe && msg.delivered && <CheckCheck size={12} className="text-primary" />}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />

        {showScroll && (
          <button
            onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-full px-3 py-1 flex items-center gap-1 text-xs text-primary"
          >
            <ChevronDown size={14} /> Новые сообщения
          </button>
        )}
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-border">
        <div className="flex items-center gap-2 bg-card rounded-lg border border-border px-3 py-2 focus-within:border-primary transition-colors">
          <Paperclip size={16} className="text-muted-foreground cursor-pointer hover:text-foreground shrink-0" />
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMessage()}
            placeholder="Сообщение..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <Smile size={16} className="text-muted-foreground cursor-pointer hover:text-foreground shrink-0" />
          <Mic size={16} className="text-muted-foreground cursor-pointer hover:text-foreground shrink-0" />
          <button onClick={sendMessage} className="text-primary hover:text-primary/80 shrink-0">
            <Send size={16} />
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground text-center mt-1.5">
          Прямое соединение · Зашифровано · Без сервера
        </p>
      </div>
    </div>
  );
};

function MessageSquareEmpty() {
  return (
    <div className="w-16 h-16 rounded-full bg-card flex items-center justify-center mx-auto">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    </div>
  );
}

export default ChatPanel;
