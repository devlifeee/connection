package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"mime"
	"net"
	"net/http"
	"sort"
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
	"github.com/nhex-team/connection/node-agent/internal/metrics"
	"os"
	"io"
	"strings"
	"github.com/nhex-team/connection/node-agent/internal/chatrelay"
	"path/filepath"
	"github.com/jackc/pgx/v5/pgxpool"
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
	dbstore  interface{ Pool() *pgxpool.Pool }
	// metrics
	chatSent int64
	chatRecv int64
	chatDirectSent int64
	chatRelaySent  int64
	chatRateLimited int64
	outboxRetries int64
	outboxSuccess int64
	chatLat *metrics.Reservoir
	fileChunkLat *metrics.Reservoir
	fileCompleted int64
	fileFailed int64
	// calls
	callStarted int64
	callConnected int64
	callEnded int64
	callDur *metrics.Reservoir
	chatDefaultBurst int
	chatDefaultRate  float64
	chatTTLDefault int
	chatMaskRules []maskRule
	outboxMaxRetries int
	outboxBaseBackoffMs int
	trust map[string]string // peer_id -> trusted|unknown|blocked
	mediaAutoAccept bool
	profilePath string
	trustOnlyFiles bool
	trustOnlyMedia bool
	relay    *chatrelay.Relay
	signer   *protocol.Signer
	limits   map[string]*tokenBucket
	outbox   *protocol.Outbox
}

type maskRule struct {
	Pattern string
	Burst   int
	Rate    float64
}

// Implement media.SignalHandler
func (s *Server) OnIncomingCall(call *media.Call, sdp string) {
	s.callStarted++
	if s.mediaAutoAccept {
		_ = s.media.AcceptCall(call.ID, "auto-answer")
	}
	if s.sessions != nil {
		s.sessions.Broadcast(map[string]any{
			"type": "incoming_call",
			"call": call,
			"sdp":  sdp,
		})
	}
}

func (s *Server) OnCallAccepted(call *media.Call, sdp string) {
	s.callConnected++
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
	s.callEnded++
	if s.media != nil && s.callDur != nil {
		if c := s.media.GetCall(callID); c != nil && c.StartTime > 0 {
			d := time.Now().Unix() - c.StartTime
			if d >= 0 && d < 24*3600 {
				s.callDur.Add(d * 1000)
			}
		}
	}
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
		chatLat:  metrics.NewReservoir(256),
		callDur:  metrics.NewReservoir(256),
		fileChunkLat: metrics.NewReservoir(256),
		chatDefaultBurst: 5,
		chatDefaultRate:  1,
		chatTTLDefault: 8,
		outboxMaxRetries: 5,
		outboxBaseBackoffMs: 800,
		trust: make(map[string]string),
	}
	// Trust-only is opt-in via /config/trust_only to keep tests permissive by default
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/identity", s.handleIdentity)
	mux.HandleFunc("/addrs", s.handleAddrs)
	mux.HandleFunc("/connect", s.handleConnect)
	mux.HandleFunc("/peers", s.handlePeers)
	mux.HandleFunc("/presence", s.handlePresence)
	mux.HandleFunc("/presence/peers", s.handlePresencePeers)
	mux.HandleFunc("/presence/update", s.handlePresenceUpdate)
	mux.HandleFunc("/protocols", s.handleProtocols)
	mux.HandleFunc("/metrics", s.handleMetrics)
	mux.HandleFunc("/security", s.handleSecurity)
	mux.HandleFunc("/security/block_add", s.handleSecurityBlockAdd)   // legacy
	mux.HandleFunc("/security/block_remove", s.handleSecurityBlockRemove) // legacy
	mux.HandleFunc("/security/block_list", s.handleSecurityBlockList) // legacy
	mux.HandleFunc("/security/trust_set", s.handleSecurityTrustSet)
	mux.HandleFunc("/security/trust_list", s.handleSecurityTrustList)
	mux.HandleFunc("/config/chat_ttl", s.handleConfigChatTTL)
	mux.HandleFunc("/config/chat_limit_masks", s.handleConfigChatLimitMasks)
	mux.HandleFunc("/config/media_auto_accept", s.handleConfigMediaAutoAccept)
	mux.HandleFunc("/config/chat_limit_peer", s.handleConfigChatLimitPeer)
	mux.HandleFunc("/config/chat_limit_default", s.handleConfigChatLimitDefault)
	mux.HandleFunc("/config/outbox", s.handleConfigOutbox)
	mux.HandleFunc("/config/trust_only", s.handleConfigTrustOnly)
	mux.HandleFunc("/chat/send", s.handleChatSend)
	mux.HandleFunc("/chat/history", s.handleChatHistory)
	mux.HandleFunc("/chat/read", s.handleChatRead)
	mux.HandleFunc("/chat/outbox", s.handleChatOutbox)
	mux.HandleFunc("/session/create", s.handleSessionCreate)
	mux.HandleFunc("/session/ws", s.handleSessionWS)
	mux.HandleFunc("/sessions", s.handleSessions)
	mux.HandleFunc("/media/call", s.handleMediaCall)
	mux.HandleFunc("/media/answer", s.handleMediaAnswer)
	mux.HandleFunc("/media/candidate", s.handleMediaCandidate)
	mux.HandleFunc("/media/hangup", s.handleMediaHangup)
	mux.HandleFunc("/media/events", s.handleMediaEvents)
	mux.HandleFunc("/media/calls", s.handleMediaCalls)
	mux.HandleFunc("/files/send", s.handleFilesSend)
	mux.HandleFunc("/files/transfers", s.handleFilesTransfers)
	mux.HandleFunc("/files/set_rate_limit", s.handleFilesSetRateLimit)
	mux.HandleFunc("/files/cancel", s.handleFilesCancel)
	mux.HandleFunc("/files/set_rate_limit_peer", s.handleFilesSetPeerRateLimit)
	mux.HandleFunc("/files/pause", s.handleFilesPause)
	mux.HandleFunc("/files/resume", s.handleFilesResume)
	mux.HandleFunc("/files/download", s.handleFilesDownload)
	mux.HandleFunc("/files/list", s.handleFilesList)
	mux.HandleFunc("/peer/addrs", s.handlePeerAddrs)

	s.http = &http.Server{
		Addr:              addr,
		Handler:           cors(mux),
		ReadHeaderTimeout: 5 * time.Second,
	}
	return s
}

