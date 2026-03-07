package filetransfer

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
	"mime"

	"github.com/google/uuid"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/protocol"
)

const (
	ProtocolID = protocol.ID("/nhex/file/1.0.0")
	ChunkSize  = 1024 * 64 // 64KB chunks
)

type Config struct {
	DownloadsDir string
	MaxFileSize  int64
	RateLimitBps int64 // bytes per second, 0 = unlimited
}

type Manager struct {
	host      host.Host
	config    Config
	transfers map[string]*Transfer
	mu        sync.RWMutex
	cancelled map[string]struct{}
	peerRate  map[string]int64
	paused    map[string]struct{}
	sem       chan struct{}
	onComplete func(*Transfer)
	onFail    func(*Transfer, string)
	ackObs    func(ms int64)
	statePath string
	acceptFn  func(peerID string, meta Metadata) bool
}

func NewManager(h host.Host, cfg Config) *Manager {
	if cfg.DownloadsDir == "" {
		cfg.DownloadsDir = "downloads"
	}
	if cfg.MaxFileSize == 0 {
		cfg.MaxFileSize = 1024 * 1024 * 1024 // 1GB default
	}

	if err := os.MkdirAll(cfg.DownloadsDir, 0755); err != nil {
		log.Printf("Failed to create downloads directory: %v", err)
	}

	m := &Manager{
		host:      h,
		config:    cfg,
		transfers: make(map[string]*Transfer),
		cancelled: make(map[string]struct{}),
		peerRate:  make(map[string]int64),
		paused:    make(map[string]struct{}),
		sem:       make(chan struct{}, 2), // default parallelism 2
	}
	m.statePath = filepath.Join(cfg.DownloadsDir, ".transfers_state.json")
	m.loadState()
	return m
}

func (m *Manager) DownloadsDir() string {
	return m.config.DownloadsDir
}
func (m *Manager) Start() {
	m.host.SetStreamHandler(ProtocolID, m.handleStream)
}

func (m *Manager) SetOnComplete(fn func(*Transfer)) { m.onComplete = fn }
func (m *Manager) SetOnFail(fn func(*Transfer, string)) { m.onFail = fn }
func (m *Manager) SetAckObserver(fn func(ms int64)) { m.ackObs = fn }
func (m *Manager) SetAcceptFilter(fn func(peerID string, meta Metadata) bool) { m.acceptFn = fn }

func (m *Manager) saveState() {
	m.mu.RLock()
	defer m.mu.RUnlock()
	list := make([]*Transfer, 0, len(m.transfers))
	for _, t := range m.transfers {
		val := *t
		list = append(list, &val)
	}
	b, err := json.Marshal(list)
	if err != nil {
		return
	}
	_ = os.WriteFile(m.statePath, b, 0644)
}

func (m *Manager) loadState() {
	b, err := os.ReadFile(m.statePath)
	if err != nil {
		return
	}
	var list []*Transfer
	if err := json.Unmarshal(b, &list); err != nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, t := range list {
		if t != nil {
			m.transfers[t.ID] = t
		}
	}
}

func (m *Manager) ListTransfers() []*Transfer {
	m.mu.RLock()
	defer m.mu.RUnlock()
	list := make([]*Transfer, 0, len(m.transfers))
	for _, t := range m.transfers {
		// Return copy to be safe
		val := *t
		list = append(list, &val)
	}
	return list
}

func (m *Manager) GetTransfer(id string) (*Transfer, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	t, ok := m.transfers[id]
	if !ok {
		return nil, false
	}
	val := *t
	return &val, true
}

// SendFile initiates a file transfer
func (m *Manager) SendFile(ctx context.Context, targetPeerID string, filePath string) (*Transfer, error) {
	// Check file existence
	info, err := os.Stat(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to stat file: %w", err)
	}

	// Create initial transfer record
	transferID := uuid.New().String()
	
	// Calculate hash in background to not block? 
	// For large files this takes time. Let's do it in the goroutine and update status.
	// But we need hash for Offer. So we must calculate it.
	// Let's assume for MVP files are not huge or we block briefly.
	// Or we can calculate it in processSend and update metadata before sending Offer.
	
	metadata := Metadata{
		ID:     transferID,
		Name:   filepath.Base(filePath),
		Size:   info.Size(),
		Sender: m.host.ID().String(),
		// Hash will be filled later
	}

	t := &Transfer{
		ID:        transferID,
		PeerID:    targetPeerID,
		Role:      "sender",
		Metadata:  metadata,
		Status:    StatusPending,
		LocalPath: filePath,
		TotalSize: info.Size(),
		StartTime: time.Now(),
	}

	m.mu.Lock()
	m.transfers[transferID] = t
	m.mu.Unlock()
	m.saveState()

	go func() {
		select {
		case m.sem <- struct{}{}:
			defer func() { <-m.sem }()
			m.processSend(context.Background(), t)
		case <-time.After(100 * time.Millisecond):
			// queued start
			time.Sleep(500 * time.Millisecond)
			m.sem <- struct{}{}
			defer func() { <-m.sem }()
			m.processSend(context.Background(), t)
		}
	}()

	return t, nil
}

