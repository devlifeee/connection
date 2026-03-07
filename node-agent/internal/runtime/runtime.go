package runtime

import (
	"context"
	"fmt"
	"path/filepath"
	"time"
	"os"

	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
	"encoding/json"
	libp2pproto "github.com/libp2p/go-libp2p/core/protocol"
	"net/http"
	"errors"
	"strings"
	"io"

	"github.com/nhex-team/connection/node-agent/internal/api"
	"github.com/nhex-team/connection/node-agent/internal/discovery"
	"github.com/nhex-team/connection/node-agent/internal/identity"
	"github.com/nhex-team/connection/node-agent/internal/media"
	"github.com/nhex-team/connection/node-agent/internal/presence"
	"github.com/nhex-team/connection/node-agent/internal/protocol"
	"github.com/nhex-team/connection/node-agent/internal/filetransfer"
	"github.com/nhex-team/connection/node-agent/internal/chatrelay"
	"github.com/nhex-team/connection/node-agent/internal/db"
	"crypto/sha256"
	"encoding/hex"
)

type Runtime struct {
	cfg         Config
	host        host.Host
	api         *api.Server
	mdns        *discovery.MDNSService
	notifee     *discovery.Notifee
	presence    *presence.Service
	presenceDB  *presence.Store
	cancelFn    context.CancelFunc
	httpClient  *http.Client
}

