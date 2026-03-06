package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/gorilla/websocket"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	libp2pproto "github.com/libp2p/go-libp2p/core/protocol"
	"github.com/multiformats/go-multiaddr"
	"github.com/nhex-team/connection/node-agent/internal/presence"
	"github.com/nhex-team/connection/node-agent/internal/protocol"
	"github.com/nhex-team/connection/node-agent/internal/media"
	"github.com/nhex-team/connection/node-agent/internal/filetransfer"
	"os"
	"io"
	"strings"
)

type Server struct {
	http     *http.Server
	host     host.Host
	addr     string
	start    time.Time
	info     Info
	presence *presence.Store
	chat     *protocol.ChatStore
	sessions *Sessions
	media    *media.Manager
	files    *filetransfer.Manager
}

// Implement media.SignalHandler
func (s *Server) OnIncomingCall(call *media.Call, sdp string) {
	if s.sessions != nil {
		s.sessions.Broadcast(map[string]any{
			"type": "incoming_call",
			"call": call,
			"sdp":  sdp,
		})
	}
}

func (s *Server) OnCallAccepted(call *media.Call, sdp string) {
	if s.sessions != nil {
		s.sessions.Broadcast(map[string]any{
			"type": "call_accepted",
			"call": call,
			"sdp":  sdp,
		})
	}
}

func (s *Server) OnICECandidate(callID string, candidate media.ICECandidatePayload) {
	if s.sessions != nil {
		s.sessions.Broadcast(map[string]any{
			"type":      "ice_candidate",
			"call_id":   callID,
			"candidate": candidate,
		})
	}
}

func (s *Server) OnHangup(callID string) {
	if s.sessions != nil {
		s.sessions.Broadcast(map[string]any{
			"type":    "hangup",
			"call_id": callID,
		})
	}
}

type Info struct {
	DisplayName  string
	Version      string
	Capabilities []string
	Protocols    map[string]string
}

