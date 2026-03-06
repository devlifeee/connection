package protocol

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type ChatStore struct {
	mu      sync.RWMutex
	byPeer  map[string][]Envelope
	acked   map[string]bool
	readUpTo map[string]string // peerID -> last read message id
	maxKeep int
	dataDir string
}

func NewChatStore(maxKeep int) *ChatStore {
	return &ChatStore{
		byPeer:  make(map[string][]Envelope),
		acked:   make(map[string]bool),
		readUpTo: make(map[string]string),
		maxKeep: maxKeep,
	}
}

// SetPersistence enables persistence under dir and loads existing history
func (s *ChatStore) SetPersistence(dir string) error {
	if strings.TrimSpace(dir) == "" {
		return nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.dataDir = dir
	_ = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if filepath.Ext(path) != ".json" {
			return nil
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		var disk struct {
			Messages []Envelope `json:"messages"`
			ReadUpTo string     `json:"read_up_to,omitempty"`
		}
		if json.Unmarshal(b, &disk) != nil {
			return nil
		}
		peerID := strings.TrimSuffix(filepath.Base(path), ".json")
		s.byPeer[peerID] = append([]Envelope(nil), disk.Messages...)
		if disk.ReadUpTo != "" {
			s.readUpTo[peerID] = disk.ReadUpTo
		}
		// rebuild acked
		for _, e := range disk.Messages {
			if e.Type == "ack" && e.AckFor != "" {
				s.acked[e.AckFor] = true
			}
		}
		return nil
	})
	return nil
}

func (s *ChatStore) persistUnsafe(peerID string) {
	if s.dataDir == "" {
		return
	}
	payload := struct {
		Messages []Envelope `json:"messages"`
		ReadUpTo string     `json:"read_up_to,omitempty"`
	}{
		Messages: s.byPeer[peerID],
		ReadUpTo: s.readUpTo[peerID],
	}
	b, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(filepath.Join(s.dataDir, peerID+".json"), b, 0o644)
}

func (s *ChatStore) Add(peerID string, e Envelope) {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := append(s.byPeer[peerID], e)
	if s.maxKeep > 0 && len(list) > s.maxKeep {
		list = list[len(list)-s.maxKeep:]
	}
	s.byPeer[peerID] = list
	if e.Type == "ack" && e.AckFor != "" {
		s.acked[e.AckFor] = true
	}
	s.persistUnsafe(peerID)
}

func (s *ChatStore) Acked(id string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.acked[id]
}

func (s *ChatStore) Messages(peerID string, limit int) []Envelope {
	s.mu.RLock()
	defer s.mu.RUnlock()
	all := s.byPeer[peerID]
	if limit <= 0 || limit >= len(all) {
		out := make([]Envelope, len(all))
		copy(out, all)
		return out
	}
	out := make([]Envelope, limit)
	copy(out, all[len(all)-limit:])
	return out
}

func (s *ChatStore) MarkReadUpTo(peerID string, lastID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.readUpTo[peerID] = lastID
	s.persistUnsafe(peerID)
}

func (s *ChatStore) ReadUpTo(peerID string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.readUpTo[peerID]
}
