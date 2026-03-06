package protocol

import (
	"testing"
	"time"
)

func TestChatStoreAckFlow(t *testing.T) {
	s := NewChatStore(10)
	peer := "peerA"
	msg := Envelope{
		ID:        "m1",
		Type:      "chat",
		Timestamp: time.Now().UnixMilli(),
		Sender:    peer,
		Payload:   []byte(`{"text":"hi"}`),
	}
	s.Add(peer, msg)
	if s.Acked(msg.ID) {
		t.Fatalf("message should not be acked yet")
	}
	ack := Envelope{
		ID:        "m1/ack",
		Type:      "ack",
		AckFor:    "m1",
		Timestamp: time.Now().UnixMilli(),
		Sender:    peer,
	}
	s.Add(peer, ack)
	if !s.Acked("m1") {
		t.Fatalf("message should be acked after ack added")
	}
	msgs := s.Messages(peer, 0)
	if len(msgs) != 2 {
		t.Fatalf("expected 2 messages stored, got %d", len(msgs))
	}
}
