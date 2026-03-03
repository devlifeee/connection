package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"time"

	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
	"github.com/nhex-team/connection/node-agent/internal/presence"
)

type Server struct {
	http     *http.Server
	host     host.Host
	addr     string
	start    time.Time
	info     Info
	presence *presence.Store
}

type Info struct {
	DisplayName  string
	Version      string
	Capabilities []string
	Protocols    map[string]string
}

func NewServer(h host.Host, addr string, info Info, presenceStore *presence.Store) *Server {
	s := &Server{
		host:     h,
		addr:     addr,
		start:    time.Now(),
		info:     info,
		presence: presenceStore,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/identity", s.handleIdentity)
	mux.HandleFunc("/addrs", s.handleAddrs)
	mux.HandleFunc("/connect", s.handleConnect)
	mux.HandleFunc("/peers", s.handlePeers)
	mux.HandleFunc("/presence", s.handlePresence)
	mux.HandleFunc("/presence/peers", s.handlePresencePeers)
	mux.HandleFunc("/protocols", s.handleProtocols)

	s.http = &http.Server{
		Addr:              addr,
		Handler:           cors(mux),
		ReadHeaderTimeout: 5 * time.Second,
	}
	return s
}

func (s *Server) Start() error {
	ln, err := net.Listen("tcp", s.addr)
	if err != nil {
		return err
	}
	go func() {
		_ = s.http.Serve(ln)
	}()
	return nil
}

func (s *Server) Close(ctx context.Context) error {
	return s.http.Shutdown(ctx)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":     true,
		"uptime": time.Since(s.start).String(),
	})
}

func (s *Server) handleIdentity(w http.ResponseWriter, r *http.Request) {
	addrs := make([]string, 0, len(s.host.Addrs()))
	for _, a := range s.host.Addrs() {
		addrs = append(addrs, a.String())
	}
	pub := s.host.Peerstore().PubKey(s.host.ID())
	var fpHex string
	if pub != nil {
		pkb, err := pub.Raw()
		if err == nil {
			fp := sha256.Sum256(pkb)
			fpHex = hex.EncodeToString(fp[:])
		}
	}

	_ = json.NewEncoder(w).Encode(map[string]any{
		"peer_id":     s.host.ID().String(),
		"fingerprint": fpHex,
		"addrs":       addrs,
	})
}

func (s *Server) handleAddrs(w http.ResponseWriter, r *http.Request) {
	peerID := s.host.ID().String()
	withP2P := make([]string, 0, len(s.host.Addrs()))
	for _, a := range s.host.Addrs() {
		withP2P = append(withP2P, a.String()+"/p2p/"+peerID)
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"peer_id":    peerID,
		"p2p_addrs":  withP2P,
		"raw_addrs":  func() []string { out := make([]string, 0, len(s.host.Addrs())); for _, a := range s.host.Addrs() { out = append(out, a.String()) }; return out }(),
	})
}

func (s *Server) handleConnect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Addr string `json:"addr"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "bad json"})
		return
	}
	if req.Addr == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "addr required"})
		return
	}

	ma, err := multiaddr.NewMultiaddr(req.Addr)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "invalid multiaddr"})
		return
	}
	ai, err := peer.AddrInfoFromP2pAddr(ma)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "addr must include /p2p/<peerid>"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if err := s.host.Connect(ctx, *ai); err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func (s *Server) handlePeers(w http.ResponseWriter, r *http.Request) {
	peers := s.host.Network().Peers()
	out := make([]map[string]any, 0, len(peers))
	for _, p := range peers {
		out = append(out, map[string]any{
			"peer_id": p.String(),
		})
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"peers": out,
	})
}

func (s *Server) handlePresence(w http.ResponseWriter, r *http.Request) {
	self := s.info
	if s.presence != nil {
		p := s.presence.Self()
		self.DisplayName = p.DisplayName
		self.Version = p.Version
		self.Capabilities = p.Capabilities
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"peer_id":      s.host.ID().String(),
		"display_name": self.DisplayName,
		"capabilities": self.Capabilities,
		"version":      self.Version,
		"uptime_sec":   int64(time.Since(s.start).Seconds()),
	})
}

func (s *Server) handlePresencePeers(w http.ResponseWriter, r *http.Request) {
	var peers []presence.PeerPresence
	if s.presence != nil {
		peers = s.presence.Snapshot()
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"peers": peers,
	})
}

func (s *Server) handleProtocols(w http.ResponseWriter, r *http.Request) {
	_ = json.NewEncoder(w).Encode(map[string]any{
		"protocols": s.info.Protocols,
	})
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method == http.MethodPost && r.Header.Get("Content-Type") == "" {
			w.Header().Set("Content-Type", "application/json")
		}
		next.ServeHTTP(w, r)
	})
}
