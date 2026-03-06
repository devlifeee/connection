package protocol

import (
	"sync"
)

type ChatStore struct {
	mu      sync.RWMutex
	byPeer  map[string][]Envelope
	acked   map[string]bool
	readUpTo map[string]string // peerID -> last read message id
	maxKeep int
}

func NewChatStore(maxKeep int) *ChatStore {
	return &ChatStore{
		byPeer:  make(map[string][]Envelope),
		acked:   make(map[string]bool),
		readUpTo: make(map[string]string),
		maxKeep: maxKeep,
	}
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
}

func (s *ChatStore) ReadUpTo(peerID string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.readUpTo[peerID]
}
