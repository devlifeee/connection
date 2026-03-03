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
}

type Manager struct {
	host      host.Host
	config    Config
	transfers map[string]*Transfer
	mu        sync.RWMutex
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

	return &Manager{
		host:      h,
		config:    cfg,
		transfers: make(map[string]*Transfer),
	}
}

func (m *Manager) Start() {
	m.host.SetStreamHandler(ProtocolID, m.handleStream)
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

	go m.processSend(context.Background(), t)

	return t, nil
}

func (m *Manager) processSend(ctx context.Context, t *Transfer) {
	m.updateStatus(t.ID, StatusSending)

	file, err := os.Open(t.LocalPath)
	if err != nil {
		m.failTransfer(t.ID, "failed to open file: "+err.Error())
		return
	}
	defer file.Close()

	// Calculate hash
	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		m.failTransfer(t.ID, "failed to hash file: "+err.Error())
		return
	}
	t.Metadata.Hash = hex.EncodeToString(hasher.Sum(nil))
	
	// Rewind
	if _, err := file.Seek(0, 0); err != nil {
		m.failTransfer(t.ID, "failed to rewind file: "+err.Error())
		return
	}

	// Connect
	pid, err := peer.Decode(t.PeerID)
	if err != nil {
		m.failTransfer(t.ID, "invalid peer id: "+err.Error())
		return
	}

	stream, err := m.host.NewStream(ctx, pid, ProtocolID)
	if err != nil {
		m.failTransfer(t.ID, "failed to connect: "+err.Error())
		return
	}
	defer stream.Close()

	rw := bufio.NewReadWriter(bufio.NewReader(stream), bufio.NewWriter(stream))

	// 1. Send Offer
	if err := writeJSON(rw, MsgOffer, OfferPayload{Metadata: t.Metadata}); err != nil {
		m.failTransfer(t.ID, "send offer failed: "+err.Error())
		return
	}

	// 2. Wait Accept
	msg, err := readJSON(rw)
	if err != nil {
		m.failTransfer(t.ID, "read accept failed: "+err.Error())
		return
	}

	if msg.Type == MsgReject {
		var p RejectPayload
		json.Unmarshal(msg.Payload, &p)
		m.failTransfer(t.ID, "rejected: "+p.Reason)
		return
	}
	
	if msg.Type != MsgAccept {
		m.failTransfer(t.ID, "unexpected response to offer: "+string(msg.Type))
		return
	}

	var accept AcceptPayload
	json.Unmarshal(msg.Payload, &accept)
	
	if accept.Offset > 0 {
		if _, err := file.Seek(accept.Offset, 0); err != nil {
			m.failTransfer(t.ID, "seek failed: "+err.Error())
			return
		}
		m.updateProgress(t.ID, accept.Offset)
	}

	// 3. Send Loop
	buf := make([]byte, ChunkSize)
	offset := accept.Offset

	for offset < t.TotalSize {
		n, err := file.Read(buf)
		if err != nil && err != io.EOF {
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
			m.failTransfer(t.ID, "send chunk failed: "+err.Error())
			return
		}

		// Wait Ack
		ackMsg, err := readJSON(rw)
		if err != nil {
			m.failTransfer(t.ID, "wait ack failed: "+err.Error())
			return
		}

		if ackMsg.Type != MsgAck {
			m.failTransfer(t.ID, "expected ack, got "+string(ackMsg.Type))
			return
		}

		offset += int64(n)
		m.updateProgress(t.ID, offset)
	}

	// 4. Send Complete
	if err := writeJSON(rw, MsgComplete, CompletePayload{TransferID: t.ID, Hash: t.Metadata.Hash}); err != nil {
		m.failTransfer(t.ID, "send complete failed: "+err.Error())
		return
	}

	m.completeTransfer(t.ID)
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

	// Ensure unique filename
	if _, err := os.Stat(t.LocalPath); err == nil {
		// File exists, append timestamp
		ext := filepath.Ext(t.LocalPath)
		name := t.Metadata.Name[:len(t.Metadata.Name)-len(ext)]
		t.LocalPath = filepath.Join(m.config.DownloadsDir, fmt.Sprintf("%s_%d%s", name, time.Now().Unix(), ext))
	}

	file, err := os.Create(t.LocalPath)
	if err != nil {
		writeJSON(rw, MsgReject, RejectPayload{TransferID: t.ID, Reason: "fs error"})
		return
	}
	defer file.Close()

	m.mu.Lock()
	m.transfers[t.ID] = t
	m.mu.Unlock()

	// 2. Send Accept
	if err := writeJSON(rw, MsgAccept, AcceptPayload{TransferID: t.ID, Offset: 0}); err != nil {
		m.failTransfer(t.ID, "send accept failed")
		return
	}

	// 3. Receive Loop
	hasher := sha256.New()
	
	for {
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
}

func (m *Manager) updateProgress(id string, offset int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.transfers[id]; ok {
		t.Offset = offset
	}
}

func (m *Manager) failTransfer(id string, reason string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.transfers[id]; ok {
		t.Status = StatusFailed
		t.Error = reason
		t.EndTime = time.Now()
		log.Printf("[FileTransfer] Failed %s: %s", id, reason)
	}
}

func (m *Manager) completeTransfer(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.transfers[id]; ok {
		t.Status = StatusCompleted
		t.EndTime = time.Now()
		log.Printf("[FileTransfer] Completed %s", id)
	}
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