func (m *Manager) processSend(ctx context.Context, t *Transfer) {
	m.updateStatus(t.ID, StatusSending)

	maxRetries := 5
	backoff := 800 * time.Millisecond
	retries := 0
	for {
		file, err := os.Open(t.LocalPath)
		if err != nil {
			m.failTransfer(t.ID, "failed to open file: "+err.Error())
			return
		}

		ext := filepath.Ext(t.LocalPath)
		if mt := mime.TypeByExtension(ext); mt != "" {
			t.Metadata.MimeType = mt
		}
		hasher := sha256.New()
		if _, err := io.Copy(hasher, file); err != nil {
			_ = file.Close()
			m.failTransfer(t.ID, "failed to hash file: "+err.Error())
			return
		}
		t.Metadata.Hash = hex.EncodeToString(hasher.Sum(nil))
		if _, err := file.Seek(0, 0); err != nil {
			_ = file.Close()
			m.failTransfer(t.ID, "failed to rewind file: "+err.Error())
			return
		}

		pid, err := peer.Decode(t.PeerID)
		if err != nil {
			_ = file.Close()
			m.failTransfer(t.ID, "invalid peer id: "+err.Error())
			return
		}

		stream, err := m.host.NewStream(ctx, pid, ProtocolID)
		if err != nil {
			_ = file.Close()
			if retries < maxRetries {
				retries++
				time.Sleep(time.Duration(retries) * backoff)
				continue
			}
			m.failTransfer(t.ID, "failed to connect: "+err.Error())
			return
		}
		rw := bufio.NewReadWriter(bufio.NewReader(stream), bufio.NewWriter(stream))

		if err := writeJSON(rw, MsgOffer, OfferPayload{Metadata: t.Metadata}); err != nil {
			_ = file.Close()
			_ = stream.Close()
			if retries < maxRetries {
				retries++
				time.Sleep(time.Duration(retries) * backoff)
				continue
			}
			m.failTransfer(t.ID, "send offer failed: "+err.Error())
			return
		}

		msg, err := readJSON(rw)
		if err != nil {
			_ = file.Close()
			_ = stream.Close()
			if retries < maxRetries {
				retries++
				time.Sleep(time.Duration(retries) * backoff)
				continue
			}
			m.failTransfer(t.ID, "read accept failed: "+err.Error())
			return
		}

		if msg.Type == MsgReject {
			var p RejectPayload
			json.Unmarshal(msg.Payload, &p)
			_ = file.Close()
			_ = stream.Close()
			m.failTransfer(t.ID, "rejected: "+p.Reason)
			return
		}
		if msg.Type != MsgAccept {
			_ = file.Close()
			_ = stream.Close()
			m.failTransfer(t.ID, "unexpected response to offer: "+string(msg.Type))
			return
		}

		var accept AcceptPayload
		json.Unmarshal(msg.Payload, &accept)
		if accept.Offset > 0 {
			if _, err := file.Seek(accept.Offset, 0); err != nil {
				_ = file.Close()
				_ = stream.Close()
				m.failTransfer(t.ID, "seek failed: "+err.Error())
				return
			}
			m.updateProgress(t.ID, accept.Offset)
		}

		buf := make([]byte, ChunkSize)
		offset := accept.Offset
		var lastSent time.Time
		var sentBytesInWindow int64
		windowStart := time.Now()

		for offset < t.TotalSize {
			chunkStart := time.Now()
			for {
				m.mu.RLock()
				_, isPaused := m.paused[t.ID]
				m.mu.RUnlock()
				if !isPaused {
					break
				}
				time.Sleep(200 * time.Millisecond)
			}

			m.mu.RLock()
			_, isCancelled := m.cancelled[t.ID]
			m.mu.RUnlock()
			if isCancelled {
				_ = file.Close()
				_ = stream.Close()
				m.failTransfer(t.ID, "cancelled")
				return
			}

			n, err := file.Read(buf)
			if err != nil && err != io.EOF {
				_ = file.Close()
				_ = stream.Close()
				if retries < maxRetries {
					retries++
					time.Sleep(time.Duration(retries) * backoff)
					goto retryLoop
				}
				m.failTransfer(t.ID, "read file failed: "+err.Error())
				return
			}
			if n == 0 {
				break
			}

			chunk := ChunkPayload{
				TransferID: t.ID,
				Offset:     offset,
				Data:       buf[:n],
			}

			if err := writeJSON(rw, MsgChunk, chunk); err != nil {
				_ = file.Close()
				_ = stream.Close()
				if retries < maxRetries {
					retries++
					time.Sleep(time.Duration(retries) * backoff)
					goto retryLoop
				}
				m.failTransfer(t.ID, "send chunk failed: "+err.Error())
				return
			}

			m.mu.RLock()
			effectiveBps := m.config.RateLimitBps
			if bps, ok := m.peerRate[t.PeerID]; ok && bps >= 0 {
				effectiveBps = bps
			}
			m.mu.RUnlock()
			if effectiveBps > 0 {
				now := time.Now()
				if lastSent.IsZero() {
					lastSent = now
					windowStart = now
					sentBytesInWindow = 0
				}
				sentBytesInWindow += int64(n)
				elapsed := now.Sub(windowStart)
				allowed := float64(effectiveBps) * elapsed.Seconds()
				if float64(sentBytesInWindow) > allowed {
					overBytes := float64(sentBytesInWindow) - allowed
					sleepDur := time.Duration(overBytes/float64(effectiveBps)*1e9) * time.Nanosecond
					if sleepDur > 0 && sleepDur < 500*time.Millisecond {
						time.Sleep(sleepDur)
					}
				}
				if elapsed >= time.Second {
					windowStart = now
					sentBytesInWindow = 0
				}
				lastSent = now
			}

			ackMsg, err := readJSON(rw)
			if err != nil {
				_ = file.Close()
				_ = stream.Close()
				if retries < maxRetries {
					retries++
					time.Sleep(time.Duration(retries) * backoff)
					goto retryLoop
				}
				m.failTransfer(t.ID, "wait ack failed: "+err.Error())
				return
			}

			if m.ackObs != nil {
				ms := time.Since(chunkStart).Milliseconds()
				if ms >= 0 && ms < 60000 {
					m.ackObs(ms)
				}
			}

			if ackMsg.Type != MsgAck {
				_ = file.Close()
				_ = stream.Close()
				if retries < maxRetries {
					retries++
					time.Sleep(time.Duration(retries) * backoff)
					goto retryLoop
				}
				m.failTransfer(t.ID, "expected ack, got "+string(ackMsg.Type))
				return
			}

			offset += int64(n)
			m.updateProgress(t.ID, offset)
		}

		if err := writeJSON(rw, MsgComplete, CompletePayload{TransferID: t.ID, Hash: t.Metadata.Hash}); err != nil {
			_ = file.Close()
			_ = stream.Close()
			if retries < maxRetries {
				retries++
				time.Sleep(time.Duration(retries) * backoff)
				goto retryLoop
			}
			m.failTransfer(t.ID, "send complete failed: "+err.Error())
			return
		}
		_ = file.Close()
		_ = stream.Close()
		m.completeTransfer(t.ID)
		return
	retryLoop:
		continue
	}
}

