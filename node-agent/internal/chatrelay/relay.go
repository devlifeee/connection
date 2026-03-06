package chatrelay

import (
	"context"
	"encoding/json"
	"time"

	pubsub "github.com/libp2p/go-libp2p-pubsub"
	"github.com/libp2p/go-libp2p/core/host"
)

const TopicID = "nhex/chat-relay/1.0.0"

type Envelope struct {
	ID        string          `json:"id"`
	From      string          `json:"from"`
	To        string          `json:"to"`
	Timestamp int64           `json:"ts"`
	TTL       int             `json:"ttl"`
	Payload   json.RawMessage `json:"payload"`
	Path      []string        `json:"path,omitempty"`
}

type Relay struct {
	h    host.Host
	ps   *pubsub.PubSub
	t    *pubsub.Topic
	sub  *pubsub.Subscription
	OnTo func(env Envelope) // Called when message destined to self arrives
	// limiter by sender
	limits map[string]*bucket
	seen   map[string]struct{}
}

func Start(ctx context.Context, h host.Host) (*Relay, error) {
	ps, err := pubsub.NewGossipSub(ctx, h)
	if err != nil {
		return nil, err
	}
	t, err := ps.Join(TopicID)
	if err != nil {
		return nil, err
	}
	sub, err := t.Subscribe()
	if err != nil {
		return nil, err
	}
	r := &Relay{h: h, ps: ps, t: t, sub: sub}
	go r.loop(ctx)
	return r, nil
}

func (r *Relay) loop(ctx context.Context) {
	for {
		msg, err := r.sub.Next(ctx)
		if err != nil {
			return
		}
		if msg.ReceivedFrom == r.h.ID() {
			continue
		}
		var env Envelope
		if json.Unmarshal(msg.Data, &env) != nil {
			continue
		}
		if env.TTL <= 0 {
			continue
		}
		if r.seen == nil {
			r.seen = make(map[string]struct{}, 2048)
		}
		if _, ok := r.seen[env.ID]; ok {
			continue
		}
		r.seen[env.ID] = struct{}{}
		if len(r.seen) > 16384 {
			r.seen = make(map[string]struct{}, 2048)
		}
		// basic anti-spam limiter: 1 msg/sec burst 5
		if r.limits == nil {
			r.limits = make(map[string]*bucket)
		}
		b := r.limits[env.From]
		if b == nil {
			b = &bucket{cap: 5, tokens: 5, refill: 1}
			r.limits[env.From] = b
		}
		if !b.allow(1) {
			continue
		}
		// Append self to path
		self := r.h.ID().String()
		for _, hop := range env.Path {
			if hop == self {
				continue
			}
		}
		env.Path = append(env.Path, self)

		if env.To == self {
			if r.OnTo != nil {
				r.OnTo(env)
			}
			continue
		}
		// Forward with decremented TTL
		env.TTL -= 1
		env.Timestamp = time.Now().UnixMilli()
		_ = r.Publish(ctx, env)
	}
}

func (r *Relay) Publish(ctx context.Context, env Envelope) error {
	b, err := json.Marshal(env)
	if err != nil {
		return err
	}
	return r.t.Publish(ctx, b)
}

type bucket struct {
	cap     float64
	tokens  float64
	refill  float64
	lastRef time.Time
}

func (b *bucket) allow(n float64) bool {
	now := time.Now()
	if b.lastRef.IsZero() {
		b.lastRef = now
	}
	dt := now.Sub(b.lastRef).Seconds()
	b.tokens = min(b.cap, b.tokens+dt*b.refill)
	b.lastRef = now
	if b.tokens >= n {
		b.tokens -= n
		return true
	}
	return false
}

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
