package tests

import (
	"testing"
	"time"

	proto "github.com/nhex-team/connection/node-agent/internal/protocol"
)

func TestOutboxEnqueueDequeue(t *testing.T) {
	o := proto.NewOutbox()
	now := time.Now()
	o.Enqueue(&proto.OutboxItem{
		PeerID:      "p1",
		Envelope:    proto.Envelope{ID: "m1"},
		NextAttempt: now.Add(-time.Second).UnixMilli(),
		Attempts:    0,
		MaxRetries:  3,
		TTL:         2,
		CreatedMs:   now.UnixMilli(),
	})
	it := o.DequeueReady(time.Now())
	if it == nil {
		t.Fatalf("expected item ready")
	}
	if it.Envelope.ID != "m1" {
		t.Fatalf("wrong id")
	}
	if o.Size() != 0 {
		t.Fatalf("outbox should be empty after dequeue")
	}
}