func NewServer(h host.Host, addr string, info Info, presenceStore *presence.Store, chatStore *protocol.ChatStore, mediaMgr *media.Manager, filesMgr *filetransfer.Manager) *Server {
	s := &Server{
		host:     h,
		addr:     addr,
		start:    time.Now(),
		info:     info,
		presence: presenceStore,
		chat:     chatStore,
		sessions: NewSessions(),
		media:    mediaMgr,
		files:    filesMgr,
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
	mux.HandleFunc("/chat/send", s.handleChatSend)
	mux.HandleFunc("/chat/history", s.handleChatHistory)
	mux.HandleFunc("/chat/read", s.handleChatRead)
	mux.HandleFunc("/session/create", s.handleSessionCreate)
	mux.HandleFunc("/session/ws", s.handleSessionWS)
	mux.HandleFunc("/sessions", s.handleSessions)
	mux.HandleFunc("/media/call", s.handleMediaCall)
	mux.HandleFunc("/media/answer", s.handleMediaAnswer)
	mux.HandleFunc("/media/candidate", s.handleMediaCandidate)
	mux.HandleFunc("/media/hangup", s.handleMediaHangup)
	mux.HandleFunc("/media/events", s.handleMediaEvents)
	mux.HandleFunc("/files/send", s.handleFilesSend)
	mux.HandleFunc("/files/transfers", s.handleFilesTransfers)
	mux.HandleFunc("/files/set_rate_limit", s.handleFilesSetRateLimit)
	mux.HandleFunc("/files/cancel", s.handleFilesCancel)
	mux.HandleFunc("/files/set_rate_limit_peer", s.handleFilesSetPeerRateLimit)
	mux.HandleFunc("/files/pause", s.handleFilesPause)
	mux.HandleFunc("/files/resume", s.handleFilesResume)
	mux.HandleFunc("/peer/addrs", s.handlePeerAddrs)

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

// media events endpoints and handlers
func (s *Server) handleMediaCall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		PeerID string `json:"peer_id"`
		SDP    string `json:"sdp"`
		Type   string `json:"type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.PeerID == "" || req.SDP == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "peer_id and sdp required"})
		return
	}
	callType := media.CallTypeAudio
	if req.Type == "video" {
		callType = media.CallTypeVideo
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	call, err := s.media.InitiateCall(ctx, req.PeerID, req.SDP, callType)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "call": call})
}

// files endpoints
func (s *Server) handleFilesSend(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if s.files == nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "file manager not available"})
		return
	}
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "multipart parse error"})
		return
	}
	peerID := r.FormValue("peer_id")
	file, header, err := r.FormFile("file")
	if err != nil || header == nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "file required"})
		return
	}
	defer file.Close()
	tmpdir := os.TempDir()
	tmpPath := tmpdir + string(os.PathSeparator) + header.Filename
	out, err := os.Create(tmpPath)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "fs error"})
		return
	}
	if _, err := io.Copy(out, file); err != nil {
		_ = out.Close()
		_ = os.Remove(tmpPath)
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "write error"})
		return
	}
	_ = out.Close()
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	t, err := s.files.SendFile(ctx, peerID, tmpPath)
	if err != nil {
		_ = os.Remove(tmpPath)
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "transfer": t})
}

func (s *Server) handleFilesTransfers(w http.ResponseWriter, r *http.Request) {
	if s.files == nil {
		_ = json.NewEncoder(w).Encode(map[string]any{"transfers": []any{}})
		return
	}
	list := s.files.ListTransfers()
	_ = json.NewEncoder(w).Encode(map[string]any{"transfers": list})
}

func (s *Server) handleFilesSetRateLimit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if s.files == nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "file manager not available"})
		return
	}
	var req struct{ Bps int64 `json:"bps"` }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Bps < 0 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "bad json"})
		return
	}
	s.files.SetRateLimit(req.Bps)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func (s *Server) handleFilesCancel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if s.files == nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "file manager not available"})
		return
	}
	var req struct{ ID string `json:"id"` }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.ID) == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "id required"})
		return
	}
	s.files.Cancel(req.ID)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func (s *Server) handleFilesSetPeerRateLimit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if s.files == nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "file manager not available"})
		return
	}
	var req struct {
		PeerID string `json:"peer_id"`
		Bps    int64  `json:"bps"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.PeerID) == "" || req.Bps < 0 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "peer_id and non-negative bps required"})
		return
	}
	s.files.SetPeerRateLimit(req.PeerID, req.Bps)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func (s *Server) handleFilesPause(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if s.files == nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "file manager not available"})
		return
	}
	var req struct{ ID string `json:"id"` }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.ID) == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "id required"})
		return
	}
	s.files.Pause(req.ID)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func (s *Server) handleFilesResume(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if s.files == nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "file manager not available"})
		return
	}
	var req struct{ ID string `json:"id"` }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.ID) == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "id required"})
		return
	}
	s.files.Resume(req.ID)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}
func (s *Server) handlePeerAddrs(w http.ResponseWriter, r *http.Request) {
	pidStr := r.URL.Query().Get("peer_id")
	if pidStr == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "peer_id required"})
		return
	}
	pid, err := peer.Decode(pidStr)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "bad peer_id"})
		return
	}
	addrs := s.host.Peerstore().Addrs(pid)
	withP2P := make([]string, 0, len(addrs))
	for _, a := range addrs {
		withP2P = append(withP2P, a.String()+"/p2p/"+pid.String())
	}
	var fpHex string
	if pk := s.host.Peerstore().PubKey(pid); pk != nil {
		if raw, err := pk.Raw(); err == nil {
			fp := sha256.Sum256(raw)
			fpHex = hex.EncodeToString(fp[:])
		}
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"peer_id":     pid.String(),
		"p2p_addrs":   withP2P,
		"fingerprint": fpHex,
	})
}

func (s *Server) handleMediaAnswer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		CallID string `json:"call_id"`
		SDP    string `json:"sdp"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.CallID == "" || req.SDP == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "call_id and sdp required"})
		return
	}
	if err := s.media.AcceptCall(req.CallID, req.SDP); err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func (s *Server) handleMediaCandidate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		CallID   string                      `json:"call_id"`
		Candidate media.ICECandidatePayload `json:"candidate"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.CallID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "call_id required"})
		return
	}
	if err := s.media.SendCandidate(req.CallID, req.Candidate); err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func (s *Server) handleMediaHangup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		CallID string `json:"call_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.CallID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "call_id required"})
		return
	}
	s.media.EndCall(req.CallID)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func (s *Server) handleMediaEvents(w http.ResponseWriter, r *http.Request) {
	_ = json.NewEncoder(w).Encode(map[string]any{
		"events": []any{}, // events приходят через WS; endpoint для совместимости
	})
}

func (s *Server) handleSessionCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		TerminalID  string `json:"terminal_id"`
		ProcessName string `json:"process_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "bad json"})
		return
	}
	if req.TerminalID == "" || req.ProcessName == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "terminal_id and process_name required"})
		return
	}
	sess := s.sessions.Create(req.TerminalID, req.ProcessName)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":           true,
		"session_id":   sess.ID,
		"terminal_id":  sess.TerminalID,
		"process_name": sess.ProcessName,
	})
}

