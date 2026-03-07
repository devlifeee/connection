package presence

import (
	"sort"
	"sync"
	"time"
    "os"
    "path/filepath"
    "encoding/json"
    "log"
)

type Self struct {
	DisplayName  string   `json:"display_name"`
	Version      string   `json:"version"`
	Capabilities []string `json:"capabilities"`
}

type Payload struct {
	PeerID       string   `json:"peer_id"`
	DisplayName  string   `json:"display_name"`
	Capabilities []string `json:"capabilities"`
	Version      string   `json:"version"`
	UptimeSec    int64    `json:"uptime_sec"`
	TimestampMs  int64    `json:"timestamp_ms"`
}

type PeerPresence struct {
	Payload   Payload   `json:"payload"`
	LastSeen  time.Time `json:"-"`
	LastSeenMs int64    `json:"last_seen_ms"`
}

type Store struct {
	mu       sync.RWMutex
	self     Self
	peers    map[string]PeerPresence
    dataDir  string
    savePath string
}

func NewStore(self Self, dataDir string) *Store {
    s := &Store{
		self:     self,
		peers:    map[string]PeerPresence{},
        dataDir:  dataDir,
        savePath: filepath.Join(dataDir, "presence_store.json"),
	}
    s.load()
    return s
}

func (s *Store) load() {
    b, err := os.ReadFile(s.savePath)
    if err != nil {
        return
    }
    var saved struct {
        Self Self `json:"self"`
    }
    if err := json.Unmarshal(b, &saved); err == nil {
        if saved.Self.DisplayName != "" {
            s.self.DisplayName = saved.Self.DisplayName
        }
    }
}

func (s *Store) save() {
    data := struct {
        Self Self `json:"self"`
    }{
        Self: s.self,
    }
    b, _ := json.MarshalIndent(data, "", "  ")
    _ = os.WriteFile(s.savePath, b, 0644)
}

func (s *Store) Self() Self {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.self
}

func (s *Store) UpdateSelf(self Self) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.self = self
    s.save()
}

func (s *Store) Upsert(p Payload) {
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.peers[p.PeerID] = PeerPresence{
		Payload:    p,
		LastSeen:   now,
		LastSeenMs: now.UnixMilli(),
	}
}

func (s *Store) Snapshot() []PeerPresence {
	s.mu.RLock()
	out := make([]PeerPresence, 0, len(s.peers))
	for _, v := range s.peers {
		out = append(out, v)
	}
	s.mu.RUnlock()

	sort.Slice(out, func(i, j int) bool {
		return out[i].LastSeenMs > out[j].LastSeenMs
	})
	return out
}