func (m *Manager) handleStream(stream network.Stream) {
	defer stream.Close()
	rw := bufio.NewReadWriter(bufio.NewReader(stream), bufio.NewWriter(stream))

	// 1. Read Offer
	msg, err := readJSON(rw)
	if err != nil {
		log.Printf("Stream read error: %v", err)
		return
	}

	if msg.Type != MsgOffer {
		return // Ignore garbage
	}

	var offer OfferPayload
	if err := json.Unmarshal(msg.Payload, &offer); err != nil {
		return
	}

	// Auto-accept logic (simplified for MVP)
	// Trust-only filter if provided
	if m.acceptFn != nil {
		peerID := stream.Conn().RemotePeer().String()
		if !m.acceptFn(peerID, offer.Metadata) {
			_ = writeJSON(rw, MsgReject, RejectPayload{TransferID: offer.Metadata.ID, Reason: "not trusted"})
			return
		}
	}
	// Create transfer record
	t := &Transfer{
		ID:        offer.Metadata.ID,
		PeerID:    stream.Conn().RemotePeer().String(),
		Role:      "receiver",
		Metadata:  offer.Metadata,
		Status:    StatusReceiving,
		TotalSize: offer.Metadata.Size,
		StartTime: time.Now(),
		LocalPath: filepath.Join(m.config.DownloadsDir, offer.Metadata.Name),
	}

	// Resume support: if partial file exists, resume from size
	var existingSize int64 = 0
	if fi, err := os.Stat(t.LocalPath); err == nil {
		existingSize = fi.Size()
	}

	var file *os.File
	if existingSize > 0 {
		file, err = os.OpenFile(t.LocalPath, os.O_WRONLY|os.O_APPEND, 0644)
	} else {
		file, err = os.Create(t.LocalPath)
	}
	if err != nil {
		writeJSON(rw, MsgReject, RejectPayload{TransferID: t.ID, Reason: "fs error"})
		return
	}
	defer file.Close()

	m.mu.Lock()
	m.transfers[t.ID] = t
	m.mu.Unlock()
	m.saveState()

	// 2. Send Accept
	t.Offset = existingSize
	if err := writeJSON(rw, MsgAccept, AcceptPayload{TransferID: t.ID, Offset: existingSize}); err != nil {
		m.failTransfer(t.ID, "send accept failed")
		return
	}

	// 3. Receive Loop
	hasher := sha256.New()
	if existingSize > 0 {
		if prev, err := os.Open(t.LocalPath); err == nil {
			_, _ = io.CopyN(hasher, prev, existingSize)
			_ = prev.Close()
		}
	}
	
	for {
		// cancellation at receiver side is no-op for now
		msg, err := readJSON(rw)
		if err != nil {
			m.failTransfer(t.ID, "stream closed")
			return
		}

		if msg.Type == MsgComplete {
			var complete CompletePayload
			json.Unmarshal(msg.Payload, &complete)
			
			finalHash := hex.EncodeToString(hasher.Sum(nil))
			if complete.Hash != "" && complete.Hash != finalHash {
				m.failTransfer(t.ID, "hash mismatch")
				writeJSON(rw, MsgError, ErrorPayload{Message: "hash mismatch"})
				return
			}
			
			m.completeTransfer(t.ID)
			m.mu.Lock()
			if tt, ok := m.transfers[t.ID]; ok {
				tt.Verified = true
			}
			m.mu.Unlock()
			writeJSON(rw, MsgAck, AckPayload{TransferID: t.ID, Offset: t.Offset})
			return
		}

		if msg.Type == MsgChunk {
			var chunk ChunkPayload
			if err := json.Unmarshal(msg.Payload, &chunk); err != nil {
				m.failTransfer(t.ID, "bad chunk payload")
				return
			}

			if _, err := file.Write(chunk.Data); err != nil {
				m.failTransfer(t.ID, "write failed")
				writeJSON(rw, MsgError, ErrorPayload{Message: "write failed"})
				return
			}
			
			hasher.Write(chunk.Data)
			
			newOffset := t.Offset + int64(len(chunk.Data))
			m.updateProgress(t.ID, newOffset)
			
			// Send Ack
			if err := writeJSON(rw, MsgAck, AckPayload{TransferID: t.ID, Offset: newOffset}); err != nil {
				m.failTransfer(t.ID, "send ack failed")
				return
			}
		}
	}
}

