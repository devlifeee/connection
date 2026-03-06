import { cn } from "@/lib/utils";
import { CheckCheck, FileText, Download } from "lucide-react";
import VoiceMessagePlayer from "./chat/VoiceMessagePlayer";

interface MessageBubbleProps {
  text?: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'file' | 'audio';
  fileName?: string;
  fileSize?: string;
  duration?: string;
  time: string;
  isMe: boolean;
  isRead?: boolean;
  isDelivered?: boolean;
  className?: string;
}

const MessageBubble = ({ text, mediaUrl, mediaType, fileName, fileSize, duration, time, isMe, isRead, isDelivered, className }: MessageBubbleProps) => {
  const isMedia = mediaType === 'image' || mediaType === 'video';
  
  return (
    <div className={cn("relative max-w-[320px] shadow-sm group", className)}>
      <div
        className={cn(
          "relative z-10 break-words whitespace-pre-wrap leading-relaxed overflow-hidden",
          isMedia ? "p-1 rounded-2xl" : "px-3 py-2 rounded-2xl",
          isMe
            ? "bg-[#2b5278] text-white rounded-br-none"
            : "bg-[#182533] text-white rounded-bl-none"
        )}
      >
        {/* Media Content */}
        {mediaType === 'image' && (
          mediaUrl ? (
            <div className="relative mb-1">
              <img src={mediaUrl} alt="attachment" className="rounded-xl max-w-full h-auto object-cover max-h-[300px]" />
            </div>
          ) : (
            <div className="flex items-center gap-3 p-2 mb-1 bg-black/10 rounded-xl">
               <div className="w-10 h-10 rounded-full bg-secondary/30 flex items-center justify-center shrink-0">
                 <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
               </div>
               <div className="flex-1 min-w-0">
                 <p className="text-sm font-medium truncate">{fileName || "Photo"}</p>
                 <p className="text-xs opacity-70">Загрузка...</p>
               </div>
            </div>
          )
        )}

        {mediaType === 'video' && (
          mediaUrl ? (
            <div className="relative mb-1">
              <video src={mediaUrl} controls className="rounded-xl max-w-full h-auto max-h-[300px]" />
            </div>
          ) : (
             <div className="flex items-center gap-3 p-2 mb-1 bg-black/10 rounded-xl">
               <div className="w-10 h-10 rounded-full bg-secondary/30 flex items-center justify-center shrink-0">
                 <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
               </div>
               <div className="flex-1 min-w-0">
                 <p className="text-sm font-medium truncate">{fileName || "Video"}</p>
                 <p className="text-xs opacity-70">Загрузка...</p>
               </div>
            </div>
          )
        )}

        {mediaType === 'file' && (
          <div className="flex items-center gap-3 p-1 mb-1">
            <div className={cn("w-10 h-10 rounded-full flex items-center justify-center shrink-0", isMe ? "bg-white/20" : "bg-primary/20")}>
              <FileText size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{fileName || "File"}</p>
              <p className="text-xs opacity-70">{fileSize}</p>
            </div>
            <a href={mediaUrl} download={fileName} className="p-2 opacity-70 hover:opacity-100 transition-opacity">
              <Download size={18} />
            </a>
          </div>
        )}

        {mediaType === 'audio' && (
          <div className="pr-2 py-1">
            <VoiceMessagePlayer audioUrl={mediaUrl} duration={duration} isMe={isMe} />
          </div>
        )}

        {/* Text Content */}
        {text && <p className={cn("mr-2 inline", isMedia && "px-2 pb-1 block")}>{text}</p>}
        
        {/* Time & Status */}
        <div className={cn(
          "float-right flex items-center gap-1 opacity-60 text-[10px] select-none h-[1.4em] align-bottom relative",
          isMedia && !text ? "absolute bottom-2 right-2 bg-black/40 px-1.5 py-0.5 rounded-full text-white" : "top-[6px]",
          isMedia && text && "px-2 pb-1"
        )}>
          <span>{time}</span>
          {isMe && (
            <span className="ml-0.5 inline-flex items-center">
              {isRead ? (
                <CheckCheck size={14} className={isMedia && !text ? "text-blue-300" : "text-blue-300"} />
              ) : isDelivered ? (
                <CheckCheck size={14} />
              ) : (
                <CheckCheck size={14} className="opacity-50" />
              )}
            </span>
          )}
        </div>
      </div>

      {/* Telegram-style SVG Tail */}
      {isMe ? (
        <svg
          className="absolute -right-[8px] bottom-0 w-[9px] h-[16px] z-10 pointer-events-none"
          viewBox="0 0 9 16"
          fill="#2b5278"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M0 8c0 4.418 0 8 0 8h8.5c-4.5 0-8.5-4-8.5-8z" />
          <path d="M0,16 L0,0 C0,10 9,16 9,16 L0,16 Z" />
        </svg>
      ) : (
        <svg
          className="absolute -left-[8px] bottom-0 w-[9px] h-[16px] z-10 pointer-events-none"
          viewBox="0 0 9 16"
          fill="#182533"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M9 8c0 4.418 0 8 0 8H0.5C5 16 9 12 9 8z" />
          <path d="M9,16 L9,0 C9,10 0,16 0,16 L9,16 Z" />
        </svg>
      )}
    </div>
  );
};

export default MessageBubble;