func (s *Server) SetProfilePath(p string) { s.profilePath = p }

func (s *Server) SetRelay(r *chatrelay.Relay) {
	s.relay = r
}

func (s *Server) SetSigner(sig *protocol.Signer) {
	s.signer = sig
}

func (s *Server) SetOutbox(o *protocol.Outbox) {
	s.outbox = o
}
func (s *Server) SetDB(ds interface{ Pool() *pgxpool.Pool }) { s.dbstore = ds }
func (s *Server) IsTrusted(peerID string) bool {
	lvl, ok := s.trust[peerID]
	return ok && lvl == "trusted"
}
func (s *Server) TrustOnlyFiles() bool { return s.trustOnlyFiles }
func (s *Server) TrustOnlyMedia() bool { return s.trustOnlyMedia }

func (s *Server) IncChatRecv() {
	s.chatRecv++
}

func (s *Server) IncDirectSent()  { s.chatDirectSent++; s.chatSent++ }
func (s *Server) IncRelaySent()   { s.chatRelaySent++; s.chatSent++ }
func (s *Server) IncRateLimited() { s.chatRateLimited++ }
func (s *Server) IncOutboxRetry() { s.outboxRetries++ }
func (s *Server) IncOutboxSuccess() { s.outboxSuccess++ }
func (s *Server) OutboxBackoffBaseMs() int { if s.outboxBaseBackoffMs > 0 { return s.outboxBaseBackoffMs }; return 800 }
func (s *Server) OutboxMaxRetries() int { if s.outboxMaxRetries > 0 { return s.outboxMaxRetries }; return 5 }
func (s *Server) AddFileChunkRTT(ms int64) { if s.fileChunkLat != nil { s.fileChunkLat.Add(ms) } }
func (s *Server) IncFileCompleted() { s.fileCompleted++ }
func (s *Server) IncFileFailed() { s.fileFailed++ }
// simple token bucket for chat rate-limiting
type tokenBucket struct {
	capacity int
	tokens   float64
	refill   float64 // tokens per second
	last     time.Time
}

func (b *tokenBucket) allow(n float64) bool {
	now := time.Now()
	if b.last.IsZero() {
		b.last = now
	}
	elapsed := now.Sub(b.last).Seconds()
	b.tokens = minf(float64(b.capacity), b.tokens+elapsed*b.refill)
	b.last = now
	if b.tokens >= n {
		b.tokens -= n
		return true
	}
	return false
}