func Start(ctx context.Context, cfg Config) (*Runtime, error) {
	ctx, cancel := context.WithCancel(ctx)

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
	// Try connect to last peer if any
	if b, err := os.ReadFile(filepath.Join(cfg.DataDir, "last_peer.multiaddr")); err == nil {
		if ma, err2 := multiaddr.NewMultiaddr(string(b)); err2 == nil {
			if ai, err3 := peer.AddrInfoFromP2pAddr(ma); err3 == nil {
				cctx, ccancel := context.WithTimeout(ctx, 4*time.Second)
				_ = h.Connect(cctx, *ai)
				ccancel()
			}
		}
	}

	chatStore := protocol.NewChatStore(500)
	_ = chatStore.SetPersistence(filepath.Join(cfg.DataDir, "chat"))
	mediaMgr := media.NewManager(h)
	mediaMgr.Start()
	var relay *chatrelay.Relay
	if cfg.EnableRelay {
		relay, err = chatrelay.Start(ctx, h)
		if err != nil {
			_ = h.Close()
			cancel()
			return nil, err
		}
	}
	chatOutbox := protocol.NewOutbox()
	_ = chatOutbox.SetPersistence(filepath.Join(cfg.DataDir, "outbox"))
	fileMgr := filetransfer.NewManager(h, filetransfer.Config{
		DownloadsDir: filepath.Join(cfg.DataDir, "downloads"),
		MaxFileSize:  1 << 30,
		RateLimitBps: 2 << 20, // ~2MB/s default
	})
	fileMgr.Start()
	// Optional Postgres store
	var pg *db.Store
	if dsn := os.Getenv("NHEX_PG_DSN"); dsn != "" {
		store, err := db.NewStore(ctx, dsn)
		if err == nil {
			pg = store
			_ = pg.Migrate(ctx, filepath.Join("internal", "db", "migrations"))
			fileMgr.SetOnComplete(func(t *filetransfer.Transfer) {
				if t == nil || t.Role != "receiver" {
					return
				}
				mt := strings.ToLower(t.Metadata.MimeType)
				if !(strings.HasPrefix(mt, "image/") || strings.HasPrefix(mt, "audio/")) {
					return
				}
				f, err := os.Open(t.LocalPath)
				if err != nil {
					return
				}
				defer f.Close()
				b, err := io.ReadAll(f)
				if err != nil {
					return
				}
				sum := sha256.Sum256(b)
				fileHash := hex.EncodeToString(sum[:])
				if _, err := pg.Pool().Exec(ctx,
					"INSERT INTO media_blobs (id, peer_id, transfer_id, role, mime_type, size, bytes, file_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING",
					t.ID, t.PeerID, t.ID, t.Role, t.Metadata.MimeType, t.TotalSize, b, fileHash,
				); err != nil {
					return
				}
			})
		}
	}
	chat := &protocol.ChatHandler{}
	h.SetStreamHandler(chat.ProtocolID(cfg.ProtocolChat), chat.HandleStream)

	n := discovery.NewNotifee(ctx, 64)
	md, err := discovery.StartMDNS(h, cfg.ServiceName, n)
	if err != nil {
		_ = h.Close()
		cancel()
		return nil, err
	}

    // Load profile first to initialize presence store correctly
	profilePath := filepath.Join(cfg.DataDir, "profile.json")
    displayName := cfg.DisplayName
	if b, err := os.ReadFile(profilePath); err == nil {
		type profile struct{ DisplayName string `json:"display_name"` }
		var pr profile
		if json.Unmarshal(b, &pr) == nil && pr.DisplayName != "" {
			displayName = pr.DisplayName
		}
	}

	pdb := presence.NewStore(presence.Self{
		DisplayName:  displayName,
		Version:      cfg.Version,
		Capabilities: cfg.Capabilities,
	}, cfg.DataDir)
	ps, err := presence.Start(ctx, h, pdb, cfg.ProtocolPresence, cfg.PresenceInterval)
	if err != nil {
		_ = md.Close()
		_ = h.Close()
		cancel()
		return nil, err
	}

	srv := api.NewServer(h, cfg.HTTPAddr, api.Info{
		DisplayName:  displayName,
		Version:      cfg.Version,
		Capabilities: cfg.Capabilities,
		Protocols: map[string]string{
			"chat":         cfg.ProtocolChat,
			"file":         cfg.ProtocolFile,
			"media_signal": cfg.ProtocolMediaSign,
			"presence":     cfg.ProtocolPresence,
		},
	}, pdb, chatStore, mediaMgr, fileMgr)
	srv.SetProfilePath(profilePath)
	if pg != nil {
		srv.SetDB(pg)
	}
	srv.SetRelay(relay)
	srv.SetSigner(protocol.NewSigner(priv))
	srv.SetOutbox(chatOutbox)
	mediaMgr.SetHandler(srv)
	// trust-only filter for incoming files if enabled
	fileMgr.SetAcceptFilter(func(peerID string, meta filetransfer.Metadata) bool {
		if srv == nil {
			return true
		}
		if !srv.IsTrusted(peerID) && srv != nil && srv.TrustOnlyFiles() {
			return false
		}
		return true
	})
	// trust-only filter for incoming media offers if enabled
	mediaMgr.SetAcceptOfferFilter(func(peerID string, ctype media.CallType) bool {
		if srv == nil {
			return true
		}
		if !srv.TrustOnlyMedia() {
			return true
		}
		return srv.IsTrusted(peerID)
	})
	if relay != nil {
		relay.OnTo = func(env chatrelay.Envelope) {
			// drop if blocked by server
			if srv != nil && srv.IsBlocked(env.From) {
				return
			}
			var payload json.RawMessage = env.Payload
			e := protocol.Envelope{
				ID:        env.ID,
				Type:      "chat",
				Timestamp: env.Timestamp,
				Sender:    env.From,
				TTL:       env.TTL,
				Payload:   payload,
			}
			chatStore.Add(env.From, e)
			if srv != nil {
				srv.Broadcast(map[string]any{
					"type": "chat_message",
					"env":  e,
					"via":  "relay",
					"path": env.Path,
				})
			}
		}
	}
	chat.OnMsg = func(e protocol.Envelope) {
		// drop incoming direct chat if blocked
		if srv != nil && srv.IsBlocked(e.Sender) {
			return
		}
		srv.IncChatRecv()
		chatStore.Add(e.Sender, e)
		if srv != nil {
			srv.Broadcast(map[string]any{
				"type": "chat_message",
				"env":  e,
			})
		}
	}
	chat.OnAck = func(e protocol.Envelope) {
		chatStore.Add(e.Sender, e)
		if srv != nil {
			srv.Broadcast(map[string]any{
				"type": "chat_ack",
				"env":  e,
			})
		}
	}
	// Background outbox flush loop
	go func() {
		t := time.NewTicker(1200 * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				it := chatOutbox.DequeueReady(time.Now())
				if it == nil {
					continue
				}
				// try direct stream
				pid, err := peer.Decode(it.PeerID)
				if err == nil {
					cctx, cancel := context.WithTimeout(ctx, 2*time.Second)
					stream, err2 := h.NewStream(cctx, pid, libp2pproto.ID(cfg.ProtocolChat))
					cancel()
					if err2 == nil {
						if errw := protocol.WriteEnvelope(context.Background(), stream, it.Envelope); errw == nil {
							_ = stream.Close()
							if srv != nil {
								srv.IncOutboxSuccess()
							}
							continue
						}
						_ = stream.Close()
					}
				}
				// fallback relay
				var errPub error
				if relay != nil {
					errPub = relay.Publish(ctx, chatrelay.Envelope{
						ID:        it.Envelope.ID,
						From:      h.ID().String(),
						To:        it.PeerID,
						Timestamp: time.Now().UnixMilli(),
						TTL:       it.TTL - 1,
						Payload:   it.Envelope.Payload,
					})
				} else {
					errPub = errors.New("no relay")
				}
				// if relay publish failed, requeue with backoff
				if errPub != nil && it.Attempts < it.MaxRetries && it.TTL > 0 {
					it.Attempts++
					base := 800
					if srv != nil {
						base = srv.OutboxBackoffBaseMs()
					}
					backoffMs := base * (1 << (it.Attempts - 1))
					it.NextAttempt = time.Now().Add(time.Duration(backoffMs) * time.Millisecond).UnixMilli()
					chatOutbox.Enqueue(it)
					if srv != nil {
						srv.IncOutboxRetry()
					}
				} else if errPub == nil && srv != nil {
					srv.IncOutboxSuccess()
				}
			}
		}
	}()
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
		httpClient: &http.Client{Timeout: 2 * time.Second},
	}

	go rt.connectLoop(ctx)
	go rt.bootstrapLoop(ctx)

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

