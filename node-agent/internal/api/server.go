package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"log"

	"github.com/gorilla/websocket"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	coreprotocol "github.com/libp2p/go-libp2p/core/protocol"
	"github.com/multiformats/go-multiaddr"
	"github.com/nhex-team/connection/node-agent/internal/filetransfer"
	"sync"
	"github.com/nhex-team/connection/node-agent/internal/media"
	"github.com/nhex-team/connection/node-agent/internal/presence"
	chatproto "github.com/nhex-team/connection/node-agent/internal/protocol"
	"github.com/google/uuid"
)

type Session struct {
	ID          string
	TerminalID  string
	ProcessName string
	ConnectedAt time.Time
	LastSeen    time.Time
	WebSocket   *websocket.Conn
	EventQueue  []interface{}
	mu          sync.RWMutex
}

type Server struct {
	http     *http.Server
	host     host.Host
	addr     string
	start    time.Time
	info     Info
	presence *presence.Store
	files    *filetransfer.Manager
	media    *media.Manager
	chatID   string
	signer   *chatproto.Signer
	history  chatproto.HistoryProvider
	
	// Session management
	mu          sync.RWMutex
	sessions    map[string]*Session
	upgrader    websocket.Upgrader
	
	// Events buffer for polling (legacy)
	mediaEvents []interface{}
}

type Info struct {
	DisplayName  string
	Version      string
	Capabilities []string
	Protocols    map[string]string
}

func NewServer(h host.Host, addr string, info Info, presenceStore *presence.Store, files *filetransfer.Manager, mediaMgr *media.Manager, chatProtocolID string, signer *chatproto.Signer, history chatproto.HistoryProvider) *Server {
	s := &Server{
		host:     h,
		addr:     addr,
		start:    time.Now(),
		info:     info,
		presence: presenceStore,
		files:    files,
		media:    mediaMgr,
		chatID:   chatProtocolID,
		signer:   signer,
		history:  history,
		sessions: make(map[string]*Session),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins for development
			},
		},
		mediaEvents: make([]interface{}, 0),
	}
	
	if s.media != nil {
		s.media.SetHandler(s)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/identity", s.handleIdentity)
	mux.HandleFunc("/addrs", s.handleAddrs)
	mux.HandleFunc("/connect", s.handleConnect)
	mux.HandleFunc("/peers", s.handlePeers)
	mux.HandleFunc("/presence", s.handlePresence)
	mux.HandleFunc("/presence/peers", s.handlePresencePeers)
	mux.HandleFunc("/chat/send", s.handleChatSend)
	mux.HandleFunc("/chat/history", s.handleChatHistory)
	mux.HandleFunc("/protocols", s.handleProtocols)
	mux.HandleFunc("/files/send", s.handleFileSend)
	mux.HandleFunc("/files/transfers", s.handleFileTransfers)
	
	// Media API
	mux.HandleFunc("/media/call", s.handleMediaCall) // POST (initiate)
	mux.HandleFunc("/media/answer", s.handleMediaAnswer) // POST (accept)
	mux.HandleFunc("/media/candidate", s.handleMediaCandidate) // POST (ice)
	mux.HandleFunc("/media/hangup", s.handleMediaHangup) // POST (end)
	mux.HandleFunc("/media/events", s.handleMediaEvents) // GET (poll)

	// Session management
	mux.HandleFunc("/session/create", s.handleSessionCreate) // POST
	mux.HandleFunc("/session/ws", s.handleWebSocket) // WebSocket upgrade
	mux.HandleFunc("/sessions", s.handleSessions) // GET

	s.http = &http.Server{
		Addr:              addr,
		Handler:           cors(mux),
		ReadHeaderTimeout: 5 * time.Second,
	}
	
	// Start session cleanup goroutine
	go s.sessionCleanup()
	
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
	req.Text = strings.TrimSpace(req.Text)
	if req.PeerID == "" || req.Text == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "peer_id and text required"})
		return
	}

	pid, err := peer.Decode(req.PeerID)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "invalid peer_id"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	stream, err := s.host.NewStream(ctx, pid, coreprotocol.ID(s.chatID))
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
		return
	}
	defer stream.Close()

	payload, err := json.Marshal(map[string]string{
		"text": req.Text,
	})
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "encode payload failed"})
		return
	}

	env := chatproto.Envelope{
		ID:        fmt.Sprintf("%d", time.Now().UnixNano()),
		Type:      "text",
		Timestamp: time.Now().UnixMilli(),
		Sender:    s.host.ID().String(),
		Payload:   payload,
	}
	if s.signer != nil {
		if signed, err := s.signer.Sign(env); err == nil {
			env = signed
		}
	}

	if err := chatproto.WriteEnvelope(ctx, stream, env); err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func (s *Server) handleChatHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	peerID := strings.TrimSpace(r.URL.Query().Get("peer_id"))
	if peerID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": "peer_id required"})
		return
	}
	limitStr := r.URL.Query().Get("limit")
	limit := 50
	if limitStr != "" {
		if v, err := strconv.Atoi(limitStr); err == nil && v > 0 {
			limit = v
		}
	}

	var msgs []chatproto.Envelope
	if s.history != nil {
		msgs = s.history.History(peerID, limit)
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"peer_id":  peerID,
		"messages": msgs,
	})
}