func minf(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func (s *Server) getBucket(peerID string) *tokenBucket {
	if s.limits == nil {
		s.limits = make(map[string]*tokenBucket)
	}
	if b, ok := s.limits[peerID]; ok {
		return b
	}
	// apply mask rules first-match
	cap := 0
	rate := 0.0
	for _, r := range s.chatMaskRules {
		if r.Pattern == "" {
			continue
		}
		match := false
		if strings.HasSuffix(r.Pattern, "*") {
			prefix := strings.TrimSuffix(r.Pattern, "*")
			match = strings.HasPrefix(peerID, prefix)
		} else {
			match = peerID == r.Pattern
		}
		if match {
			cap = r.Burst
			rate = r.Rate
			break
		}
	}
	if cap <= 0 {
		cap = s.chatDefaultBurst
	}
	if cap <= 0 {
		cap = 5
	}
	if rate <= 0 {
		rate = s.chatDefaultRate
	}
	if rate <= 0 {
		rate = 1
	}
	b := &tokenBucket{capacity: cap, tokens: float64(cap), refill: rate}
	s.limits[peerID] = b
	return b
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
	defer func() {
		if rec := recover(); rec != nil {
			w.WriteHeader(http.StatusBadGateway)
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "media manager unavailable"})
		}
	}()
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
	if s.media == nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "media manager unavailable"})
		return
	}
	// trust-only (outgoing media)
	if s.trustOnlyMedia && !s.IsTrusted(req.PeerID) {
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "not trusted"})
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
	if strings.TrimSpace(peerID) == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "peer_id required"})
		return
	}
	// blocklist enforcement
	if s.IsBlocked(peerID) {
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "blocked"})
		return
	}
	// trust-only (outgoing files)
	if s.trustOnlyFiles && !s.IsTrusted(peerID) {
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "not trusted"})
		return
	}
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
	status := r.URL.Query().Get("status")
	role := r.URL.Query().Get("role")
	limitStr := r.URL.Query().Get("limit")
	offsetStr := r.URL.Query().Get("offset")
	limit := 0
	offset := 0
	if limitStr != "" {
		if v, err := strconv.Atoi(limitStr); err == nil && v > 0 {
			limit = v
		}
	}
	if offsetStr != "" {
		if v, err := strconv.Atoi(offsetStr); err == nil && v >= 0 {
			offset = v
		}
	}
	src := s.files.ListTransfers()
	out := make([]*filetransfer.Transfer, 0, len(src))
	for _, t := range src {
		if status != "" && string(t.Status) != status {
			continue
		}
		if role != "" && t.Role != role {
			continue
		}
		out = append(out, t)
	}
	if offset > 0 && offset < len(out) {
		out = out[offset:]
	}
	if limit > 0 && limit < len(out) {
		out = out[:limit]
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"transfers": out})
}

// GET /files/list - list files in downloads dir
func (s *Server) handleFilesList(w http.ResponseWriter, r *http.Request) {
	if s.files == nil {
		_ = json.NewEncoder(w).Encode(map[string]any{"files": []any{}})
		return
	}
	type FileInfo struct {
		Name     string `json:"name"`
		Size     int64  `json:"size"`
		ModTime  int64  `json:"mod_time_ms"`
		Mime     string `json:"mime_type,omitempty"`
		Verified bool   `json:"verified,omitempty"`
	}
	var files []FileInfo
	dir := s.files.DownloadsDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		_ = json.NewEncoder(w).Encode(map[string]any{"files": []any{}})
		return
	}
	// index verified by filename from transfers
	ver := map[string]bool{}
	for _, t := range s.files.ListTransfers() {
		if t.Role == "receiver" && t.Status == filetransfer.StatusCompleted && t.Verified {
			ver[t.Metadata.Name] = true
		}
	}
	sortBy := r.URL.Query().Get("sort")  // name|size|time
	order := r.URL.Query().Get("order")  // asc|desc
	filterExt := r.URL.Query().Get("ext") // e.g. ".png"
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		fi, err := e.Info()
		if err != nil {
			continue
		}
		if filterExt != "" && filepath.Ext(fi.Name()) != filterExt {
			continue
		}
		mt := mime.TypeByExtension(filepath.Ext(fi.Name()))
		files = append(files, FileInfo{
			Name:    fi.Name(),
			Size:    fi.Size(),
			ModTime: fi.ModTime().UnixMilli(),
			Mime:    mt,
			Verified: ver[fi.Name()],
		})
	}
	// sort
	switch sortBy {
	case "size":
		sort.Slice(files, func(i, j int) bool { if order == "asc" { return files[i].Size < files[j].Size } ; return files[i].Size > files[j].Size })
	case "time":
		sort.Slice(files, func(i, j int) bool { if order == "asc" { return files[i].ModTime < files[j].ModTime } ; return files[i].ModTime > files[j].ModTime })
	default:
		sort.Slice(files, func(i, j int) bool { if order == "desc" { return files[i].Name > files[j].Name } ; return files[i].Name < files[j].Name })
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"files": files})
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

