package presence

import (
	"context"
	"encoding/json"
	"time"

	pubsub "github.com/libp2p/go-libp2p-pubsub"
	"github.com/libp2p/go-libp2p/core/host"
)

type Service struct {
	host  host.Host
	store *Store
	topic *pubsub.Topic
	sub   *pubsub.Subscription
}

func Start(ctx context.Context, h host.Host, store *Store, topicName string, interval time.Duration) (*Service, error) {
	ps, err := pubsub.NewGossipSub(ctx, h)
	if err != nil {
		return nil, err
	}
	topic, err := ps.Join(topicName)
	if err != nil {
		return nil, err
	}
	sub, err := topic.Subscribe()
	if err != nil {
		_ = topic.Close()
		return nil, err
	}

	s := &Service{
		host:  h,
		store: store,
		topic: topic,
		sub:   sub,
	}

	go s.runLoops(ctx, interval)

	return s, nil
}

func (s *Service) Close() error {
	if s == nil {
		return nil
	}
	if s.sub != nil {
		s.sub.Cancel()
	}
	if s.topic != nil {
		return s.topic.Close()
	}
	return nil
}

func (s *Service) runLoops(ctx context.Context, interval time.Duration) {
    // Start receive loop
    go func() {
        for {
            msg, err := s.sub.Next(ctx)
            if err != nil {
                return
            }
            if msg.ReceivedFrom == s.host.ID() {
                continue
            }
            var p Payload
            if err := json.Unmarshal(msg.Data, &p); err != nil {
                continue
            }
            if p.PeerID == "" {
                continue
            }
            s.store.Upsert(p)
        }
    }()

    // Start publish loop
	t := time.NewTicker(interval)
	defer t.Stop()

    // Publish immediately on start
    s.publish(ctx)

	for {
		select {
		case <-t.C:
            s.publish(ctx)
		case <-ctx.Done():
			return
		}
	}
}

func (s *Service) publish(ctx context.Context) {
    self := s.store.Self()
    p := Payload{
        PeerID:       s.host.ID().String(),
        DisplayName:  self.DisplayName,
        Capabilities: self.Capabilities,
        Version:      self.Version,
        UptimeSec:    int64(time.Since(time.Now()).Seconds()), // This should be fixed to use start time
        TimestampMs:  time.Now().UnixMilli(),
    }
    b, err := json.Marshal(p)
    if err == nil {
        _ = s.topic.Publish(ctx, b)
    }
}