func (s *Server) handleFileSend(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	// 32MB max memory for multipart
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": "bad multipart: " + err.Error()})
		return
	}

	peerID := r.FormValue("peer_id")
	if peerID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": "peer_id required"})
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": "file required"})
		return
	}
	defer file.Close()

	if s.files == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	// Prepare uploads directory
	uploadsDir := filepath.Join(os.TempDir(), "nhex-uploads")
	if err := os.MkdirAll(uploadsDir, 0755); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": "fs error: " + err.Error()})
		return
	}

	// Save file with unique name
	safeName := filepath.Base(header.Filename)
	dstPath := filepath.Join(uploadsDir, fmt.Sprintf("%d_%s", time.Now().UnixNano(), safeName))

	dst, err := os.Create(dstPath)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": "save error: " + err.Error()})
		return
	}
	// Copy content
	if _, err := io.Copy(dst, file); err != nil {
		dst.Close()
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": "copy error: " + err.Error()})
		return
	}
	dst.Close()

	t, err := s.files.SendFile(r.Context(), peerID, dstPath)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "transfer": t})
}

func (s *Server) handleFileTransfers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	if s.files == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	transfers := s.files.ListTransfers()
	_ = json.NewEncoder(w).Encode(map[string]any{
		"transfers": transfers,
	})
}

func (s *Server) handleProtocols(w http.ResponseWriter, r *http.Request) {
	_ = json.NewEncoder(w).Encode(map[string]any{
		"protocols": s.info.Protocols,
	})
}

func (s *Server) handleMediaCall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		PeerID string         `json:"peer_id"`
		SDP    string         `json:"sdp"`
		Type   media.CallType `json:"type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	callType := req.Type
	if callType == "" {
		callType = media.CallTypeAudio
	}

	call, err := s.media.InitiateCall(r.Context(), req.PeerID, req.SDP, callType)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "call": call})
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	if err := s.media.AcceptCall(req.CallID, req.SDP); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

func (s *Server) handleMediaCandidate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		CallID    string                    `json:"call_id"`
		Candidate media.ICECandidatePayload `json:"candidate"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	if err := s.media.SendCandidate(req.CallID, req.Candidate); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