func (s *Server) handleFilesDownload(w http.ResponseWriter, r *http.Request) {
	if s.files == nil {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("file manager not available"))
		return
	}
	id := r.URL.Query().Get("id")
	if strings.TrimSpace(id) == "" {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("id required"))
		return
	}
	t, ok := s.files.GetTransfer(id)
	if !ok {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte("not found"))
		return
	}
	if t.Role != "receiver" || t.Status != filetransfer.StatusCompleted {
		// try DB fallback
		if s.dbstore != nil {
			row := s.dbstore.Pool().QueryRow(r.Context(), "SELECT bytes, mime_type, size, file_hash FROM media_blobs WHERE id=$1 OR transfer_id=$1 ORDER BY created_at DESC LIMIT 1", id)
			var bytes []byte
			var mime string
			var size int64
			var fileHash *string
			if err := row.Scan(&bytes, &mime, &size, &fileHash); err == nil {
				if fileHash != nil && *fileHash != "" {
					sum := sha256.Sum256(bytes)
					if hex.EncodeToString(sum[:]) != *fileHash {
						w.WriteHeader(http.StatusInternalServerError)
						_, _ = w.Write([]byte("hash mismatch"))
						return
					}
				}
				if mime == "" { mime = "application/octet-stream" }
				w.Header().Set("Content-Type", mime)
				w.Header().Set("Content-Length", strconv.Itoa(len(bytes)))
				_, _ = w.Write(bytes)
				return
			}
		}
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte("file not available for download"))
		return
	}
	// Serve file with correct mime, allow range for audio/video
	f, err := os.Open(t.LocalPath)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("open failed"))
		return
	}
	defer f.Close()
	ct := t.Metadata.MimeType
	if ct == "" {
		ct = mime.TypeByExtension(filepath.Ext(t.Metadata.Name))
		if ct == "" { ct = "application/octet-stream" }
	}
	w.Header().Set("Content-Type", ct)
	http.ServeContent(w, r, t.Metadata.Name, t.EndTime, f)
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

