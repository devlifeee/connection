package protocol

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"sync"
	"time"

	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	coreprotocol "github.com/libp2p/go-libp2p/core/protocol"
)

type Envelope struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	Timestamp int64           `json:"timestamp"`
	Sender    string          `json:"sender"`
	Payload   json.RawMessage `json:"payload"`
	Signature []byte          `json:"signature"`
}

type Signer struct {
	priv crypto.PrivKey
}

func NewSigner(priv crypto.PrivKey) *Signer {
	return &Signer{priv: priv}
}

func (s *Signer) Sign(e Envelope) (Envelope, error) {
	e.Signature = nil
	b, err := json.Marshal(e)
	if err != nil {
		return Envelope{}, err
	}
	sig, err := s.priv.Sign(b)
	if err != nil {
		return Envelope{}, err
	}
	e.Signature = sig
	return e, nil
}

func Verify(pub crypto.PubKey, e Envelope) (bool, error) {
	sig := e.Signature
	e.Signature = nil
	b, err := json.Marshal(e)
	if err != nil {
		return false, err
	}
	ok, err := pub.Verify(b, sig)
	if err != nil {
		return false, err
	}
	return ok, nil
}

// HistoryProvider exposes read-only access to stored chat envelopes.
type HistoryProvider interface {
	History(peerID string, limit int) []Envelope
}

type ChatHandler struct {
	host       host.Host
	mu         sync.RWMutex
	inbox      map[string][]Envelope
	maxPerPeer int
}

func NewChatHandler(h host.Host) *ChatHandler {
	return &ChatHandler{
		host:       h,
		inbox:      make(map[string][]Envelope),
		maxPerPeer: 100,
	}
}

func (h *ChatHandler) ProtocolID(id string) coreprotocol.ID {
	return coreprotocol.ID(id)
}

func (h *ChatHandler) HandleStream(stream network.Stream) {
	_ = stream.SetReadDeadline(time.Now().Add(60 * time.Second))
	defer stream.Close()

	r := bufio.NewReader(stream)
	for {
		line, err := r.ReadBytes('\n')
		if err != nil {
			if errors.Is(err, io.EOF) {
				return
			}
			return
		}

		var env Envelope
		if err := json.Unmarshal(line, &env); err != nil {
			// malformed message, ignore
			continue
		}

		// best-effort signature verification
		remote := stream.Conn().RemotePeer()
		pub := h.host.Peerstore().PubKey(remote)
		if pub != nil {
			ok, err := Verify(pub, env)
			if err != nil || !ok {
				continue
			}
		}

		h.append(remote.String(), env)
		log.Printf("chat: received message type=%s from=%s id=%s", env.Type, env.Sender, env.ID)
	}
}

func (h *ChatHandler) append(peerID string, env Envelope) {
	h.mu.Lock()
	defer h.mu.Unlock()

	list := h.inbox[peerID]
	list = append(list, env)
	if len(list) > h.maxPerPeer {
		list = list[len(list)-h.maxPerPeer:]
	}
	h.inbox[peerID] = list
}

func (h *ChatHandler) History(peerID string, limit int) []Envelope {
	h.mu.RLock()
	defer h.mu.RUnlock()

	list := h.inbox[peerID]
	if len(list) == 0 {
		return nil
	}
	if limit <= 0 || limit >= len(list) {
		out := make([]Envelope, len(list))
		copy(out, list)
		return out
	}
	out := make([]Envelope, limit)
	copy(out, list[len(list)-limit:])
	return out
}

func WriteEnvelope(ctx context.Context, w io.Writer, e Envelope) error {
	b, err := json.Marshal(e)
	if err != nil {
		return err
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	if _, err := w.Write(append(b, '\n')); err != nil {
		return err
	}
	return nil
}
