import { useState, useCallback } from 'react';
import { UploadCloud, File as FileIcon, CheckCircle, AlertCircle, Loader2, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFileTransfers, useSendFile, useNodeAgentPresencePeers } from '@/hooks/useNodeAgent';
import { nodeAgentApi } from '@/api/nodeAgent';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

const FilesPanel = () => {
  const { data: transfersData } = useFileTransfers();
  const { mutate: sendFile, isPending: isSending } = useSendFile();
  const { data: peersData } = useNodeAgentPresencePeers();
  
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [targetPeerId, setTargetPeerId] = useState<string>("");
  const [rateLimit, setRateLimit] = useState<number>(0);
  const [peerRate, setPeerRate] = useState<number>(0);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setSelectedFile(e.dataTransfer.files[0]);
    }
  }, []);

  const handleSend = () => {
    if (!selectedFile || !targetPeerId) {
        toast.error("Please select a file and a peer");
        return;
    }

    sendFile({ peerId: targetPeerId, file: selectedFile }, {
      onSuccess: () => {
        toast.success("File transfer started");
        setSelectedFile(null);
      },
      onError: (err) => {
        toast.error("Failed to send file: " + err.message);
      }
    });
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle size={16} className="text-green-500" />;
      case 'failed': return <AlertCircle size={16} className="text-red-500" />;
      case 'sending': return <ArrowUp size={16} className="text-blue-500 animate-pulse" />;
      case 'receiving': return <ArrowDown size={16} className="text-purple-500 animate-pulse" />;
      default: return <Loader2 size={16} className="animate-spin text-muted-foreground" />;
    }
  };

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-6 space-y-6">
      <h2 className="text-lg font-semibold">File Transfer</h2>

      {/* Upload Area */}
      <div className="space-y-4">
         <div className="flex items-end gap-3">
            <div className="flex-1">
               <label className="text-sm font-medium text-muted-foreground">Rate Limit (bytes/sec, 0 = unlimited)</label>
               <input type="number" className="w-full mt-1 px-3 py-2 rounded-md border border-border bg-card"
                 value={rateLimit} onChange={(e) => setRateLimit(Number(e.target.value)||0)} />
            </div>
            <Button onClick={async () => {
              try { 
                await nodeAgentApi.setRateLimit(rateLimit); 
                toast.success("Rate limit updated");
              } catch (e:any) { toast.error("Failed to set rate limit: " + e.message); }
            }}>Apply</Button>
         </div>
         
         {targetPeerId && (
           <div className="flex items-end gap-3">
             <div className="flex-1">
               <label className="text-sm font-medium text-muted-foreground">Per-peer Rate (bytes/sec) для {targetPeerId.substring(0,8)}…</label>
               <input type="number" className="w-full mt-1 px-3 py-2 rounded-md border border-border bg-card"
                 value={peerRate} onChange={(e) => setPeerRate(Number(e.target.value)||0)} />
             </div>
             <Button onClick={async () => {
               try {
                 await nodeAgentApi.setPeerRateLimit(targetPeerId, peerRate);
                 toast.success("Peer rate limit updated");
               } catch (e:any) {
                 toast.error("Failed to set peer rate: " + e.message);
               }
             }}>Apply</Button>
           </div>
         )}
         <div className="flex flex-col gap-2">
             <label className="text-sm font-medium text-muted-foreground">Select Recipient</label>
             <Select value={targetPeerId} onValueChange={setTargetPeerId}>
                <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select peer..." />
                </SelectTrigger>
                <SelectContent>
                    {peersData?.peers.map(p => (
                        <SelectItem key={p.payload.peer_id} value={p.payload.peer_id}>
                            {p.payload.display_name || p.payload.peer_id.substring(0, 8)}
                        </SelectItem>
                    ))}
                    {(!peersData?.peers || peersData.peers.length === 0) && (
                        <div className="p-2 text-sm text-muted-foreground text-center">No peers online</div>
                    )}
                </SelectContent>
             </Select>
         </div>

         <div
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => document.getElementById('file-input')?.click()}
            className="border-2 border-dashed border-border hover:border-primary/50 rounded-lg p-8 text-center cursor-pointer transition-colors bg-card"
          >
            <UploadCloud size={32} className="mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              {selectedFile ? selectedFile.name : "Drag & drop file here or click to select"}
            </p>
            <input id="file-input" type="file" className="hidden" onChange={handleFileChange} />
          </div>
          
          {selectedFile && (
            <div className="flex justify-end">
                <Button onClick={handleSend} disabled={!targetPeerId || isSending}>
                    {isSending ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Sending...
                        </>
                    ) : (
                        "Send File"
                    )}
                </Button>
            </div>
          )}
      </div>

      {/* Transfers List */}
      <div className="space-y-3 pt-4 border-t border-border">
        <h3 className="text-sm font-medium text-muted-foreground">Transfer History</h3>
        
        {(!transfersData?.transfers || transfersData.transfers.length === 0) && (
            <div className="text-center py-8 text-muted-foreground text-sm bg-muted/20 rounded-lg">
                No active or past transfers
            </div>
        )}

        {transfersData?.transfers?.slice().reverse().map(t => (
          <div key={t.id} className="bg-card rounded-lg p-3 border border-border flex items-center gap-3">
             <div className="p-2 bg-muted rounded-full shrink-0">
                {getStatusIcon(t.status)}
             </div>
             <div className="flex-1 min-w-0">
                <div className="flex justify-between mb-1 items-center">
                    <p className="text-sm font-medium truncate pr-2">{t.metadata.name}</p>
                    <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded-full ${
                        t.status === 'completed' ? 'bg-green-500/10 text-green-500' :
                        t.status === 'failed' ? 'bg-red-500/10 text-red-500' :
                        'bg-blue-500/10 text-blue-500'
                    }`}>
                        {t.status}
                    </span>
                </div>
                
                {t.status === 'sending' || t.status === 'receiving' ? (
                    <div className="w-full bg-secondary h-1.5 rounded-full overflow-hidden mb-1">
                        <div 
                            className="bg-primary h-full transition-all duration-500" 
                            style={{ width: `${Math.min(100, (t.offset / t.total_size) * 100)}%` }} 
                        />
                    </div>
                ) : null}
                
                <div className="flex justify-between mt-1 text-xs text-muted-foreground">
                    <span>{formatSize(t.offset)} / {formatSize(t.total_size)}</span>
                    <span className="truncate max-w-[150px]" title={t.peer_id}>
                        {t.role === 'sender' ? 'To: ' : 'From: '} {t.peer_id.substring(0, 8)}...
                    </span>
                </div>
                {t.error && (
                    <p className="text-xs text-red-500 mt-1">{t.error}</p>
                )}
                {(t.status === 'sending' || t.status === 'receiving') && (
                  <div className="mt-2">
                    <Button variant="outline" size="sm" onClick={async () => {
                      try { await nodeAgentApi.cancelTransfer(t.id); toast("Transfer cancelled"); } catch(e:any){ toast.error(e.message); }
                    }}>Cancel</Button>
                    {t.status === 'sending' && (
                      <>
                        <Button variant="outline" size="sm" className="ml-2" onClick={async () => {
                          try { await nodeAgentApi.pauseTransfer(t.id); toast("Paused"); } catch(e:any){ toast.error(e.message); }
                        }}>Pause</Button>
                        <Button variant="outline" size="sm" className="ml-2" onClick={async () => {
                          try { await nodeAgentApi.resumeTransfer(t.id); toast("Resumed"); } catch(e:any){ toast.error(e.message); }
                        }}>Resume</Button>
                      </>
                    )}
                  </div>
                )}
             </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FilesPanel;
