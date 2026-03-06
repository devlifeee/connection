package tests

import (
	"testing"
	"time"
	proto "github.com/nhex-team/connection/node-agent/internal/protocol"
)

func TestOutboxDequeueTTLAndRetries(t *testing.T) {
	o := proto.NewOutbox()
	now := time.Now()
	// TTL=0 should never be dequeued
	o.Enqueue(&proto.OutboxItem{
		PeerID:      "p",
		Envelope:    proto.Envelope{ID: "m1"},
		NextAttempt: now.Add(-time.Second).UnixMilli(),
		Attempts:    0,
		MaxRetries:  3,
		TTL:         0,
	})
	// Exceeded retries should not be dequeued
	o.Enqueue(&proto.OutboxItem{
		PeerID:      "p",
		Envelope:    proto.Envelope{ID: "m2"},
		NextAttempt: now.Add(-time.Second).UnixMilli(),
		Attempts:    4,
		MaxRetries:  3,
		TTL:         2,
	})
	// Valid item should dequeue
	o.Enqueue(&proto.OutboxItem{
		PeerID:      "p",
		Envelope:    proto.Envelope{ID: "m3"},
		NextAttempt: now.Add(-time.Second).UnixMilli(),
		Attempts:    0,
		MaxRetries:  3,
		TTL:         2,
	})
	if it := o.DequeueReady(time.Now()); it == nil || it.Envelope.ID != "m3" {
		t.Fatalf("expected to dequeue m3")
	}
	// Remaining items should not dequeue
	if it := o.DequeueReady(time.Now()); it != nil {
		t.Fatalf("expected no item, got %v", it.Envelope.ID)
	}
}
