export interface Node {
  id: string;
  name: string;
  nodeId: string;
  ip: string;
  latency: number;
  online: boolean;
  avatar: number; // 0-5 geometric avatar index
  messagesSent: number;
  messagesReceived: number;
  filesCount: number;
  filesSize: string;
  sessionTime: string;
  fingerprint: string;
}

export interface Message {
  id: string;
  from: string; // nodeId or 'me'
  text: string;
  time: string;
  delivered: boolean;
  type: 'text' | 'file' | 'system';
  fileName?: string;
  fileSize?: string;
}

export interface Dialog {
  nodeId: string;
  lastMessage: string;
  time: string;
  unread: number;
}

export interface FileTransfer {
  id: string;
  name: string;
  direction: 'up' | 'down';
  node: string;
  size: string;
  status: 'completed' | 'active' | 'failed';
  time: string;
  speed?: string;
  progress?: number;
}

export interface CallRecord {
  id: string;
  nodeId: string;
  type: 'voice' | 'video';
  direction: 'incoming' | 'outgoing' | 'missed';
  duration: string;
  time: string;
}

export const nodes: Node[] = [
  {
    id: '1', name: 'Алексей В.', nodeId: 'УЗЛ-4a7c1f9e', ip: '192.168.1.42',
    latency: 8, online: true, avatar: 0, messagesSent: 47, messagesReceived: 52,
    filesCount: 3, filesSize: '4.2 МБ', sessionTime: '00:47:12',
    fingerprint: 'a3f9...b72c',
  },
  {
    id: '2', name: 'Мария Ч.', nodeId: 'УЗЛ-9b3e7a12', ip: '192.168.1.67',
    latency: 22, online: true, avatar: 1, messagesSent: 12, messagesReceived: 18,
    filesCount: 1, filesSize: '1.1 МБ', sessionTime: '00:23:45',
    fingerprint: 'c7d2...e1a8',
  },
  {
    id: '3', name: 'Иван П.', nodeId: 'УЗЛ-f1c5d890', ip: '192.168.1.88',
    latency: 45, online: false, avatar: 2, messagesSent: 5, messagesReceived: 3,
    filesCount: 0, filesSize: '0 МБ', sessionTime: '—',
    fingerprint: 'b4e1...9f3d',
  },
  {
    id: '4', name: 'Дарья К.', nodeId: 'УЗЛ-2d8f3b71', ip: '192.168.1.103',
    latency: 11, online: true, avatar: 3, messagesSent: 31, messagesReceived: 28,
    filesCount: 2, filesSize: '2.8 МБ', sessionTime: '00:35:20',
    fingerprint: 'e5a3...c4b7',
  },
];

export const dialogs: Dialog[] = [
  { nodeId: 'УЗЛ-4a7c1f9e', lastMessage: 'Получил. Задержка 8 мс.', time: '14:32', unread: 0 },
  { nodeId: 'УЗЛ-9b3e7a12', lastMessage: 'Отправила отчёт', time: '13:15', unread: 2 },
  { nodeId: 'УЗЛ-2d8f3b71', lastMessage: 'Подключаюсь через 5 минут', time: '12:40', unread: 1 },
];

export const messagesAlexey: Message[] = [
  { id: '1', from: 'УЗЛ-4a7c1f9e', text: 'Система запущена?', time: '14:28', delivered: true, type: 'text' },
  { id: '2', from: 'me', text: 'Да, mDNS нашёл 4 узла', time: '14:29', delivered: true, type: 'text' },
  { id: 's1', from: 'system', text: 'Алексей подключился в 14:29', time: '14:29', delivered: true, type: 'system' },
  { id: '3', from: 'УЗЛ-4a7c1f9e', text: 'Попробуй отправить файл', time: '14:30', delivered: true, type: 'text' },
  { id: '4', from: 'УЗЛ-4a7c1f9e', text: '', time: '14:31', delivered: true, type: 'file', fileName: 'topology_map.pdf', fileSize: '2.4 МБ' },
  { id: '5', from: 'me', text: 'Получил. Задержка 8 мс.', time: '14:32', delivered: true, type: 'text' },
];

export const fileTransfers: FileTransfer[] = [
  { id: '1', name: 'topology_map.pdf', direction: 'down', node: 'Алексей В.', size: '2.4 МБ', status: 'completed', time: '14:31' },
  { id: '2', name: 'config.json', direction: 'up', node: 'Мария Ч.', size: '0.3 МБ', status: 'completed', time: '13:10' },
  { id: '3', name: 'network_log.txt', direction: 'down', node: 'Дарья К.', size: '1.1 МБ', status: 'completed', time: '12:45' },
];

export const callRecords: CallRecord[] = [
  { id: '1', nodeId: 'УЗЛ-4a7c1f9e', type: 'voice', direction: 'outgoing', duration: '02:34', time: '13:00' },
  { id: '2', nodeId: 'УЗЛ-9b3e7a12', type: 'video', direction: 'incoming', duration: '05:12', time: '11:30' },
  { id: '3', nodeId: 'УЗЛ-f1c5d890', type: 'voice', direction: 'missed', duration: '—', time: '10:15' },
];

export const channels = [
  { name: 'общий', members: 4 },
  { name: 'команда', members: 2 },
];

export function generateNodeId(): string {
  const hex = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `УЗЛ-${hex}`;
}

export function getNodeByNodeId(nodeId: string): Node | undefined {
  return nodes.find(n => n.nodeId === nodeId);
}

// Geometric avatar SVG paths (6 variants)
export const avatarShapes = [
  // Hexagon
  'M50 5 L90 27.5 L90 72.5 L50 95 L10 72.5 L10 27.5 Z',
  // Diamond
  'M50 5 L95 50 L50 95 L5 50 Z',
  // Triangle
  'M50 5 L95 90 L5 90 Z',
  // Pentagon
  'M50 5 L95 38 L77 90 L23 90 L5 38 Z',
  // Octagon
  'M30 5 L70 5 L95 30 L95 70 L70 95 L30 95 L5 70 L5 30 Z',
  // Star
  'M50 5 L61 35 L95 35 L68 57 L79 90 L50 70 L21 90 L32 57 L5 35 L39 35 Z',
];
