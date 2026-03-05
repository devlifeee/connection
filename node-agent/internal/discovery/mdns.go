package discovery

import (
	"context"

	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/p2p/discovery/mdns"
)

type PeerEvent struct {
	Peer peer.AddrInfo
}

type Notifee struct {
	ctx context.Context
	ch  chan PeerEvent
}

func NewNotifee(ctx context.Context, buffer int) *Notifee {
	return &Notifee{
		ctx: ctx,
		ch:  make(chan PeerEvent, buffer),
	}
}

func (n *Notifee) HandlePeerFound(pi peer.AddrInfo) {
	select {
	case n.ch <- PeerEvent{Peer: pi}:
	case <-n.ctx.Done():
	default:
	}
}

func (n *Notifee) Events() <-chan PeerEvent {
	return n.ch
}

type MDNSService struct {
	s mdns.Service
}

func StartMDNS(h host.Host, serviceName string, n mdns.Notifee) (*MDNSService, error) {
	s := mdns.NewMdnsService(h, serviceName, n)
	if err := s.Start(); err != nil {
		return nil, err
	}
	return &MDNSService{s: s}, nil
}

func (m *MDNSService) Close() error {
	if m == nil || m.s == nil {
		return nil
	}
	return m.s.Close()
}