func (s *Server) handleMediaCalls(w http.ResponseWriter, r *http.Request) {
	calls := s.media.GetCalls()
	dir := r.URL.Query().Get("direction")
	state := r.URL.Query().Get("state")
	filtered := make([]*media.Call, 0, len(calls))
	for _, c := range calls {
		if dir != "" && c.Direction != dir {
			continue
		}
		if state != "" && string(c.State) != state {
			continue
		}
		cc := *c
		filtered = append(filtered, &cc)
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"calls": filtered,
	})
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	var chatP50, chatP95 int64
	if s.chatLat != nil {
		chatP50 = s.chatLat.Percentile(0.5)
		chatP95 = s.chatLat.Percentile(0.95)
	}
	var fileDurations []int64
	if s.files != nil {
		for _, t := range s.files.ListTransfers() {
			if !t.EndTime.IsZero() && (t.Status == filetransfer.StatusCompleted || t.Status == filetransfer.StatusFailed) {
				ms := t.EndTime.Sub(t.StartTime).Milliseconds()
				if ms > 0 {
					fileDurations = append(fileDurations, ms)
				}
			}
		}
	}
	var fileP50, fileP95 int64
	if len(fileDurations) > 0 {
		cp := make([]int64, len(fileDurations))
		copy(cp, fileDurations)
		sort.Slice(cp, func(i, j int) bool { return cp[i] < cp[j] })
		fileP50 = cp[int(float64(len(cp)-1)*0.5)]
		fileP95 = cp[int(float64(len(cp)-1)*0.95)]
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"chat_sent": s.chatSent,
		"chat_recv": s.chatRecv,
		"chat_direct": s.chatDirectSent,
		"chat_relay":  s.chatRelaySent,
		"chat_rate_limited": s.chatRateLimited,
		"outbox_retries": s.outboxRetries,
		"outbox_success": s.outboxSuccess,
		"outbox_size": func() int { if s.outbox != nil { return s.outbox.Size() }; return 0 }(),
		"chat_limit_default": map[string]any{"burst": s.chatDefaultBurst, "rate_per_sec": s.chatDefaultRate},
		"chat_ttl_default": s.chatTTLDefault,
		"chat_limit_masks": s.chatMaskRules,
		"outbox_cfg": map[string]any{"max_retries": s.outboxMaxRetries, "base_backoff_ms": s.outboxBaseBackoffMs},
		"chat_p50_ms": chatP50,
		"chat_p95_ms": chatP95,
		"file_p50_ms": fileP50,
		"file_p95_ms": fileP95,
		"file_chunk_p50_ms": func() int64 { if s.fileChunkLat!=nil { return s.fileChunkLat.Percentile(0.5) }; return 0 }(),
		"file_chunk_p95_ms": func() int64 { if s.fileChunkLat!=nil { return s.fileChunkLat.Percentile(0.95) }; return 0 }(),
		"file_completed": s.fileCompleted,
		"file_failed": s.fileFailed,
		"file_drop_ratio": func() float64 { denom := s.fileCompleted + s.fileFailed; if denom==0 { return 0 }; return float64(s.fileFailed)/float64(denom) }(),
		"calls_started": s.callStarted,
		"calls_connected": s.callConnected,
		"calls_ended": s.callEnded,
		"call_p50_ms": func() int64 { if s.callDur!=nil { return s.callDur.Percentile(0.5) }; return 0 }(),
		"call_p95_ms": func() int64 { if s.callDur!=nil { return s.callDur.Percentile(0.95) }; return 0 }(),
		"trust_only": map[string]any{"files": s.trustOnlyFiles, "media": s.trustOnlyMedia},
		"uptime_sec": int64(time.Since(s.start).Seconds()),
	})
}
func (s *Server) handleConfigTrustOnly(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct{
		Files bool `json:"files"`
		Media bool `json:"media"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false})
		return
	}
	s.trustOnlyFiles = req.Files
	s.trustOnlyMedia = req.Media
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func (s *Server) handleConfigChatLimitPeer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		PeerID string  `json:"peer_id"`
		Burst  int     `json:"burst"`
		Rate   float64 `json:"rate_per_sec"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.PeerID == "" || req.Burst <= 0 || req.Rate <= 0 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false})
		return
	}
	b := s.getBucket(req.PeerID)
	b.capacity = req.Burst
	b.tokens = minf(float64(req.Burst), b.tokens)
	b.refill = req.Rate
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func (s *Server) handleConfigChatLimitDefault(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Burst int     `json:"burst"`
		Rate  float64 `json:"rate_per_sec"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Burst <= 0 || req.Rate <= 0 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false})
		return
	}
	s.chatDefaultBurst = req.Burst
	s.chatDefaultRate = req.Rate
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func (s *Server) handleConfigOutbox(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		MaxRetries    int `json:"max_retries"`
		BaseBackoffMs int `json:"base_backoff_ms"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.MaxRetries < 0 || req.BaseBackoffMs <= 0 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false})
		return
	}
	s.outboxMaxRetries = req.MaxRetries
	s.outboxBaseBackoffMs = req.BaseBackoffMs
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func (s *Server) handleSecurity(w http.ResponseWriter, r *http.Request) {
	pub := s.host.Peerstore().PubKey(s.host.ID())
	var fpHex string
	if pub != nil {
		if pkb, err := pub.Raw(); err == nil {
			fp := sha256.Sum256(pkb)
			fpHex = hex.EncodeToString(fp[:])
		}
	}
	trusted, unknown, blocked := 0, 0, 0
	for _, lvl := range s.trust {
		switch lvl {
		case "trusted":
			trusted++
		case "blocked":
			blocked++
		default:
			unknown++
		}
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"peer_id": s.host.ID().String(),
		"fingerprint": fpHex,
		"e2e_signing": s.signer != nil,
		"chat_rate_limit": map[string]any{"burst": 5, "rate_per_sec": 1},
		"relay_limits": map[string]any{"burst": 5, "rate_per_sec": 1},
		"protocols": s.info.Protocols,
		"capabilities": s.info.Capabilities,
		"trust_levels": map[string]int{"trusted": trusted, "unknown": unknown, "blocked": blocked},
	})
}

