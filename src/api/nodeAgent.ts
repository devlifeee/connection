const defaultBaseUrl = "http://127.0.0.1:9876";

function getBaseUrl() {
  const env = import.meta.env as ImportMetaEnv & { VITE_NODE_AGENT_URL?: string };
  const url = env.VITE_NODE_AGENT_URL;
  return url?.trim() ? url : defaultBaseUrl;
}

function getWebSocketUrl() {
  const baseUrl = getBaseUrl();
  return baseUrl.replace(/^http/, 'ws');
}

// Session management
let currentSession: { id: string; terminalId: string; processName: string } | null = null;
let websocket: WebSocket | null = null;
let eventListeners: Array<(event: any) => void> = [];

function generateTerminalId(): string {
  return `term-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getProcessName(): string {
  return `web-ui-${window.location.hostname}`;
}

async function createSession(): Promise<{ id: string; terminalId: string; processName: string }> {
  if (currentSession) return currentSession;
  
  const terminalId = generateTerminalId();
  const processName = getProcessName();
  
  const response = await postJson<any, any>('/session/create', {
    terminal_id: terminalId,
    process_name: processName
  });
  
  currentSession = {
    id: response.session_id,
    terminalId: response.terminal_id,
    processName: response.process_name
  };
  
  console.log('Created session:', currentSession);
  return currentSession;
}

function connectWebSocket(sessionId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
      resolve(websocket);
      return;
    }
    
    const wsUrl = `${getWebSocketUrl()}/session/ws?session_id=${sessionId}`;
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('WebSocket connected');
      websocket = ws;
      resolve(ws);
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      reject(error);
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        eventListeners.forEach(listener => listener(data));
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };
    
    ws.onclose = () => {
      console.log('WebSocket disconnected');
      websocket = null;
      // Attempt to reconnect after 3 seconds
      setTimeout(() => {
        if (currentSession) {
          connectWebSocket(currentSession.id).catch(console.error);
        }
      }, 3000);
    };
    
    // Send ping every 30 seconds to keep connection alive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);
  });
}

export function addEventListener(listener: (event: any) => void) {
  eventListeners.push(listener);
  return () => {
    eventListeners = eventListeners.filter(l => l !== listener);
  };
}

export async function initializeSession() {
  try {
    const session = await createSession();
    await connectWebSocket(session.id);
    return session;
  } catch (error) {
    console.error('Failed to initialize session:', error);
    throw error;
  }
}

async function getJson<T>(path: string, timeoutMs = 800) {
  const controller = new AbortController();
  const id = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${getBaseUrl()}${path}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    window.clearTimeout(id);
  }
}

async function postJson<TReq, TRes>(path: string, body: TReq, timeoutMs = 1500) {
  const controller = new AbortController();
  const id = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${getBaseUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as TRes;
  } finally {
    window.clearTimeout(id);
  }
}

export type HealthResponse = { ok: boolean; uptime: string };
export type IdentityResponse = { peer_id: string; fingerprint: string; addrs: string[] };
export type PeersResponse = { peers: { peer_id: string }[] };
export type PresenceResponse = {
  peer_id: string;
  display_name: string;
  capabilities: string[];
  version: string;
  uptime_sec: number;
};
export type ProtocolsResponse = { protocols: Record<string, string> };
export type PresencePeer = {
  payload: {
    peer_id: string;
    display_name: string;
    capabilities: string[];
    version: string;
    uptime_sec: number;
    timestamp_ms: number;
  };
  last_seen_ms: number;
};
export type PresencePeersResponse = { peers: PresencePeer[] };

export type ChatSendRequest = { peer_id: string; text: string };
export type ChatSendResponse = { ok: boolean; error?: string };

export type ChatEnvelope = {
  id: string;
  type: string;
  timestamp: number;
  sender: string;
  ttl?: number;
  ack_for?: string;
  payload: { text?: string } | null;
};

export type ChatHistoryResponse = {
  peer_id: string;
  messages: ChatEnvelope[];
  read_up_to?: string;
};

export const nodeAgentApi = {
  health: () => getJson<HealthResponse>("/health"),
  identity: () => getJson<IdentityResponse>("/identity"),
  peers: () => getJson<PeersResponse>("/peers"),
  presence: () => getJson<PresenceResponse>("/presence"),
  presencePeers: () => getJson<PresencePeersResponse>("/presence/peers"),
  protocols: () => getJson<ProtocolsResponse>("/protocols"),
  // Increase timeout for /chat/send because backend may try direct stream (~2s) before relay/outbox
  sendChat: (body: ChatSendRequest) => postJson<ChatSendRequest, ChatSendResponse>("/chat/send", body, 4000),
  chatHistory: (peerId: string, limit = 50) =>
    getJson<ChatHistoryResponse>(`/chat/history?peer_id=${encodeURIComponent(peerId)}&limit=${limit}`),
  chatRead: (peerId: string, lastId: string) =>
    postJson<{peer_id: string, last_id: string}, {ok: boolean}>(`/chat/read`, { peer_id: peerId, last_id: lastId }),
  
  // Session management
  getSessions: () => getJson<SessionsResponse>("/sessions"),
  
  sendFile: async (peerId: string, file: File) => {
    const formData = new FormData();
    formData.append("peer_id", peerId);
    formData.append("file", file);
    
    // Custom fetch because postJson uses JSON body
    const controller = new AbortController();
    const id = window.setTimeout(() => controller.abort(), 30000); // 30s timeout for upload start
    try {
        // Use getBaseUrl logic
        const env = import.meta.env as ImportMetaEnv & { VITE_NODE_AGENT_URL?: string };
        const url = env.VITE_NODE_AGENT_URL;
        const baseUrl = url?.trim() ? url : defaultBaseUrl;

        const res = await fetch(`${baseUrl}/files/send`, {
            method: "POST",
            body: formData,
            signal: controller.signal,
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`HTTP ${res.status}: ${text}`);
        }
        return (await res.json()) as FileSendResponse;
    } finally {
        window.clearTimeout(id);
    }
  },
  
  getTransfers: () => getJson<FileTransfersResponse>("/files/transfers"),
  setRateLimit: (bps: number) => postJson<{bps: number}, {ok: boolean}>("/files/set_rate_limit", { bps }),
  cancelTransfer: (id: string) => postJson<{id: string}, {ok: boolean}>("/files/cancel", { id }),
  setPeerRateLimit: (peerId: string, bps: number) => postJson<{peer_id: string, bps: number}, {ok: boolean}>("/files/set_rate_limit_peer", { peer_id: peerId, bps }),
  pauseTransfer: (id: string) => postJson<{id: string}, {ok: boolean}>("/files/pause", { id }),
  resumeTransfer: (id: string) => postJson<{id: string}, {ok: boolean}>("/files/resume", { id }),
  peerAddrs: (peerId: string) => getJson<{peer_id: string; p2p_addrs: string[]; fingerprint?: string}>(`/peer/addrs?peer_id=${encodeURIComponent(peerId)}`),

  // Media API
  initiateCall: (peerId: string, sdp: string, type: "audio" | "video") => postJson<{peer_id: string, sdp: string, type: string}, {ok: boolean, call: Call}>("/media/call", {peer_id: peerId, sdp, type}),
  answerCall: (callId: string, sdp: string) => postJson<{call_id: string, sdp: string}, {ok: boolean}>("/media/answer", {call_id: callId, sdp}),
  sendCandidate: (callId: string, candidate: any) => postJson<{call_id: string, candidate: any}, {ok: boolean}>("/media/candidate", {call_id: callId, candidate}),
  hangupCall: (callId: string) => postJson<{call_id: string}, {ok: boolean}>("/media/hangup", {call_id: callId}),
  getMediaEvents: () => getJson<{events: MediaEvent[]}>("/media/events"),
};

export type Call = {
    id: string;
    peer_id: string;
    direction: "incoming" | "outgoing";
    state: string;
    type: "audio" | "video";
    start_time: number;
};

export type MediaEvent = 
    | { type: "incoming_call"; call: Call; sdp: string }
    | { type: "call_accepted"; call: Call; sdp: string }
    | { type: "ice_candidate"; call_id: string; candidate: any }
    | { type: "hangup"; call_id: string };

export type FileTransfer = {
    id: string;
    peer_id: string;
    role: "sender" | "receiver";
    metadata: {
        id: string;
        name: string;
        size: number;
        mime_type?: string;
        hash?: string;
        sender: string;
    };
    status: "pending" | "sending" | "receiving" | "completed" | "failed" | "cancelled";
    local_path: string;
    offset: number;
    total_size: number;
    error?: string;
    start_time: string;
    end_time?: string;
};

export type FileSendResponse = { ok: boolean; transfer?: FileTransfer; error?: string };
export type FileTransfersResponse = { transfers: FileTransfer[] };

export type Session = {
  id: string;
  terminal_id: string;
  process_name: string;
  connected_at: number;
  last_seen: number;
  websocket: boolean;
};

export type SessionsResponse = { sessions: Session[] };
