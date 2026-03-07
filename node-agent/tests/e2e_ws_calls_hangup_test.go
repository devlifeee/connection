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

func TestE2E_WS_Call_ICE_Hangup(t *testing.T) {
	h1 := "127.0.0.1:19680"
	h2 := "127.0.0.1:19681"
	// callee
	cfg2 := rtpkg.DefaultConfig()
	cfg2.HTTPAddr = h2
	cfg2.DataDir = t.TempDir()
	ctx2, _ := context.WithCancel(context.Background())
	rt2, err := rtpkg.Start(ctx2, cfg2)
	if err != nil { t.Fatalf("start node2: %v", err) }
	defer rt2.Close(context.Background())
	hc := newHC()
	var ident2 struct{ PeerID string `json:"peer_id"` }
	dead := time.Now().Add(5 * time.Second)
	for { if hc.getJSON("http://"+h2+"/identity",&ident2)==nil && ident2.PeerID!="" {break}; if time.Now().After(dead){t.Fatalf("id2 timeout")}; time.Sleep(80*time.Millisecond) }
	// caller
	cfg1 := rtpkg.DefaultConfig()
	cfg1.HTTPAddr = h1
	cfg1.BootstrapHTTP = []string{"http://" + h2}
	cfg1.DataDir = t.TempDir()
	ctx1, _ := context.WithCancel(context.Background())
	rt1, err := rtpkg.Start(ctx1, cfg1)
	if err != nil { t.Fatalf("start node1: %v", err) }
	defer rt1.Close(context.Background())
	var ident1 struct{ PeerID string `json:"peer_id"` }
	dead = time.Now().Add(5 * time.Second)
	for { if hc.getJSON("http://"+h1+"/identity",&ident1)==nil && ident1.PeerID!="" {break}; if time.Now().After(dead){t.Fatalf("id1 timeout")}; time.Sleep(80*time.Millisecond) }
	// peers
	waitPeers(t, &node{http: "http://" + h1}, 1)
	waitPeers(t, &node{http: "http://" + h2}, 1)
	// sessions + ws
	var s1, s2 struct{ Ok bool `json:"ok"`; SessionID string `json:"session_id"` }
	_ = hc.postJSON("http://"+h1+"/session/create", map[string]string{"terminal_id":"t1","process_name":"ws"}, &s1)
	_ = hc.postJSON("http://"+h2+"/session/create", map[string]string{"terminal_id":"t2","process_name":"ws"}, &s2)
	if !s1.Ok || !s2.Ok { t.Fatalf("session create failed") }
	// ws connect helper
	wsConn := func(base, sid string) *websocket.Conn {
		u := url.URL{Scheme:"ws", Host: base, Path: "/session/ws"}
		q := u.Query(); q.Set("session_id", sid); u.RawQuery = q.Encode()
		c,_,err := websocket.DefaultDialer.Dial(u.String(), nil)
		if err != nil { t.Fatalf("ws dial %s: %v", u.String(), err) }
		return c
	}
	c1 := wsConn(h1, s1.SessionID); defer c1.Close()
	c2 := wsConn(h2, s2.SessionID); defer c2.Close()
	// call
	var callResp struct{ Ok bool `json:"ok"`; Call map[string]any `json:"call"`; Error string `json:"error"` }
	_ = hc.postJSON("http://"+h1+"/media/call", map[string]string{"peer_id": ident2.PeerID, "sdp": "offer", "type": "audio"}, &callResp)
	if !callResp.Ok { t.Fatalf("media/call: %s", callResp.Error) }
	// expect incoming on callee
	gotIncoming := false
	dead = time.Now().Add(3 * time.Second)
	for !gotIncoming && time.Now().Before(dead) {
		_, data, err := c2.ReadMessage(); if err!=nil {continue}
		var ev map[string]any; _ = json.Unmarshal(data, &ev)
		if ev["type"] == "incoming_call" { gotIncoming = true }
	}
	if !gotIncoming { t.Fatalf("no incoming_call") }
	// send candidate both ways
	_ = hc.postJSON("http://"+h1+"/media/candidate", map[string]any{"call_id": callResp.Call["id"], "candidate": map[string]any{"candidate": "a=cand"}}, nil)
	// hangup
	_ = hc.postJSON("http://"+h1+"/media/hangup", map[string]any{"call_id": callResp.Call["id"]}, nil)
	// expect hangup at callee
	gotHang := false
	dead = time.Now().Add(3 * time.Second)
	for !gotHang && time.Now().Before(dead) {
		_, data, err := c2.ReadMessage(); if err!=nil {continue}
		var ev map[string]any; _ = json.Unmarshal(data, &ev)
		if ev["type"] == "hangup" { gotHang = true }
	}
	if !gotHang { t.Fatalf("no hangup event at callee") }
}