func (s *Server) IsBlocked(peerID string) bool {
	return s.trust[peerID] == "blocked"
}
func (s *Server) handleSecurityBlockAdd(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct{ PeerID string `json:"peer_id"` }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.PeerID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false})
		return
	}
	s.trust[req.PeerID] = "blocked"
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}
func (s *Server) handleSecurityBlockRemove(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct{ PeerID string `json:"peer_id"` }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.PeerID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false})
		return
	}
	delete(s.trust, req.PeerID)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}
func (s *Server) handleSecurityBlockList(w http.ResponseWriter, r *http.Request) {
	list := make([]string, 0, len(s.trust))
	for p, lvl := range s.trust {
		if lvl != "blocked" {
			continue
		}
		list = append(list, p)
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"peers": list})
}

func (s *Server) handleSecurityTrustSet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		PeerID string `json:"peer_id"`
		Level  string `json:"level"` // trusted|unknown|blocked
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.PeerID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false})
		return
	}
	level := req.Level
	if level != "trusted" && level != "unknown" && level != "blocked" {
		level = "unknown"
	}
	s.trust[req.PeerID] = level
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func (s *Server) handleSecurityTrustList(w http.ResponseWriter, r *http.Request) {
	out := make([]map[string]string, 0, len(s.trust))
	for p, lvl := range s.trust {
		out = append(out, map[string]string{"peer_id": p, "level": lvl})
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"trust": out})
}

func (s *Server) handleConfigChatTTL(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct{ TTL int `json:"ttl"` }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.TTL <= 0 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false})
		return
	}
	s.chatTTLDefault = req.TTL
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func (s *Server) handleConfigChatLimitMasks(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct{ Rules []maskRule `json:"rules"` }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false})
		return
	}
	s.chatMaskRules = req.Rules
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func (s *Server) handleConfigMediaAutoAccept(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct{ Enable bool `json:"enable"` }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false})
		return
	}
	s.mediaAutoAccept = req.Enable
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
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

