package protocol

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type OutboxItem struct {
	PeerID      string          `json:"peer_id"`
	Envelope    Envelope        `json:"envelope"`
	NextAttempt int64           `json:"next_attempt_ms"`
	Attempts    int             `json:"attempts"`
	MaxRetries  int             `json:"max_retries"`
	TTL         int             `json:"ttl"`
	CreatedMs   int64           `json:"created_ms"`
	Meta        json.RawMessage `json:"meta,omitempty"`
}

type Outbox struct {
	mu      sync.Mutex
	items   []*OutboxItem
	dataDir string
}

func NewOutbox() *Outbox {
	return &Outbox{}
}

func (o *Outbox) SetPersistence(dir string) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.dataDir = dir
	if strings.TrimSpace(dir) == "" {
		return nil
	}
	_ = os.MkdirAll(dir, 0o755)
	path := filepath.Join(dir, "outbox.json")
	if b, err := os.ReadFile(path); err == nil {
		var disk []*OutboxItem
		if json.Unmarshal(b, &disk) == nil {
			o.items = disk
		}
	}
	return nil
}

func (o *Outbox) persistUnsafe() {
	if o.dataDir == "" {
		return
	}
	b, err := json.MarshalIndent(o.items, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(filepath.Join(o.dataDir, "outbox.json"), b, 0o644)
}

func (o *Outbox) Enqueue(it *OutboxItem) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.items = append(o.items, it)
	o.persistUnsafe()
}

func (o *Outbox) DequeueReady(now time.Time) *OutboxItem {
	o.mu.Lock()
	defer o.mu.Unlock()
	sort.SliceStable(o.items, func(i, j int) bool { return o.items[i].NextAttempt < o.items[j].NextAttempt })
	for i, it := range o.items {
		if it.NextAttempt <= now.UnixMilli() && it.TTL > 0 && it.Attempts <= it.MaxRetries {
			// pop
			o.items = append(o.items[:i], o.items[i+1:]...)
			o.persistUnsafe()
			return it
		}
	}
	return nil
}

func (o *Outbox) Size() int {
	o.mu.Lock()
	defer o.mu.Unlock()
	return len(o.items)
}

func (o *Outbox) Items() []*OutboxItem {
	o.mu.Lock()
	defer o.mu.Unlock()
	out := make([]*OutboxItem, 0, len(o.items))
	for _, it := range o.items {
		cp := *it
		out = append(out, &cp)
	}
	return out
}

func (o *Outbox) RemoveByEnvelopeID(id string) bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	for i, it := range o.items {
		if it.Envelope.ID == id {
			o.items = append(o.items[:i], o.items[i+1:]...)
			o.persistUnsafe()
			return true
		}
	}
	return false
}

func (o *Outbox) TouchNowByEnvelopeID(id string) bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	now := time.Now().UnixMilli()
	for _, it := range o.items {
		if it.Envelope.ID == id {
			it.NextAttempt = now
			o.persistUnsafe()
			return true
		}
	}
	return false
}
