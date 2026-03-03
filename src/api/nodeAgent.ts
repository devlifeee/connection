const defaultBaseUrl = "http://127.0.0.1:9876";

function getBaseUrl() {
  const env = import.meta.env as ImportMetaEnv & { VITE_NODE_AGENT_URL?: string };
  const url = env.VITE_NODE_AGENT_URL;
  return url?.trim() ? url : defaultBaseUrl;
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

export const nodeAgentApi = {
  health: () => getJson<HealthResponse>("/health"),
  identity: () => getJson<IdentityResponse>("/identity"),
  peers: () => getJson<PeersResponse>("/peers"),
  presence: () => getJson<PresenceResponse>("/presence"),
  presencePeers: () => getJson<PresencePeersResponse>("/presence/peers"),
  protocols: () => getJson<ProtocolsResponse>("/protocols"),
};
