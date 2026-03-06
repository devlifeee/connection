package tests

import (
	"context"
	"encoding/json"
	"net/url"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	rtpkg "github.com/nhex-team/connection/node-agent/internal/runtime"
)

func wsConnect(t *testing.T, base string, sessionID string) *websocket.Conn {
	t.Helper()
	u := url.URL{Scheme: "ws", Host: base, Path: "/session/ws"}
	q := u.Query()
	q.Set("session_id", sessionID)
	u.RawQuery = q.Encode()
	dialer := websocket.Dialer{}
	conn, _, err := dialer.Dial(u.String(), nil)
	if err != nil {
		t.Fatalf("ws dial %s: %v", u.String(), err)
	}
	return conn
}

func TestE2E_WS_Call_Events(t *testing.T) {
	h1 := "127.0.0.1:19480"
	h2 := "127.0.0.1:19481"
	// Start callee
	cfg2 := rtpkg.DefaultConfig()
	cfg2.HTTPAddr = h2
	cfg2.DataDir = t.TempDir()
	ctx2, _ := context.WithCancel(context.Background())
	rt2, err := rtpkg.Start(ctx2, cfg2)
	if err != nil {
		t.Fatalf("start node2: %v", err)
	}
	defer rt2.Close(context.Background())
	hc := newHC()
	var ident2 struct{ PeerID string `json:"peer_id"` }
	dead := time.Now().Add(5 * time.Second)
	for {
		if err := hc.getJSON("http://"+h2+"/identity", &ident2); err == nil && ident2.PeerID != "" {
			break
		}
		if time.Now().After(dead) {
			t.Fatalf("identity2 timeout")
		}
		time.Sleep(100 * time.Millisecond)
	}
	// Start caller
	cfg1 := rtpkg.DefaultConfig()
	cfg1.HTTPAddr = h1
	cfg1.BootstrapHTTP = []string{"http://" + h2}
	cfg1.DataDir = t.TempDir()
	ctx1, _ := context.WithCancel(context.Background())
	rt1, err := rtpkg.Start(ctx1, cfg1)
	if err != nil {
		t.Fatalf("start node1: %v", err)
	}
	defer rt1.Close(context.Background())
	var ident1 struct{ PeerID string `json:"peer_id"` }
	dead = time.Now().Add(5 * time.Second)
	for {
		if err := hc.getJSON("http://"+h1+"/identity", &ident1); err == nil && ident1.PeerID != "" {
			break
		}
		if time.Now().After(dead) {
			t.Fatalf("identity1 timeout")
		}
		time.Sleep(100 * time.Millisecond)
	}
	// Ensure peers
	waitPeers(t, &node{http: "http://" + h1}, 1)
	waitPeers(t, &node{http: "http://" + h2}, 1)
	// Create sessions and attach WS
	var s1, s2 struct {
		Ok         bool   `json:"ok"`
		SessionID  string `json:"session_id"`
		TerminalID string `json:"terminal_id"`
	}
	_ = hc.postJSON("http://"+h1+"/session/create", map[string]string{"terminal_id": "t1", "process_name": "ws"}, &s1)
	_ = hc.postJSON("http://"+h2+"/session/create", map[string]string{"terminal_id": "t2", "process_name": "ws"}, &s2)
	if !s1.Ok || !s2.Ok || s1.SessionID == "" || s2.SessionID == "" {
		t.Fatalf("session create failed")
	}
	c1 := wsConnect(t, h1, s1.SessionID)
	defer c1.Close()
	c2 := wsConnect(t, h2, s2.SessionID)
	defer c2.Close()
	// Send call
	type callRespT struct {
		Ok    bool                   `json:"ok"`
		Call  map[string]interface{} `json:"call"`
		Error string                 `json:"error"`
	}
	var callResp callRespT
	_ = hc.postJSON("http://"+h1+"/media/call", map[string]string{
		"peer_id": ident2.PeerID,
		"sdp":     "dummy-offer",
		"type":    "audio",
	}, &callResp)
	if !callResp.Ok {
		t.Fatalf("media/call failed: %s", callResp.Error)
	}
	// Expect incoming_call on ws callee
	dead = time.Now().Add(4 * time.Second)
	gotIncoming := false
	for !gotIncoming && time.Now().Before(dead) {
		_, msg, err := c2.ReadMessage()
		if err != nil {
			continue
		}
		var ev map[string]any
		_ = json.Unmarshal(msg, &ev)
		if ev["type"] == "incoming_call" {
			gotIncoming = true
		}
	}
	if !gotIncoming {
		t.Fatalf("no incoming_call event on callee ws")
	}
	// Answer
	var calls2 struct{ Calls []map[string]any `json:"calls"` }
	_ = hc.getJSON("http://"+h2+"/media/calls?direction=incoming&state=incoming", &calls2)
	incomingID := ""
	if len(calls2.Calls) > 0 {
		if id, ok := calls2.Calls[0]["id"].(string); ok {
			incomingID = id
		}
	}
	_ = hc.postJSON("http://"+h2+"/media/answer", map[string]string{"call_id": incomingID, "sdp": "dummy-answer"}, nil)
	// Expect call_accepted on caller ws
	dead = time.Now().Add(4 * time.Second)
	gotAccepted := false
	for !gotAccepted && time.Now().Before(dead) {
		_, msg, err := c1.ReadMessage()
		if err != nil {
			continue
		}
		var ev map[string]any
		_ = json.Unmarshal(msg, &ev)
		if ev["type"] == "call_accepted" {
			gotAccepted = true
		}
	}
	if !gotAccepted {
		t.Fatalf("no call_accepted event on caller ws")
	}
	// ICE candidate from caller and expect ice_candidate on callee
	_ = hc.postJSON("http://"+h1+"/media/candidate", map[string]any{
		"call_id":  callResp.Call["id"],
		"candidate": map[string]any{"candidate": "a=candidate:1 1 UDP 2 127.0.0.1 12345 typ host"},
	}, nil)
	dead = time.Now().Add(4 * time.Second)
	gotICE := false
	for !gotICE && time.Now().Before(dead) {
		_, msg, err := c2.ReadMessage()
		if err != nil {
			continue
		}
		var ev map[string]any
		_ = json.Unmarshal(msg, &ev)
		if ev["type"] == "ice_candidate" {
			gotICE = true
		}
	}
	if !gotICE {
		t.Fatalf("no ice_candidate event on callee ws")
	}
}
