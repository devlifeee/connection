import { useState, useRef, useEffect } from 'react';
import {
  Phone, Video, Paperclip, MoreVertical, Send, Smile, Mic,
  ChevronDown, File, Download, CheckCheck,
} from 'lucide-react';
import GeometricAvatar from './GeometricAvatar';
import { getNodeByNodeId, type Message } from '@/data/mockData';
import { useChatHistory, useNodeAgentPresencePeers, useSendChatMessage } from "@/hooks/useNodeAgent";

interface Props {
  dialogNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}

const ChatPanel = ({ dialogNodeId, onSelectNode }: Props) => {
  const node = dialogNodeId ? getNodeByNodeId(dialogNodeId) : null;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [showScroll, setShowScroll] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const presencePeers = useNodeAgentPresencePeers();
  const sendChat = useSendChatMessage();
  const currentPeerId = presencePeers.data?.peers?.[0]?.payload.peer_id;
  const chatHistory = useChatHistory(currentPeerId);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setShowScroll(scrollHeight - scrollTop - clientHeight > 100);
  };

  const sendMessage = () => {
    const text = input.trim();
    if (!text) return;
    const msg: Message = {
      id: Date.now().toString(),
      from: 'me',
      text,
      time: new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }),
      delivered: true,
      type: 'text',
    };
    setMessages(prev => [...prev, msg]);
    setInput('');
    setBackendError(null);

    const target = presencePeers.data?.peers?.[0];
    const peerId = target?.payload.peer_id;
    if (!peerId) {
      setBackendError("Нет видимых peer в presence — сообщение осталось локально.");
      return;
    }

    sendChat.mutate(
      { peer_id: peerId, text },
      {
        onError: () => {
          setBackendError("Не удалось отправить через node-agent.");
        },
      },
    );
  };

  if (!node) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background/50 dark:bg-black/40 backdrop-blur-3xl">
        <div className="text-center opacity-50">
          <MessageSquareEmpty />
          <p className="text-sm mt-4 font-medium text-muted-foreground">Выберите чат или начните новый</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 bg-background/50 dark:bg-black/40 backdrop-blur-3xl relative">
      {/* Header */}
      <div className="h-16 px-6 flex items-center justify-between shrink-0 bg-background/60 dark:bg-card/80 backdrop-blur-xl sticky top-0 z-20 border-b border-border/40 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="relative">
             <GeometricAvatar index={node.avatar} size={44} />
             {node.online && (
                <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-background rounded-full shadow-sm animate-pulse shadow-green-500/50" />
             )}
          </div>
          <div>
            <p className="text-base font-bold leading-none tracking-tight">{node.name}</p>
            {node.online ? (
              <p className="text-xs mt-1 font-medium bg-secondary/40 px-2 py-0.5 rounded-full inline-block text-green-500/80">Online</p>
            ) : (
              <p className="text-xs text-muted-foreground mt-1 font-medium">Offline</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 text-muted-foreground">
          <button className="p-2 hover:bg-secondary/50 rounded-full transition-all">
             <Phone size={20} strokeWidth={2} />
          </button>
          <button className="p-2 hover:bg-secondary/50 rounded-full transition-all">
             <Video size={20} strokeWidth={2} />
          </button>
          <button className="p-2 hover:bg-secondary/50 rounded-full transition-all hover:text-foreground">
             <MoreVertical size={20} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto scrollbar-thin px-4 py-6 space-y-6 relative">
        {/* remote messages from node-agent history */}
        {(chatHistory?.data?.messages ?? []).map(env => {
          const txt = env.payload && typeof env.payload === "object" ? env.payload.text ?? "" : "";
          if (!txt) return null;
          const time = new Date(env.timestamp).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
          return (
            <div key={env.id} className="flex justify-start group items-end gap-2">
               <GeometricAvatar index={node.avatar} size={28} className="mb-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="max-w-[70%] px-5 py-3.5 rounded-2xl rounded-bl-none bg-secondary/80 dark:bg-[#1B1F26]/90 backdrop-blur-sm text-sm shadow-sm hover:shadow-md transition-shadow border border-border/40">
                <p className="leading-relaxed text-foreground/90">{txt}</p>
                <div className="flex items-center gap-1 mt-1 opacity-50 text-[10px] select-none">
                  <span>{time}</span>
                </div>
              </div>
            </div>
          );
        })}

        {/* local messages (from me) */}
        {messages.map((msg, idx) => {
          if (msg.type === 'system') {
            return (
              <div key={msg.id} className="flex justify-center my-4">
                  <span className="text-xs text-muted-foreground/80 bg-secondary/30 px-3 py-1 rounded-full border border-border/20 backdrop-blur-sm">
                    {msg.text}
                  </span>
              </div>
            );
          }

          const isMe = msg.from === 'me';
          const isLast = idx === messages.length - 1;

          return (
            <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'} group items-end gap-2 ${isLast ? 'mb-2' : ''}`}>
               {!isMe && (
                   <GeometricAvatar index={node.avatar} size={28} className="mb-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
               )}
              <div className={`max-w-[70%] px-5 py-3.5 rounded-2xl text-sm shadow-sm hover:shadow-md transition-all duration-200 ${
                isMe 
                  ? 'bg-[#1B1F26] text-foreground rounded-br-none border border-border/40' 
                  : 'bg-white dark:bg-[#1B1F26]/90 text-foreground rounded-bl-none border border-border/50'
              }`}>
                {msg.type === 'file' ? (
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-xl ${isMe ? 'bg-white/20' : 'bg-primary/10 text-primary'}`}>
                      <File size={20} strokeWidth={2} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate">{msg.fileName}</p>
                      <p className={`text-[10px] ${isMe ? 'text-white/70' : 'text-muted-foreground'}`}>{msg.fileSize}</p>
                    </div>
                    <button className={`p-1.5 rounded-full transition-colors ${isMe ? 'hover:bg-white/20' : 'hover:bg-secondary'}`}>
                        <Download size={16} />
                    </button>
                  </div>
                ) : (
                  <p className="leading-relaxed text-[15px]">{msg.text}</p>
                )}
                <div className={`flex items-center gap-1.5 mt-1.5 text-[10px] font-medium select-none ${isMe ? 'text-white/70 justify-end' : 'text-muted-foreground justify-start'}`}>
                  <span>{msg.time}</span>
                  {isMe && msg.delivered && <CheckCheck size={14} strokeWidth={2} />}
                </div>
              </div>
            </div>
          );
        })}
        
        {backendError && (
          <div className="flex justify-center sticky bottom-4 z-10">
            <span className="text-xs text-destructive-foreground bg-destructive px-4 py-2 rounded-full shadow-lg font-medium flex items-center gap-2">
                <span className="w-2 h-2 bg-white rounded-full animate-pulse"/>
                {backendError}
            </span>
          </div>
        )}
        
        <div ref={bottomRef} />

        {showScroll && (
          <button
            onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-secondary/60 text-foreground rounded-full px-4 py-2 flex items-center gap-2 text-xs font-bold shadow-xl hover:scale-105 transition-all z-20"
          >
            <ChevronDown size={14} strokeWidth={3} />
            <span>Вниз</span>
          </button>
        )}
      </div>

      {/* Input */}
      <div className="p-6 sticky bottom-0 z-20 bg-gradient-to-t from-background via-background/90 to-transparent pb-8">
        <div className="flex items-end gap-3 max-w-4xl mx-auto bg-background/80 dark:bg-card/80 backdrop-blur-2xl border border-border/40 p-2 rounded-[24px] shadow-2xl ring-1 ring-border">
          <button className="p-3 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-full transition-all duration-300">
            <Paperclip size={22} strokeWidth={2} />
          </button>
          
          <div className="flex-1">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              placeholder="Написать сообщение..."
              className="w-full bg-transparent px-2 py-3 text-sm font-medium outline-none placeholder:text-muted-foreground/50 text-foreground"
            />
          </div>

          <div className="flex items-center gap-2 pr-1">
             <button className="p-3 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-full transition-all duration-300">
              <Smile size={22} strokeWidth={2} />
            </button>
            <button 
              onClick={sendMessage}
              className={`p-3 rounded-full transition-all duration-300 transform hover:scale-105 active:scale-95 ${
                input.trim() 
                  ? 'bg-secondary/60 text-foreground' 
                  : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
              }`}
            >
              {input.trim() ? <Send size={20} strokeWidth={2} className="ml-0.5" /> : <Mic size={22} strokeWidth={2} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

function MessageSquareEmpty() {
  return (
    <div className="w-20 h-20 rounded-2xl bg-secondary/30 flex items-center justify-center mx-auto text-muted-foreground/40">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    </div>
  );
}

export default ChatPanel;
