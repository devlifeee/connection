import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';
import { initializeSession, addEventListener, type Call } from '@/api/nodeAgent';

export interface SessionState {
  id: string | null;
  terminalId: string | null;
  processName: string | null;
  connected: boolean;
  error: string | null;
}

export interface SessionEvent {
  type: string;
  timestamp: number;
  [key: string]: any;
}

// Create context for session and calls
interface SessionContextType {
  sessionState: SessionState;
  events: SessionEvent[];
  initialize: () => Promise<void>;
  clearEvents: () => void;
  getEventsByType: (type: string) => SessionEvent[];
  incomingCall: Call | null;
  activeCall: Call | null;
  setIncomingCall: (call: Call | null) => void;
  setActiveCall: (call: Call | null) => void;
  acceptCall: (video: boolean) => Promise<void>;
  rejectCall: () => void;
}

export const SessionContext = createContext<SessionContextType | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [sessionState, setSessionState] = useState<SessionState>({
    id: null,
    terminalId: null,
    processName: null,
    connected: false,
    error: null,
  });

  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [incomingCall, setIncomingCall] = useState<Call | null>(null);
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const eventListenerRef = useRef<(() => void) | null>(null);

  const initialize = useCallback(async () => {
    try {
      setSessionState(prev => ({ ...prev, error: null }));
      
      const session = await initializeSession();
      
      setSessionState({
        id: session.id,
        terminalId: session.terminalId,
        processName: session.processName,
        connected: true,
        error: null,
      });

      // Set up event listener
      if (eventListenerRef.current) {
        eventListenerRef.current();
      }
      
      eventListenerRef.current = addEventListener((event: SessionEvent) => {
        console.log('Received session event:', event);
        setEvents(prev => [...prev.slice(-99), event]); // Keep last 100 events
        
        // Handle incoming calls globally
        if (event.type === 'incoming_call' && event.call) {
            // Attach SDP to call object for later use
            (event.call as any).sdp = (event as any).sdp;
            setIncomingCall(event.call);
        }
      });

    } catch (error) {
      console.error('Failed to initialize session:', error);
      setSessionState(prev => ({
        ...prev,
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
  }, []);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  const getEventsByType = useCallback((type: string) => {
    return events.filter(event => event.type === type);
  }, [events]);

  // Call control placeholders - implementation will be handled by CallContext consumer or specific hook
  const acceptCall = useCallback(async (video: boolean) => {
      if (incomingCall) {
          setActiveCall(incomingCall);
          setIncomingCall(null);
      }
  }, [incomingCall]);

  const rejectCall = useCallback(() => {
      setIncomingCall(null);
  }, []);

  useEffect(() => {
    initialize();

    return () => {
      if (eventListenerRef.current) {
        eventListenerRef.current();
      }
    };
  }, [initialize]);

  return (
    <SessionContext.Provider value={{
        sessionState,
        events,
        initialize,
        clearEvents,
        getEventsByType,
        incomingCall,
        activeCall,
        setIncomingCall,
        setActiveCall,
        acceptCall,
        rejectCall
    }}>
        {children}
    </SessionContext.Provider>
  );
}


export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}