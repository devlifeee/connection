export const runtimeLayers = [
  {
    title: 'Identity Layer',
    description: 'Ed25519 ключи, PeerID и доверие к контактам',
    items: ['Fingerprint в UI', 'Trust level: trusted / unknown / blocked', 'Подпись каждого сообщения'],
  },
  {
    title: 'Discovery Layer',
    description: 'mDNS как основной канал и UDP broadcast как fallback',
    items: ['Smart Presence Protocol', 'Capability negotiation', 'Version compatibility'],
  },
  {
    title: 'Secure Transport',
    description: 'libp2p streams для приватного трафика и PubSub для broadcast',
    items: ['Noise для канала', 'Protocol ID с версиями', 'QoS и контроль соединений'],
  },
  {
    title: 'Media Signaling',
    description: 'SDP и ICE через libp2p, медиа через WebRTC',
    items: ['DTLS + SRTP', 'State machine звонка', 'Без STUN/TURN в LAN'],
  },
];

export const protocolIds = [
  '/nhex/chat/1.0.0',
  '/nhex/file/1.0.0',
  '/nhex/media-signal/1.0.0',
  '/nhex/presence/1.0.0',
];

export const presenceFields = [
  'peer_id',
  'display_name',
  'capabilities',
  'version',
  'uptime',
];

export const messageEnvelope = [
  { field: 'id', note: 'uuid' },
  { field: 'type', note: 'chat | file_meta | file_chunk | sdp | ice' },
  { field: 'timestamp', note: 'unix time' },
  { field: 'sender', note: 'peer_id' },
  { field: 'payload', note: 'данные сообщения' },
  { field: 'signature', note: 'подпись отправителя' },
];

export const messagingRules = [
  'Private → libp2p streams',
  'Broadcast → GossipSub',
  'Подпись каждого сообщения и валидация',
  'Версионирование протокола в ID',
];

export const fileProtocol = [
  'FileMeta с размером и SHA‑256',
  'Chunked transfer',
  'Ack по чанкам',
  'Resume после обрыва',
];

export const webrtcFlow = [
  'Caller отправляет SDP через libp2p stream',
  'Callee отвечает SDP через тот же канал',
  'ICE кандидаты через stream',
  'Media идет напрямую по WebRTC',
];

export const roadmapPhases = [
  {
    title: 'Фаза 1 — Core Runtime',
    items: ['Identity', 'mDNS discovery', 'private stream chat', 'message signing'],
  },
  {
    title: 'Фаза 2 — Production Chat',
    items: ['ack', 'delivery status', 'history storage', 'peer list API'],
  },
  {
    title: 'Фаза 3 — File Protocol',
    items: ['chunking', 'hash', 'resume'],
  },
  {
    title: 'Фаза 4 — WebRTC',
    items: ['signaling через stream', 'pion media', 'mute/camera toggle'],
  },
  {
    title: 'Фаза 5 — Hardening',
    items: ['20+ узлов', 'packet loss', 'reconnect stress'],
  },
];
