import { useState, useCallback } from 'react';
import { UploadCloud, File, X, ArrowUp, ArrowDown, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fileTransfers, nodes, type FileTransfer } from '@/data/mockData';

const FilesPanel = () => {
  const [transfers, setTransfers] = useState<FileTransfer[]>(fileTransfers);
  const [activeTransfer, setActiveTransfer] = useState<{ name: string; progress: number; node: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const simulateTransfer = useCallback((fileName: string) => {
    setActiveTransfer({ name: fileName, progress: 0, node: nodes[0].name });
    let prog = 0;
    const interval = setInterval(() => {
      prog += Math.random() * 15;
      if (prog >= 100) {
        clearInterval(interval);
        setActiveTransfer(null);
        setTransfers(prev => [{
          id: Date.now().toString(), name: fileName, direction: 'up', node: nodes[0].name,
          size: '1.2 МБ', status: 'completed',
          time: new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }),
        }, ...prev]);
      } else {
        setActiveTransfer(prev => prev ? { ...prev, progress: Math.min(prog, 99) } : null);
      }
    }, 200);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      setSelectedFile(file.name);
      simulateTransfer(file.name);
    }
  }, [simulateTransfer]);

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-6 space-y-6">
      <h2 className="text-lg font-semibold">Передача файлов</h2>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => document.getElementById('file-input')?.click()}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground'
        }`}
      >
        <UploadCloud size={32} className="mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">Перетащите файл или нажмите для выбора</p>
        <input id="file-input" type="file" className="hidden" onChange={e => {
          const f = e.target.files?.[0];
          if (f) { setSelectedFile(f.name); simulateTransfer(f.name); }
        }} />
      </div>

      {selectedFile && !activeTransfer && (
        <div className="flex items-center gap-3 bg-card rounded-lg p-3 border border-border">
          <File size={16} className="text-primary" />
          <span className="text-sm flex-1">{selectedFile}</span>
          <Button size="sm" onClick={() => simulateTransfer(selectedFile)}>Отправить</Button>
        </div>
      )}

      {/* Active transfer */}
      {activeTransfer && (
        <div className="bg-card rounded-lg p-3 border border-border">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <File size={14} className="text-primary" />
              <span className="text-sm">{activeTransfer.name}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>2.3 МБ/с</span>
              <X size={14} className="cursor-pointer hover:text-foreground" onClick={() => setActiveTransfer(null)} />
            </div>
          </div>
          <div className="h-1 bg-border rounded-full overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${activeTransfer.progress}%` }} />
          </div>
        </div>
      )}

      {/* History */}
      <div>
        <h3 className="text-sm font-medium mb-3">История</h3>
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs">
                <th className="text-left p-3">Файл</th>
                <th className="text-left p-3 hidden sm:table-cell">Направление</th>
                <th className="text-left p-3 hidden md:table-cell">Узел</th>
                <th className="text-left p-3">Размер</th>
                <th className="text-left p-3">Статус</th>
                <th className="text-left p-3 hidden sm:table-cell">Время</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map(t => (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-background/50">
                  <td className="p-3 flex items-center gap-2">
                    <File size={14} className="text-muted-foreground" />
                    <span className="truncate max-w-[120px]">{t.name}</span>
                  </td>
                  <td className="p-3 hidden sm:table-cell">
                    {t.direction === 'up' ? <ArrowUp size={14} className="text-primary" /> : <ArrowDown size={14} className="text-primary" />}
                  </td>
                  <td className="p-3 hidden md:table-cell text-muted-foreground">{t.node}</td>
                  <td className="p-3 text-muted-foreground">{t.size}</td>
                  <td className="p-3">
                    {t.status === 'completed' ? <CheckCircle size={14} className="text-primary" /> : <AlertCircle size={14} className="text-destructive" />}
                  </td>
                  <td className="p-3 text-muted-foreground hidden sm:table-cell">{t.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default FilesPanel;
