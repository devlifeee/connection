import { useState, useRef, useEffect } from 'react';
import {
  Phone, Video, Paperclip, MoreVertical, Send, Smile, Mic,
  ChevronDown, X, Image as ImageIcon, File
} from 'lucide-react';
import GeometricAvatar from './GeometricAvatar';
import MessageBubble from './MessageBubble';
import { useTheme } from '@/hooks/useTheme';
import type { Message } from '@/data/mockData';
import { useChatHistory, useNodeAgentPresencePeers, useSendChatMessage, useNodeAgentIdentity } from "@/hooks/useNodeAgent";
import { useSession } from '@/hooks/useSession';
import { toast } from 'sonner';
import { nodeAgentApi } from '@/api/nodeAgent';
import EmojiPickerModal from './chat/EmojiPickerModal';
import VoiceRecorder from './chat/VoiceRecorder';

interface Props {
  dialogNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onToggleInfoPanel?: () => void;
  onStartCall?: (video: boolean) => void;
}

const ChatPanel = ({ dialogNodeId, onSelectNode, onToggleInfoPanel, onStartCall }: Props) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [showScroll, setShowScroll] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [previewMedia, setPreviewMedia] = useState<{ url: string; file: File; type: 'image' | 'video' | 'file' } | null>(null);
  
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const presencePeers = useNodeAgentPresencePeers();
  const sendChat = useSendChatMessage();
  const selectedPeerId = dialogNodeId || presencePeers.data?.peers?.[0]?.payload.peer_id;
  const chatHistory = useChatHistory(selectedPeerId);
  const { events } = useSession();
  const identity = useNodeAgentIdentity();
  const myPeerId = identity.data?.peer_id;
  const [lastReadId, setLastReadId] = useState<string>('');
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, previewMedia, isRecording]);
  
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory.data?.messages?.length]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setShowScroll(scrollHeight - scrollTop - clientHeight > 100);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file';
    setPreviewMedia({ url, file, type });
    // Reset input
    e.target.value = '';
  };

  const handleSendVoice = async (blob: Blob, duration: string) => {
    if (!selectedPeerId) return;
    
    // In a real app, upload blob to server, get URL/ID
    // For local demo, create Object URL
    const url = URL.createObjectURL(blob);
    
    // Optimistic UI
    const msg: Message = {
      id: Date.now().toString(),
      from: 'me',
      text: '',
      mediaUrl: url,
      mediaType: 'audio',
      duration: duration,
      time: new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }),
      timestamp: Date.now(),
      delivered: true,
      type: 'audio',
    };
    setMessages(prev => [...prev, msg]);
    setIsRecording(false);

    // Send via API (using file upload endpoint for voice)
    try {
        // Create file from blob
        const file = new File([blob], "voice.webm", { type: "audio/webm" });
        await nodeAgentApi.sendFile(selectedPeerId, file);
        // Note: Actual chat protocol needs update to link file to chat message
        // sending a text message with metadata for now
        sendChat.mutate({ 
            peer_id: selectedPeerId, 
            text: `[Voice Message] ${duration}` 
        });
    } catch (e) {
        console.error("Failed to send voice", e);
        toast.error("Не удалось отправить голосовое сообщение");
    }
  };

  const sendMessage = async () => {
    if (!input.trim() && !previewMedia) return;
    
    const text = input.trim();
    const nowTime = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
    
    // Optimistic Message
    const msg: Message = {
      id: Date.now().toString(),
      from: 'me',
      text: text,
      mediaUrl: previewMedia?.url,
      mediaType: previewMedia?.type,
      fileName: previewMedia?.file.name,
      fileSize: formatFileSize(previewMedia?.file.size || 0),
      time: nowTime,
      timestamp: Date.now(),
      delivered: true,
      type: previewMedia ? previewMedia.type : 'text',
    };
    
    setMessages(prev => [...prev, msg]);
    setInput('');
    setPreviewMedia(null);
    setBackendError(null);

    if (!selectedPeerId) {
      setBackendError("Нет видимых peer в presence — сообщение осталось локально.");
      return;
    }

    try {
        if (previewMedia) {
            await nodeAgentApi.sendFile(selectedPeerId, previewMedia.file);
        }
        
        if (text) {
            // Split long text
            const MAX_LEN = 1000;
            for (let i = 0; i < text.length; i += MAX_LEN) {
                await sendChat.mutateAsync({ peer_id: selectedPeerId, text: text.slice(i, i + MAX_LEN) });
            }
        } else if (previewMedia) {
             // Send placeholder text for media-only messages if protocol requires text
             await sendChat.mutateAsync({ peer_id: selectedPeerId, text: `[${previewMedia.type}] ${previewMedia.file.name}` });
        }
    } catch {
        setBackendError("Не удалось отправить через node-agent.");
    }
  };

  const formatFileSize = (bytes: number) => {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Show toast notifications for incoming chat events via WS
  useEffect(() => {
    const latest = events.slice(-5);
    for (const ev of latest) {
      if (ev.type === 'chat_message' && ev.env && ev.env.sender && ev.env.payload) {
        try {
          const payload = ev.env.payload as any;
          const txt = typeof payload === 'object' ? payload.text : '';
          if (txt) {
            toast(`Сообщение от ${String(ev.env.sender).slice(0,8)}…`, { description: txt });
          }
        } catch (_e) { void 0 }
      }
      if (ev.type === 'chat_read' && ev.peer_id === selectedPeerId && typeof ev.last_id === 'string') {
        setLastReadId(ev.last_id as string);
      }
    }
  }, [events]);

  // Mark peer messages as read when viewing chat
  useEffect(() => {
    const msgs = chatHistory.data?.messages ?? [];
    if (!selectedPeerId || !msgs.length) return;
    const lastIncoming = [...msgs].filter((m:any) => m.sender === selectedPeerId && m.type === 'chat').sort((a:any,b:any)=>a.timestamp-b.timestamp).pop();
    if (lastIncoming && lastIncoming.id) {
      nodeAgentApi.chatRead(selectedPeerId, lastIncoming.id).catch(()=>{});
    }
  }, [selectedPeerId, chatHistory.data?.messages?.length]);

  const selectedPeer = presencePeers.data?.peers?.find(p => p.payload.peer_id === selectedPeerId) ?? null;
  if (!selectedPeer) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background/50 dark:bg-black/40 backdrop-blur-3xl">
        <div className="text-center opacity-50">
          <div className="w-20 h-20 rounded-2xl bg-secondary/30 flex items-center justify-center mx-auto text-muted-foreground/40 mb-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <p className="text-sm mt-4 font-medium text-muted-foreground">Выберите чат или начните новый</p>
        </div>
      </div>
    );
  }

  const getGroupPosition = (index: number, allMessages: any[], currentSender: string) => {
    const prev = allMessages[index - 1];
    const next = allMessages[index + 1];
    
    // Check if sender is same. 
    // Handle both optimistic messages (from='me') and remote (sender='peerid')
    const getSender = (m: any) => m.from === 'me' ? 'me' : m.sender;
    
    const isPrevSame = prev && getSender(prev) === currentSender;
    const isNextSame = next && getSender(next) === currentSender;
    
    if (!isPrevSame && !isNextSame) return 'single';
    if (!isPrevSame && isNextSame) return 'first';
    if (isPrevSame && isNextSame) return 'middle';
    if (isPrevSame && !isNextSame) return 'last';
    return 'single';
  };

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 bg-background/50 dark:bg-black/40 backdrop-blur-3xl relative">
      {/* Header */}
      <div className="h-16 px-6 flex items-center justify-between shrink-0 bg-background/60 dark:bg-card/80 backdrop-blur-xl sticky top-0 z-20 border-b border-border/40 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="relative">
             <GeometricAvatar index={1} size={44} />
             <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-background rounded-full shadow-sm animate-pulse shadow-green-500/50" />
          </div>
          <div>
            <p className="text-base font-bold leading-none tracking-tight">
              {selectedPeer.payload.display_name || selectedPeer.payload.peer_id.substring(0,8)}
            </p>
            <p className="text-xs mt-1 font-medium bg-secondary/40 px-2 py-0.5 rounded-full inline-block text-green-500/80">Online</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-muted-foreground">
          <button 
            className="p-2 hover:bg-secondary/50 rounded-full transition-all text-primary hover:scale-105"
            onClick={() => onStartCall?.(false)}
          >
             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" xmlns="http://www.w3.org/2000/svg">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
             </svg>
          </button>
          <button 
            className="p-2 hover:bg-secondary/50 rounded-full transition-all"
            onClick={() => onStartCall?.(true)}
          >
             <Video size={20} strokeWidth={2} />
          </button>
          <button className="p-2 hover:bg-secondary/50 rounded-full transition-all hover:text-foreground" onClick={() => onToggleInfoPanel?.()}>
            <MoreVertical size={20} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto scrollbar-thin px-4 py-6 relative">
        <div className="flex flex-col gap-[2px]">
        {/* Unified message list */}
        {(() => {
          // 1. Prepare history messages
          const historyMessages = (chatHistory?.data?.messages ?? []).map(env => {
            if ((env as any).type === 'ack') return null;
            const txt = env.payload && typeof env.payload === "object" ? env.payload.text ?? "" : "";
            if (!txt && !env.payload) return null;

            const time = new Date(env.timestamp).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
            const isMe = env.sender === myPeerId;
            const ackedIds = new Set((chatHistory?.data?.messages ?? []).filter((m:any)=>m.type==='ack' && m.ack_for).map((m:any)=>m.ack_for));
            const delivered = isMe && ackedIds.has(env.id);
            const read = isMe && !!lastReadId && (env.id <= lastReadId);

            let mediaType: 'image' | 'video' | 'file' | 'audio' | undefined;
            let fileName: string | undefined;
            let duration: string | undefined;
            let displayText = txt;

            if (txt.startsWith('[Voice Message]')) {
              mediaType = 'audio';
              duration = txt.replace('[Voice Message]', '').trim();
              displayText = '';
            } else if (txt.startsWith('[image]')) {
              mediaType = 'image';
              fileName = txt.replace('[image]', '').trim();
              displayText = '';
            } else if (txt.startsWith('[video]')) {
              mediaType = 'video';
              fileName = txt.replace('[video]', '').trim();
              displayText = '';
            } else if (txt.startsWith('[file]')) {
              mediaType = 'file';
              fileName = txt.replace('[file]', '').trim();
              displayText = '';
            }

            return {
              id: env.id,
              text: displayText,
              mediaType,
              fileName,
              duration,
              time,
              timestamp: env.timestamp,
              isMe,
              isRead: read,
              isDelivered: delivered,
              sender: env.sender
            };
          }).filter(Boolean) as any[];

          // 2. Prepare local optimistic messages
          const localMessages = messages.map(msg => ({
            id: msg.id,
            text: msg.text,
            mediaType: msg.mediaType,
            fileName: msg.fileName,
            duration: msg.duration,
            mediaUrl: msg.mediaUrl, // Local only
            time: msg.time,
            timestamp: msg.timestamp || Date.now(),
            isMe: true,
            isRead: false,
            isDelivered: msg.delivered,
            sender: 'me'
          }));

          // 3. Combine and sort
          const sortedHistory = [...historyMessages].sort((a, b) => a.timestamp - b.timestamp);
          
          // Filter local messages that are already in history (by content and approximate timestamp)
          const uniqueLocalMessages = localMessages.filter(localMsg => {
             // For media messages, check mediaType/duration/fileName if text is empty
             if (localMsg.type === 'audio') {
                 return !sortedHistory.some(h => 
                     h.isMe && 
                     h.mediaType === 'audio' && 
                     h.duration === localMsg.duration && 
                     Math.abs(h.timestamp - localMsg.timestamp) < 10000
                 );
             }
             if (localMsg.mediaType && localMsg.mediaType !== 'audio') {
                 return !sortedHistory.some(h => 
                     h.isMe && 
                     h.mediaType === localMsg.mediaType && 
                     h.fileName === localMsg.fileName && 
                     Math.abs(h.timestamp - localMsg.timestamp) < 10000
                 );
             }

             // Text messages
             return !sortedHistory.some(historyMsg => 
                historyMsg.isMe && 
                historyMsg.text === localMsg.text && 
                Math.abs(historyMsg.timestamp - localMsg.timestamp) < 5000
             );
          });

          const allMessages = [...sortedHistory, ...uniqueLocalMessages].sort((a, b) => a.timestamp - b.timestamp);

          return allMessages.map((msg, index) => {
             const groupPosition = getGroupPosition(index, allMessages, msg.sender);
             const isGroupStart = groupPosition === 'first' || groupPosition === 'single';

             return (
              <div key={msg.id} className={`flex flex-col items-start ${isGroupStart ? 'mt-3' : ''}`}>
                <div className={`flex justify-start group items-end gap-2 max-w-full`}>
                   <div className="w-[28px] shrink-0 mb-1">
                     {(groupPosition === 'last' || groupPosition === 'single') && (
                       <GeometricAvatar 
                         index={msg.isMe ? 0 : 1} 
                         size={28} 
                         className="transition-opacity duration-300" 
                       />
                     )}
                   </div>
                   <MessageBubble 
                     text={msg.text} 
                     mediaUrl={msg.mediaUrl}
                     mediaType={msg.mediaType}
                     fileName={msg.fileName}
                     duration={msg.duration}
                     time={msg.time} 
                     isMe={msg.isMe} 
                     isRead={msg.isRead} 
                     isDelivered={msg.isDelivered} 
                     groupPosition={groupPosition}
                   />
                </div>
              </div>
             );
          });
        })()}
        </div>
        
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

      {/* Input Area */}
      <div className="p-6 sticky bottom-0 z-20 bg-gradient-to-t from-background via-background/90 to-transparent pb-8">
        <div className="max-w-7xl mx-auto bg-background/80 dark:bg-card/80 backdrop-blur-2xl border border-border/40 rounded-[24px] shadow-2xl ring-1 ring-border relative">
          
          {/* Media Preview */}
          {previewMedia && (
              <div className="p-3 border-b border-border/40 flex items-center gap-3 animate-in slide-in-from-bottom-2">
                  <div className="relative group">
                      {previewMedia.type === 'image' ? (
                          <img src={previewMedia.url} className="w-16 h-16 object-cover rounded-xl" alt="preview" />
                      ) : (
                          <div className="w-16 h-16 bg-secondary rounded-xl flex items-center justify-center">
                              {previewMedia.type === 'video' ? <Video size={24} /> : <File size={24} />}
                          </div>
                      )}
                      <button 
                        onClick={() => setPreviewMedia(null)}
                        className="absolute -top-2 -right-2 bg-destructive text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                      >
                          <X size={12} />
                      </button>
                  </div>
                  <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{previewMedia.file.name}</p>
                      <p className="text-xs text-muted-foreground">{formatFileSize(previewMedia.file.size)}</p>
                  </div>
              </div>
          )}

          {isRecording ? (
              <div className="p-2">
                  <VoiceRecorder 
                    onSend={handleSendVoice} 
                    onCancel={() => setIsRecording(false)} 
                  />
              </div>
          ) : (
              <div className="flex items-end gap-3 p-2">
                <input 
                    type="file" 
                    ref={fileInputRef}
                    className="hidden" 
                    onChange={handleFileSelect} 
                />
                <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="p-3 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-full transition-all duration-300"
                >
                    <Paperclip size={22} strokeWidth={2} />
                </button>
                
                <div className="flex-1">
                    <textarea
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendMessage();
                        }
                    }}
                    placeholder="Написать сообщение..."
                    rows={1}
                    className="w-full bg-transparent px-2 py-3 text-sm font-medium outline-none placeholder:text-muted-foreground/50 text-foreground resize-none max-h-32 scrollbar-hide"
                    style={{ minHeight: '44px' }}
                    />
                </div>

                <div className="flex items-center gap-2 pr-1 relative">
                    <button 
                        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                        className={`p-3 rounded-full transition-all duration-300 ${showEmojiPicker ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-primary hover:bg-primary/10'}`}
                    >
                        <Smile size={22} strokeWidth={2} />
                    </button>
                    
                    <EmojiPickerModal 
                        isOpen={showEmojiPicker} 
                        onClose={() => setShowEmojiPicker(false)}
                        onEmojiClick={(emoji) => setInput(prev => prev + emoji.emoji)} 
                    />

                    {input.trim() || previewMedia ? (
                        <button 
                            onClick={sendMessage}
                            className="p-3 bg-secondary/60 text-foreground rounded-full transition-all duration-300 transform hover:scale-105 active:scale-95"
                        >
                            <Send size={20} strokeWidth={2} className="ml-0.5" />
                        </button>
                    ) : (
                        <button 
                            onClick={() => setIsRecording(true)}
                            className="p-3 bg-secondary text-muted-foreground hover:bg-secondary/80 rounded-full transition-all duration-300 transform hover:scale-105 active:scale-95"
                        >
                            <Mic size={22} strokeWidth={2} />
                        </button>
                    )}
                </div>
              </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
