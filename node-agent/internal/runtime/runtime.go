package runtime

import (
	"context"
	"fmt"
	"path/filepath"
	"time"

	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"

	"github.com/nhex-team/connection/node-agent/internal/api"
	"github.com/nhex-team/connection/node-agent/internal/db"
	"github.com/nhex-team/connection/node-agent/internal/discovery"
	"github.com/nhex-team/connection/node-agent/internal/filetransfer"
	"github.com/nhex-team/connection/node-agent/internal/identity"
	"github.com/nhex-team/connection/node-agent/internal/media"
	"github.com/nhex-team/connection/node-agent/internal/presence"
	"github.com/nhex-team/connection/node-agent/internal/protocol"
)

type Runtime struct {
	cfg         Config
	host        host.Host
	api         *api.Server
	mdns        *discovery.MDNSService
	notifee     *discovery.Notifee
	presence    *presence.Service
	presenceDB  *presence.Store
	files       *filetransfer.Manager
	media       *media.Manager
	db          *db.Store
	cancelFn    context.CancelFunc
}

func Start(ctx context.Context, cfg Config) (*Runtime, error) {
	ctx, cancel := context.WithCancel(ctx)

	// DB Connection (Optional for now)
	var database *db.Store
	if cfg.DatabaseURL != "" {
		var err error
		database, err = db.NewStore(ctx, cfg.DatabaseURL)
		if err != nil {
			cancel()
			return nil, fmt.Errorf("failed to connect to db: %w", err)
		}
		// Auto-migrate
		// Assuming migrations are in "./internal/db/migrations" relative to binary or we embed them.
		// For simplicity, let's skip auto-migration or assume path exists.
		// In dev:
		_ = database.Migrate(ctx, "internal/db/migrations")
	}

	keyPath := filepath.Join(cfg.DataDir, "identity.key")
	priv, err := identity.LoadOrCreatePrivateKey(keyPath)
	if err != nil {
		cancel()
		return nil, err
	}

	listen, err := multiaddr.NewMultiaddr(fmt.Sprintf("/ip4/0.0.0.0/tcp/%d", cfg.ListenPort))
	if err != nil {
		cancel()
		return nil, err
	}

	h, err := libp2p.New(
		libp2p.Identity(priv),
		libp2p.ListenAddrs(listen),
	)
	if err != nil {
		cancel()
		return nil, err
	}

	chat := protocol.NewChatHandler(h)
	h.SetStreamHandler(chat.ProtocolID(cfg.ProtocolChat), chat.HandleStream)

	files := filetransfer.NewManager(h, filetransfer.Config{
		DownloadsDir: filepath.Join(cfg.DataDir, "downloads"),
	})
	files.Start()
	
	mediaMgr := media.NewManager(h)
	mediaMgr.Start()

	n := discovery.NewNotifee(ctx, 64)
	md, err := discovery.StartMDNS(h, cfg.ServiceName, n)
	if err != nil {
		_ = h.Close()
		cancel()
		return nil, err
	}

	pdb := presence.NewStore(presence.Self{
		DisplayName:  cfg.DisplayName,
		Version:      cfg.Version,
		Capabilities: cfg.Capabilities,
	})
	ps, err := presence.Start(ctx, h, pdb, cfg.ProtocolPresence, cfg.PresenceInterval)
	if err != nil {
		_ = md.Close()
		_ = h.Close()
		cancel()
		return nil, err
	}

	srv := api.NewServer(h, cfg.HTTPAddr, api.Info{
		DisplayName:  cfg.DisplayName,
		Version:      cfg.Version,
		Capabilities: cfg.Capabilities,
		Protocols: map[string]string{
			"chat":         cfg.ProtocolChat,
			"file":         cfg.ProtocolFile,
			"media_signal": cfg.ProtocolMediaSign,
			"presence":     cfg.ProtocolPresence,
		},
	}, pdb, files, mediaMgr, cfg.ProtocolChat, protocol.NewSigner(priv), chat)
	if err := srv.Start(); err != nil {
		_ = ps.Close()
		_ = md.Close()
		_ = h.Close()
		cancel()
		return nil, err
	}

	rt := &Runtime{
		cfg:        cfg,
		host:       h,
		api:        srv,
		mdns:       md,
		notifee:    n,
		presence:   ps,
		presenceDB: pdb,
		cancelFn:   cancel,
	}

	go rt.connectLoop(ctx)

	return rt, nil
}

func (r *Runtime) Host() host.Host {
	return r.host
}

func (r *Runtime) Close(ctx context.Context) error {
	r.cancelFn()
	if r.api != nil {
		_ = r.api.Close(ctx)
	}
	if r.presence != nil {
		_ = r.presence.Close()
	}
	if r.mdns != nil {
		_ = r.mdns.Close()
	}
	if r.host != nil {
		_ = r.host.Close()
	}
	return nil
}

func (r *Runtime) connectLoop(ctx context.Context) {
	for {
		select {
		case ev := <-r.notifee.Events():
			r.tryConnect(ctx, ev.Peer)
		case <-ctx.Done():
			return
		}
	}
}

func (r *Runtime) tryConnect(ctx context.Context, pi peer.AddrInfo) {
	if pi.ID == "" || pi.ID == r.host.ID() {
		return
	}
	if r.host.Network().Connectedness(pi.ID) == network.Connected {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	_ = r.host.Connect(ctx, pi)
}
