package api

import (
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Session struct {
	ID          string `json:"id"`
	TerminalID  string `json:"terminal_id"`
	ProcessName string `json:"process_name"`
	ConnectedAt int64  `json:"connected_at"`
	LastSeen    int64  `json:"last_seen"`
	Websocket   bool   `json:"websocket"`
}

type Sessions struct {
	mu       sync.RWMutex
	byID     map[string]*Session
	upgrader websocket.Upgrader
	conns    map[string]*websocket.Conn
}

func NewSessions() *Sessions {
	return &Sessions{
		byID: make(map[string]*Session),
		conns: make(map[string]*websocket.Conn),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

func (s *Sessions) Create(terminalID, processName string) *Session {
	now := time.Now().UnixMilli()
	id := terminalID + "-" + processName + "-" + time.Now().Format("150405.000")
	sess := &Session{
		ID:          id,
		TerminalID:  terminalID,
		ProcessName: processName,
		ConnectedAt: now,
		LastSeen:    now,
	}
	s.mu.Lock()
	s.byID[id] = sess
	s.mu.Unlock()
	return sess
}

func (s *Sessions) List() []*Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]*Session, 0, len(s.byID))
	for _, v := range s.byID {
		cp := *v
		out = append(out, &cp)
	}
	return out
}

func (s *Sessions) WS(w http.ResponseWriter, r *http.Request, sessionID string) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	s.mu.Lock()
	if sess, ok := s.byID[sessionID]; ok {
		sess.Websocket = true
		sess.LastSeen = time.Now().UnixMilli()
	}
	s.conns[sessionID] = conn
	s.mu.Unlock()
	conn.SetReadLimit(1 << 20)
	_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	for {
		mt, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}
		if mt == websocket.TextMessage {
			_ = conn.WriteMessage(websocket.TextMessage, msg) // echo ping messages
		}
		s.mu.Lock()
		if sess, ok := s.byID[sessionID]; ok {
			sess.LastSeen = time.Now().UnixMilli()
		}
		s.mu.Unlock()
		_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	}
	s.mu.Lock()
	if sess, ok := s.byID[sessionID]; ok {
		sess.Websocket = false
		sess.LastSeen = time.Now().UnixMilli()
	}
	delete(s.conns, sessionID)
	s.mu.Unlock()
}

func (s *Sessions) Broadcast(event map[string]any) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	event["timestamp"] = time.Now().UnixMilli()
	for id, c := range s.conns {
		if c == nil {
			continue
		}
		if err := c.WriteJSON(event); err != nil {
			_ = c.Close()
			delete(s.conns, id)
		}
	}
}