func (s *Server) handlePresenceUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		DisplayName string `json:"display_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "bad json"})
		return
	}
	
	self := s.presence.Self()
	self.DisplayName = req.DisplayName
	s.presence.UpdateSelf(self)
	if s.profilePath != "" {
		_ = os.MkdirAll(filepath.Dir(s.profilePath), 0o755)
		_ = os.WriteFile(s.profilePath, []byte(`{"display_name":"`+req.DisplayName+`"}`), 0o644)
	}
	
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func (s *Server) handlePresencePeers(w http.ResponseWriter, r *http.Request) {
	var peers []presence.PeerPresence
	if s.presence != nil {
		peers = s.presence.Snapshot()
		// Filter out stale entries to avoid "phantom" nodes piling up
		if len(peers) > 0 {
			nowMs := time.Now().UnixMilli()
			pruned := make([]presence.PeerPresence, 0, len(peers))
			seen := make(map[string]struct{}, len(peers))
			for _, p := range peers {
				// consider entries stale if not seen for > 8s (PresenceInterval is 2s by default)
				if nowMs-p.LastSeenMs > 8000 {
					continue
				}
				if _, ok := seen[p.Payload.PeerID]; ok {
					continue
				}
				seen[p.Payload.PeerID] = struct{}{}
				pruned = append(pruned, p)
			}
			peers = pruned
		}
	}
	// Fallback: if presence store empty, synthesize from connected peers to avoid empty UI
	if len(peers) == 0 {
		now := time.Now().UnixMilli()
		netPeers := s.host.Network().Peers()
		out := make([]presence.PeerPresence, 0, len(netPeers))
		for _, p := range netPeers {
			out = append(out, presence.PeerPresence{
				Payload: presence.Payload{
					PeerID:       p.String(),
					DisplayName:  "",
					Capabilities: []string{"chat", "file", "media"},
					Version:      "",
					UptimeSec:    0,
					TimestampMs:  now,
				},
				LastSeenMs: now,
			})
		}
		peers = out
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"peers": peers})
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
	// blocklist enforcement (outgoing)
	if s.IsBlocked(req.PeerID) {
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "blocked"})
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
	env := protocol.Envelope{
		ID:        strconv.FormatInt(time.Now().UnixNano(), 10),
		Type:      "chat",
		Timestamp: time.Now().UnixMilli(),
		Sender:    s.host.ID().String(),
		TTL:       func() int { if s.chatTTLDefault>0 { return s.chatTTLDefault }; return 8 }(),
		Payload:   json.RawMessage([]byte(`{"text":` + strconv.Quote(req.Text) + `}`)),
	}
	// rate-limit per peer
	if !s.getBucket(req.PeerID).allow(1) {
		w.WriteHeader(http.StatusTooManyRequests)
		s.IncRateLimited()
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "rate limited"})
		return
	}
	// sign if available
	if s.signer != nil {
		if signed, err := s.signer.Sign(env); err == nil {
			env = signed
		}
	}
	// try direct stream first
	stream, err := s.host.NewStream(ctx, p, libp2pproto.ID(chatID))
	if err == nil {
		defer stream.Close()
		if err := protocol.WriteEnvelope(ctx, stream, env); err == nil {
			s.chatSent++
			_ = stream.SetReadDeadline(time.Now().Add(2 * time.Second))
			var ack protocol.Envelope
			dec := json.NewDecoder(stream)
			_ = dec.Decode(&ack)
			if ack.Type == "ack" && ack.AckFor == env.ID {
				if s.chat != nil {
					s.chat.Add(req.PeerID, ack)
				}
				if s.chatLat != nil {
					d := time.Now().UnixMilli() - env.Timestamp
					if d >= 0 && d < 60000 {
						s.chatLat.Add(d)
					}
				}
			}
			if s.chat != nil {
				s.chat.Add(req.PeerID, env)
			}
			s.IncDirectSent()
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "via": "direct"})
			return
		}
	}
	// fallback to relay (pubsub multi-hop)
	if s.chat != nil {
		s.chat.Add(req.PeerID, env)
	}
	if s.relay != nil {
		_ = s.relay.Publish(r.Context(), chatrelay.Envelope{
			ID:        env.ID,
			From:      s.host.ID().String(),
			To:        req.PeerID,
			Timestamp: env.Timestamp,
			TTL:       4,
			Payload:   env.Payload,
		})
		s.IncRelaySent()
		// Add a safety retry via outbox to improve reliability when pubsub mesh not formed yet.
		if s.outbox != nil {
			s.outbox.Enqueue(&protocol.OutboxItem{
				PeerID:      req.PeerID,
				Envelope:    env,
				NextAttempt: time.Now().Add(1500 * time.Millisecond).UnixMilli(),
				Attempts:    1,
				MaxRetries:  s.outboxMaxRetries,
				TTL:         3,
				CreatedMs:   time.Now().UnixMilli(),
			})
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "via": "relay"})
		return
	}
	// queue into outbox if available
	if s.outbox != nil {
		s.outbox.Enqueue(&protocol.OutboxItem{
			PeerID:      req.PeerID,
			Envelope:    env,
			NextAttempt: time.Now().Add(1500 * time.Millisecond).UnixMilli(),
			Attempts:    0,
			MaxRetries:  s.outboxMaxRetries,
			TTL:         4,
			CreatedMs:   time.Now().UnixMilli(),
		})
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "queued": true})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "no route and no outbox"})
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

func (s *Server) handleChatOutbox(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		if s.outbox == nil {
			_ = json.NewEncoder(w).Encode(map[string]any{"items": []any{}})
			return
		}
		list := s.outbox.Items()
		_ = json.NewEncoder(w).Encode(map[string]any{"items": list})
	case http.MethodDelete:
		id := r.URL.Query().Get("id")
		if id == "" || s.outbox == nil {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": false})
			return
		}
		ok := s.outbox.RemoveByEnvelopeID(id)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": ok})
	case http.MethodPost:
		var req struct{ ID string `json:"id"` }
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == "" || s.outbox == nil {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": false})
			return
		}
		ok := s.outbox.TouchNowByEnvelopeID(req.ID)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": ok})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Access-Control-Request-Private-Network")
		if strings.EqualFold(r.Header.Get("Access-Control-Request-Private-Network"), "true") {
			w.Header().Set("Access-Control-Allow-Private-Network", "true")
		}
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
