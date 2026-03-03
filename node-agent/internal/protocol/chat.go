package protocol

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"time"

	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/protocol"
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

type ChatHandler struct {
}

func (h *ChatHandler) ProtocolID(id string) protocol.ID {
	return protocol.ID(id)
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
		_ = line
	}
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