func (r *Runtime) bootstrapLoop(ctx context.Context) {
	if len(r.cfg.BootstrapHTTP) == 0 {
		return
	}
	t := time.NewTicker(1500 * time.Millisecond)
	defer t.Stop()
	type addrsResp struct {
		P2PAddrs []string `json:"p2p_addrs"`
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			// if already connected to at least one, skip
			if len(r.host.Network().Peers()) > 0 {
				continue
			}
			for _, base := range r.cfg.BootstrapHTTP {
				url := base
				if url == "" {
					continue
				}
				if url[len(url)-1] == '/' {
					url = url[:len(url)-1]
				}
				resp, err := r.httpClient.Get(url + "/addrs")
				if err != nil {
					continue
				}
				var ar addrsResp
				_ = json.NewDecoder(resp.Body).Decode(&ar)
				_ = resp.Body.Close()
				if len(ar.P2PAddrs) == 0 {
					continue
				}
				addr := ar.P2PAddrs[0]
				ma, err := multiaddr.NewMultiaddr(addr)
				if err != nil {
					continue
				}
				ai, err := peer.AddrInfoFromP2pAddr(ma)
				if err != nil {
					continue
				}
				cctx, cancel := context.WithTimeout(ctx, 4*time.Second)
				if _ = r.host.Connect(cctx, *ai); true {
					_ = os.WriteFile(filepath.Join(r.cfg.DataDir, "last_peer.multiaddr"), []byte(addr), 0o644)
				}
				cancel()
			}
		}
	}
}