func (s *Server) handleMediaHangup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		CallID string `json:"call_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	s.media.EndCall(req.CallID)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

func (s *Server) handleMediaEvents(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	events := s.mediaEvents
	s.mediaEvents = make([]interface{}, 0)
	s.mu.Unlock()

	_ = json.NewEncoder(w).Encode(map[string]interface{}{"events": events})
}

// Implement media.SignalHandler interface

func (s *Server) OnIncomingCall(call *media.Call, sdp string) {
	event := map[string]interface{}{
		"type": "incoming_call",
		"call": call,
		"sdp":  sdp,
		"timestamp": time.Now().Unix(),
	}
	
	// Broadcast to all sessions and keep legacy support
	s.broadcastEvent(event, "")
	
	// Legacy polling support
	s.mu.Lock()
	s.mediaEvents = append(s.mediaEvents, event)
	s.mu.Unlock()
}

func (s *Server) OnCallAccepted(call *media.Call, sdp string) {
	event := map[string]interface{}{
		"type": "call_accepted",
		"call": call,
		"sdp":  sdp,
		"timestamp": time.Now().Unix(),
	}
	
	// Broadcast to all sessions and keep legacy support
	s.broadcastEvent(event, "")
	
	// Legacy polling support
	s.mu.Lock()
	s.mediaEvents = append(s.mediaEvents, event)
	s.mu.Unlock()
}

func (s *Server) OnICECandidate(callID string, candidate media.ICECandidatePayload) {
	event := map[string]interface{}{
		"type": "ice_candidate",
		"call_id": callID,
		"candidate": candidate,
		"timestamp": time.Now().Unix(),
	}
	
	// Broadcast to all sessions and keep legacy support
	s.broadcastEvent(event, "")
	
	// Legacy polling support
	s.mu.Lock()
	s.mu.Unlock()
}

func (s *Server) OnHangup(callID string) {
	event := map[string]interface{}{
		"type":    "hangup",
		"call_id": callID,
		"timestamp": time.Now().Unix(),
	}
	
	// Broadcast to all sessions and keep legacy support
	s.broadcastEvent(event, "")
	
	// Legacy polling support
	s.mu.Lock()
	s.mediaEvents = append(s.mediaEvents, event)
	s.mu.Unlock()
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

// Session management handlers
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

	sessionID := uuid.New().String()
	session := &Session{
		ID:          sessionID,
		TerminalID:  req.TerminalID,
		ProcessName: req.ProcessName,
		ConnectedAt: time.Now(),
		LastSeen:    time.Now(),
		EventQueue:  make([]interface{}, 0),
	}

	s.mu.Lock()
	s.sessions[sessionID] = session
	s.mu.Unlock()

	log.Printf("Created session %s for terminal %s process %s", sessionID, req.TerminalID, req.ProcessName)

	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":         true,
		"session_id": sessionID,
		"terminal_id": req.TerminalID,
		"process_name": req.ProcessName,
	})
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("session_id")
	if sessionID == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	s.mu.RLock()
	session, exists := s.sessions[sessionID]
	s.mu.RUnlock()

	if !exists {
		w.WriteHeader(http.StatusNotFound)
		return
	}

	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	session.mu.Lock()
	session.WebSocket = conn
	session.LastSeen = time.Now()
	session.mu.Unlock()

	log.Printf("WebSocket connected for session %s", sessionID)

	// Send queued events
	session.mu.RLock()
	queuedEvents := make([]interface{}, len(session.EventQueue))
	copy(queuedEvents, session.EventQueue)
	session.mu.RUnlock()

	for _, event := range queuedEvents {
		if err := conn.WriteJSON(event); err != nil {
			log.Printf("Failed to send queued event: %v", err)
			break
		}
	}

	// Clear queue after sending
	session.mu.Lock()
	session.EventQueue = session.EventQueue[:0]
	session.mu.Unlock()

	// Handle incoming messages and keep connection alive
	go s.handleWebSocketMessages(session, conn)
}

func (s *Server) handleWebSocketMessages(session *Session, conn *websocket.Conn) {
	defer func() {
		conn.Close()
		session.mu.Lock()
		session.WebSocket = nil
		session.mu.Unlock()
		log.Printf("WebSocket disconnected for session %s", session.ID)
	}()

	for {
		var msg map[string]interface{}
		if err := conn.ReadJSON(&msg); err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		session.mu.Lock()
		session.LastSeen = time.Now()
		session.mu.Unlock()

		// Handle ping/pong or other control messages
		if msgType, ok := msg["type"].(string); ok && msgType == "ping" {
			response := map[string]interface{}{
				"type": "pong",
				"timestamp": time.Now().Unix(),
			}
			if err := conn.WriteJSON(response); err != nil {
				break
			}
		}
	}
}

func (s *Server) handleSessions(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	sessions := make([]map[string]interface{}, 0, len(s.sessions))
	for _, session := range s.sessions {
		session.mu.RLock()
		sessions = append(sessions, map[string]interface{}{
			"id":           session.ID,
			"terminal_id":  session.TerminalID,
			"process_name": session.ProcessName,
			"connected_at": session.ConnectedAt.Unix(),
			"last_seen":    session.LastSeen.Unix(),
			"websocket":    session.WebSocket != nil,
		})
		session.mu.RUnlock()
	}
	s.mu.RUnlock()

	_ = json.NewEncoder(w).Encode(map[string]any{
		"sessions": sessions,
	})
}

func (s *Server) sessionCleanup() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		s.mu.Lock()
		for id, session := range s.sessions {
			session.mu.RLock()
			inactive := time.Since(session.LastSeen) > 5*time.Minute
			session.mu.RUnlock()

			if inactive {
				session.mu.Lock()
				if session.WebSocket != nil {
					session.WebSocket.Close()
				}
				session.mu.Unlock()
				delete(s.sessions, id)
				log.Printf("Cleaned up inactive session %s", id)
			}
		}
		s.mu.Unlock()
	}
}

// Broadcast event to all sessions or specific session
func (s *Server) broadcastEvent(event interface{}, sessionID string) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if sessionID != "" {
		// Send to specific session
		if session, exists := s.sessions[sessionID]; exists {
			s.sendEventToSession(session, event)
		}
		return
	}

	// Broadcast to all sessions
	for _, session := range s.sessions {
		s.sendEventToSession(session, event)
	}
}

func (s *Server) sendEventToSession(session *Session, event interface{}) {
	session.mu.Lock()
	defer session.mu.Unlock()

	if session.WebSocket != nil {
		// Send immediately via WebSocket
		if err := session.WebSocket.WriteJSON(event); err != nil {
			log.Printf("Failed to send event via WebSocket: %v", err)
			// Queue for later if WebSocket fails
			session.EventQueue = append(session.EventQueue, event)
		}
	} else {
		// Queue for later delivery
		session.EventQueue = append(session.EventQueue, event)
		// Limit queue size
		if len(session.EventQueue) > 100 {
			session.EventQueue = session.EventQueue[1:]
		}
	}
}