// State helpers

func (m *Manager) updateStatus(id string, status TransferStatus) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.transfers[id]; ok {
		t.Status = status
	}
	go m.saveState()
}

func (m *Manager) updateProgress(id string, offset int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.transfers[id]; ok {
		t.Offset = offset
	}
	go m.saveState()
}

func (m *Manager) failTransfer(id string, reason string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.transfers[id]; ok {
		t.Status = StatusFailed
		t.Error = reason
		t.EndTime = time.Now()
		log.Printf("[FileTransfer] Failed %s: %s", id, reason)
		if m.onFail != nil {
			val := *t
			go m.onFail(&val, reason)
		}
	}
	go m.saveState()
}

func (m *Manager) completeTransfer(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.transfers[id]; ok {
		t.Status = StatusCompleted
		t.EndTime = time.Now()
		log.Printf("[FileTransfer] Completed %s", id)
		if m.onComplete != nil {
			val := *t
			go m.onComplete(&val)
		}
	}
	go m.saveState()
}

// Protocol helpers

type rawMessage struct {
	Type    MessageType     `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type wireMessage struct {
	Type    MessageType `json:"type"`
	Payload interface{} `json:"payload"`
}

func writeJSON(rw *bufio.ReadWriter, typ MessageType, payload interface{}) error {
	msg := wireMessage{
		Type:    typ,
		Payload: payload,
	}
	bytes, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	if _, err := rw.Write(bytes); err != nil {
		return err
	}
	if _, err := rw.WriteString("\n"); err != nil {
		return err
	}
	return rw.Flush()
}

func readJSON(rw *bufio.ReadWriter) (*rawMessage, error) {
	line, err := rw.ReadBytes('\n')
	if err != nil {
		return nil, err
	}
	var msg rawMessage
	if err := json.Unmarshal(line, &msg); err != nil {
		return nil, err
	}
	return &msg, nil
}

// Controls
func (m *Manager) SetRateLimit(bps int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.config.RateLimitBps = bps
}

func (m *Manager) Cancel(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cancelled[id] = struct{}{}
}

func (m *Manager) SetPeerRateLimit(peerID string, bps int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if bps == 0 {
		delete(m.peerRate, peerID)
	} else {
		m.peerRate[peerID] = bps
	}
}

func (m *Manager) Pause(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.paused[id] = struct{}{}
}

func (m *Manager) Resume(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.paused, id)
}
