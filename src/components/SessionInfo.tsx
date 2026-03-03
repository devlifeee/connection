import { useSession } from '@/hooks/useSession';
import { useNodeAgentSessions } from '@/hooks/useNodeAgent';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Terminal, Wifi, WifiOff, RefreshCw } from 'lucide-react';

const SessionInfo = () => {
  const { sessionState, events, clearEvents } = useSession();
  const { data: sessionsData, refetch } = useNodeAgentSessions();

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  const formatDuration = (timestamp: number) => {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  };

  return (
    <div className="space-y-6">
      {/* Current Session */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal size={20} />
            Current Session
          </CardTitle>
          <CardDescription>
            Your active terminal session information
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Session ID</label>
              <p className="text-sm font-mono">{sessionState.id || 'Not connected'}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Terminal ID</label>
              <p className="text-sm font-mono">{sessionState.terminalId || 'N/A'}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Process</label>
              <p className="text-sm">{sessionState.processName || 'N/A'}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Connection</label>
              <div className="flex items-center gap-2">
                {sessionState.connected ? (
                  <>
                    <Wifi size={16} className="text-green-500" />
                    <Badge variant="secondary" className="text-green-700 bg-green-100">
                      Connected
                    </Badge>
                  </>
                ) : (
                  <>
                    <WifiOff size={16} className="text-red-500" />
                    <Badge variant="destructive">
                      Disconnected
                    </Badge>
                  </>
                )}
              </div>
            </div>
          </div>
          
          {sessionState.error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-700">{sessionState.error}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* All Sessions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>All Sessions</CardTitle>
              <CardDescription>
                All active terminal sessions connected to this node
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw size={16} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {sessionsData?.sessions && sessionsData.sessions.length > 0 ? (
            <div className="space-y-3">
              {sessionsData.sessions.map((session) => (
                <div key={session.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Terminal size={16} />
                      <span className="font-mono text-sm">{session.terminal_id}</span>
                      {session.websocket && (
                        <Badge variant="secondary" className="text-green-700 bg-green-100">
                          WebSocket
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{session.process_name}</p>
                  </div>
                  <div className="text-right text-sm text-muted-foreground">
                    <p>Connected: {formatTimestamp(session.connected_at)}</p>
                    <p>Last seen: {formatDuration(session.last_seen)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No active sessions found
            </p>
          )}
        </CardContent>
      </Card>

      {/* Recent Events */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Recent Events</CardTitle>
              <CardDescription>
                Real-time events received via WebSocket ({events.length} total)
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={clearEvents}>
              Clear
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {events.length > 0 ? (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {events.slice(-10).reverse().map((event, index) => (
                <div key={index} className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{event.type}</Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {new Date(event.timestamp * 1000).toLocaleTimeString()}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {Object.keys(event).filter(k => k !== 'type' && k !== 'timestamp').length} fields
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No events received yet
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SessionInfo;