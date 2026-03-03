import { useState } from 'react';
import { MessageSquare, Phone, Wifi, WifiOff, Shield } from 'lucide-react';
import GeometricAvatar from './GeometricAvatar';
import { nodes } from '@/data/mockData';
import { runtimeLayers, presenceFields, protocolIds } from '@/content/backendBlueprint';
import { useNodeAgentPeers, useNodeAgentPresencePeers } from "@/hooks/useNodeAgent";

interface Props {
  onChatWith: (nodeId: string) => void;
  userAvatar: number | string;
}

const NodesPanel = ({ onChatWith, userAvatar }: Props) => {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const onlineCount = nodes.filter(n => n.online).length;
  const avgLatency = Math.round(nodes.filter(n => n.online).reduce((a, b) => a + b.latency, 0) / (onlineCount || 1));
  const peers = useNodeAgentPeers();
  const presencePeers = useNodeAgentPresencePeers();

  // SVG graph positions
  const centerX = 200, centerY = 140;
  const nodePositions = nodes.map((_, i) => {
    const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
    return { x: centerX + Math.cos(angle) * 100, y: centerY + Math.sin(angle) * 80 };
  });

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-6 space-y-6">
      {/* Status bar */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>{onlineCount + 1} узлов онлайн</span>
        <span>·</span>
        <span>Средняя задержка: {avgLatency} мс</span>
        <span>·</span>
        <span className="flex items-center gap-1"><Shield size={12} className="text-primary" /> Шифрование активно</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Runtime Layers</p>
            <span className="text-[10px] text-muted-foreground">Node Agent</span>
          </div>
          <div className="space-y-2">
            {runtimeLayers.map(layer => (
              <div key={layer.title} className="border border-border rounded-md px-3 py-2 bg-background/40">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold">{layer.title}</p>
                  <span className="text-[10px] text-muted-foreground">{layer.description}</span>
                </div>
                <div className="flex flex-wrap gap-2 mt-2 text-[10px] text-muted-foreground">
                  {layer.items.map(item => (
                    <span key={item} className="px-2 py-0.5 rounded-full border border-border bg-card">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4 space-y-4">
          <div>
            <p className="text-sm font-semibold mb-2">Presence Payload</p>
            <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground font-mono">
              {presenceFields.map(field => (
                <span key={field} className="px-2 py-0.5 rounded-full border border-border bg-background/40">
                  {field}
                </span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold mb-2">Protocol ID</p>
            <div className="space-y-1 text-[11px] text-muted-foreground font-mono">
              {protocolIds.map(id => (
                <div key={id} className="px-2 py-1 rounded-md border border-border bg-background/40">
                  {id}
                </div>
              ))}
            </div>
          </div>
          <div className="pt-3 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold">Connected Peers</p>
              <span className="text-[10px] text-muted-foreground">
                {peers.data?.peers?.length ?? 0}
              </span>
            </div>
            <div className="space-y-1 text-[11px] text-muted-foreground font-mono max-h-28 overflow-y-auto scrollbar-thin">
              {(peers.data?.peers ?? []).length ? (
                peers.data!.peers.map(p => (
                  <div key={p.peer_id} className="px-2 py-1 rounded-md border border-border bg-background/40 break-all">
                    {p.peer_id}
                  </div>
                ))
              ) : (
                <div className="text-[11px] text-muted-foreground">
                  {peers.isError ? "node-agent offline" : "пока нет соединений"}
                </div>
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold">Presence Peers</p>
              <span className="text-[10px] text-muted-foreground">
                {presencePeers.data?.peers?.length ?? 0}
              </span>
            </div>
            <div className="space-y-1 text-[11px] text-muted-foreground font-mono max-h-28 overflow-y-auto scrollbar-thin">
              {(presencePeers.data?.peers ?? []).length ? (
                presencePeers.data!.peers.map(p => {
                  const ageSec = Math.max(0, Math.round((Date.now() - p.last_seen_ms) / 1000));
                  return (
                    <div key={p.payload.peer_id} className="px-2 py-1 rounded-md border border-border bg-background/40">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{p.payload.display_name || "unknown"}</span>
                        <span className="text-foreground/70">{ageSec}s</span>
                      </div>
                      <div className="break-all text-[10px] text-foreground/70">{p.payload.peer_id}</div>
                    </div>
                  );
                })
              ) : (
                <div className="text-[11px] text-muted-foreground">
                  {presencePeers.isError ? "node-agent offline" : "пока никого не видно"}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Network graph */}
      <div className="bg-card rounded-lg border border-border p-4 flex justify-center">
        <svg width="400" height="280" viewBox="0 0 400 280" className="max-w-full">
          {/* Lines */}
          {nodePositions.map((pos, i) => (
            <line
              key={`line-${i}`}
              x1={centerX} y1={centerY} x2={pos.x} y2={pos.y}
              stroke={nodes[i].online ? 'hsl(217, 89%, 63%)' : 'hsl(0, 0%, 20%)'}
              strokeWidth="1.5"
              opacity={nodes[i].online ? 0.5 : 0.2}
              className={nodes[i].online ? 'animate-network-pulse' : ''}
              style={{ animationDelay: `${i * 0.5}s` }}
            />
          ))}
          {/* Center node (me) */}
          <g>
            <circle cx={centerX} cy={centerY} r="20" fill="hsl(var(--primary))" opacity="0.15" />
            <circle cx={centerX} cy={centerY} r="12" fill="hsl(var(--primary))" />
            <text x={centerX} y={centerY + 30} textAnchor="middle" fill="hsl(var(--foreground))" fontSize="10">Вы</text>
          </g>
          {/* Other nodes */}
          {nodePositions.map((pos, i) => (
            <g key={i}
              onMouseEnter={() => setHoveredNode(nodes[i].nodeId)}
              onMouseLeave={() => setHoveredNode(null)}
              className="cursor-pointer"
            >
              <circle cx={pos.x} cy={pos.y} r="10"
                fill={nodes[i].online ? 'hsl(var(--primary))' : 'hsl(var(--muted))'}
                opacity={nodes[i].online ? 0.8 : 0.4}
              />
              <text x={pos.x} y={pos.y + 22} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="9">
                {nodes[i].name.split(' ')[0]}
              </text>
              {hoveredNode === nodes[i].nodeId && (
                <g>
                  <rect x={pos.x - 60} y={pos.y - 50} width="120" height="35" rx="4" fill="hsl(var(--popover))" stroke="hsl(var(--border))" />
                  <text x={pos.x} y={pos.y - 37} textAnchor="middle" fill="hsl(var(--foreground))" fontSize="9">{nodes[i].name}</text>
                  <text x={pos.x} y={pos.y - 25} textAnchor="middle" fill="hsl(var(--primary))" fontSize="8" fontFamily="JetBrains Mono">{nodes[i].nodeId}</text>
                  <text x={pos.x} y={pos.y - 15} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="8">{nodes[i].latency} мс</text>
                </g>
              )}
            </g>
          ))}
        </svg>
      </div>

      {/* Node cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {nodes.map(n => (
          <div key={n.id} className="bg-card rounded-lg border border-border p-4">
            <div className="flex items-center gap-3 mb-3">
              <GeometricAvatar index={n.avatar} size={40} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{n.name}</p>
                <p className="font-mono text-xs text-primary truncate">{n.nodeId}</p>
                <p className="font-mono text-[10px] text-muted-foreground">{n.ip}</p>
              </div>
              {n.online ? (
                <Wifi size={16} className="text-primary shrink-0" />
              ) : (
                <WifiOff size={16} className="text-destructive shrink-0" />
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className={`text-xs font-mono ${
                n.latency <= 30 ? 'text-primary' : n.latency <= 100 ? 'text-muted-foreground' : 'text-destructive'
              }`}>
                {n.latency} мс
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => onChatWith(n.nodeId)}
                  className="text-muted-foreground hover:text-primary"
                  title="Написать"
                >
                  <MessageSquare size={14} />
                </button>
                <button className="text-muted-foreground hover:text-primary" title="Позвонить">
                  <Phone size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default NodesPanel;
