import { useState, useEffect, useCallback, useRef } from 'react';
import { initializeSession, addEventListener } from '@/api/nodeAgent';

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

export function useSession() {
  const [sessionState, setSessionState] = useState<SessionState>({
    id: null,
    terminalId: null,
    processName: null,
    connected: false,
    error: null,
  });

  const [events, setEvents] = useState<SessionEvent[]>([]);
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

  useEffect(() => {
    initialize();

    return () => {
      if (eventListenerRef.current) {
        eventListenerRef.current();
      }
    };
  }, [initialize]);

  return {
    sessionState,
    events,
    initialize,
    clearEvents,
    getEventsByType,
  };
}