func (s *Server) handleSessionWS(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("session_id")
	if id == "" {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("session_id required"))
		return
	}
	// ensure gorilla/websocket is linked
	_ = websocket.FormatCloseMessage(websocket.CloseNormalClosure, "ok")
	s.sessions.WS(w, r, id)
}

func (s *Server) handleSessions(w http.ResponseWriter, r *http.Request) {
	list := s.sessions.List()
	_ = json.NewEncoder(w).Encode(map[string]any{
		"sessions": list,
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

func (s *Server) handleChatSend(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		PeerID string `json:"peer_id"`
		Text   string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "bad json"})
		return
	}
	if req.PeerID == "" || req.Text == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "peer_id and text required"})
		return
	}
	p, err := peer.Decode(req.PeerID)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "bad peer_id"})
		return
	}
	chatID := s.info.Protocols["chat"]
	if chatID == "" {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "chat protocol not set"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	stream, err := s.host.NewStream(ctx, p, libp2pproto.ID(chatID))
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
		return
	}
	defer stream.Close()

	env := protocol.Envelope{
		ID:        strconv.FormatInt(time.Now().UnixNano(), 10),
		Type:      "chat",
		Timestamp: time.Now().UnixMilli(),
		Sender:    s.host.ID().String(),
		TTL:       8,
		Payload:   json.RawMessage([]byte(`{"text":` + strconv.Quote(req.Text) + `}`)),
	}
	if err := protocol.WriteEnvelope(ctx, stream, env); err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
		return
	}

	// Wait for ACK
	_ = stream.SetReadDeadline(time.Now().Add(2 * time.Second))
	var ack protocol.Envelope
	dec := json.NewDecoder(stream)
	if err := dec.Decode(&ack); err != nil {
		var ne *net.OpError
		if !errors.As(err, &ne) {
			// try buffered read line fallback
			// ignore and continue as best-effort
		}
	}
	if ack.Type == "ack" && ack.AckFor == env.ID {
		if s.chat != nil {
			s.chat.Add(req.PeerID, ack)
		}
	}
	if s.chat != nil {
		s.chat.Add(req.PeerID, env)
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func (s *Server) handleChatHistory(w http.ResponseWriter, r *http.Request) {
	peerID := r.URL.Query().Get("peer_id")
	limitStr := r.URL.Query().Get("limit")
	if peerID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "peer_id required"})
		return
	}
	limit := 50
	if limitStr != "" {
		if v, err := strconv.Atoi(limitStr); err == nil && v > 0 {
			limit = v
		}
	}
	list := []protocol.Envelope{}
	if s.chat != nil {
		list = s.chat.Messages(peerID, limit)
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"peer_id":  peerID,
		"messages": list,
		"read_up_to": func() string { if s.chat != nil { return s.chat.ReadUpTo(peerID) }; return "" }(),
	})
}

func (s *Server) handleChatRead(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		PeerID string `json:"peer_id"`
		LastID string `json:"last_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.PeerID == "" || req.LastID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "peer_id and last_id required"})
		return
	}
	if s.chat != nil {
		s.chat.MarkReadUpTo(req.PeerID, req.LastID)
	}
	if s.sessions != nil {
		s.sessions.Broadcast(map[string]any{
			"type":    "chat_read",
			"peer_id": req.PeerID,
			"last_id": req.LastID,
		})
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
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

// helper to broadcast from runtime without exposing sessions
func (s *Server) Broadcast(ev map[string]any) {
	if s.sessions != nil {
		s.sessions.Broadcast(ev)
	}
}
