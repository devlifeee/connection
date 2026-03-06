package tests

import (
	"context"
	"net/url"
	"testing"
	"time"

	rtpkg "github.com/nhex-team/connection/node-agent/internal/runtime"
)

func TestE2E_Calls_Signal_Accept(t *testing.T) {
	h1 := "127.0.0.1:19380"
	h2 := "127.0.0.1:19381"

	// Start callee first
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

	// Start caller with bootstrap to callee
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

	// Wait peers
	waitPeers(t, &node{http: "http://" + h1}, 1)
	waitPeers(t, &node{http: "http://" + h2}, 1)

	// 1) Initiate call from node1 to node2 (with small retries to avoid race)
	type callRespT struct {
		Ok    bool                   `json:"ok"`
		Call  map[string]interface{} `json:"call"`
		Error string                 `json:"error"`
	}
	var callResp callRespT
	for i := 0; i < 3; i++ {
		callResp = callRespT{}
		err = hc.postJSON("http://"+h1+"/media/call", map[string]string{
			"peer_id": ident2.PeerID,
			"sdp":     "dummy-offer",
			"type":    "audio",
		}, &callResp)
		if err == nil && callResp.Ok {
			break
		}
		time.Sleep(300 * time.Millisecond)
	}
	if err != nil || !callResp.Ok {
		t.Fatalf("media/call failed: %v, apiErr=%s", err, callResp.Error)
	}

	// 2) Poll callee for incoming call
	var calls2 struct {
		Calls []map[string]interface{} `json:"calls"`
	}
	dead = time.Now().Add(6 * time.Second)
	var incomingID string
	for {
		_ = hc.getJSON("http://"+h2+"/media/calls?direction=incoming&state=incoming", &calls2)
		if len(calls2.Calls) > 0 {
			if id, ok := calls2.Calls[0]["id"].(string); ok {
				incomingID = id
				break
			}
		}
		if time.Now().After(dead) {
			t.Fatalf("incoming call not observed")
		}
		time.Sleep(150 * time.Millisecond)
	}

	// 3) Answer on callee
	var ansResp map[string]interface{}
	err = hc.postJSON("http://"+h2+"/media/answer", map[string]string{
		"call_id": incomingID,
		"sdp":     "dummy-answer",
	}, &ansResp)
	if err != nil {
		t.Fatalf("media/answer err: %v", err)
	}

	// 4) Verify connected state on both sides
	checkConnected := func(base string, dir string) bool {
		var list struct{ Calls []map[string]interface{} `json:"calls"` }
		q := url.Values{}
		q.Set("state", "connected")
		if dir != "" {
			q.Set("direction", dir)
		}
		_ = hc.getJSON(base+"/media/calls?"+q.Encode(), &list)
		return len(list.Calls) > 0
	}
	dead = time.Now().Add(6 * time.Second)
	for {
		ok1 := checkConnected("http://"+h1, "outgoing")
		ok2 := checkConnected("http://"+h2, "incoming")
		if ok1 && ok2 {
			break
		}
		if time.Now().After(dead) {
			t.Fatalf("connected state not reached (caller:%v, callee:%v)", ok1, ok2)
		}
		time.Sleep(150 * time.Millisecond)
	}

	// 5) ICE candidates both directions
	var callIDCaller string
	if id, ok := callResp.Call["id"].(string); ok {
		callIDCaller = id
	}
	var iceResp map[string]interface{}
	_ = hc.postJSON("http://"+h1+"/media/candidate", map[string]any{
		"call_id":  callIDCaller,
		"candidate": map[string]any{"candidate": "a=candidate:1 1 UDP 2122252543 127.0.0.1 12345 typ host"},
	}, &iceResp)
	_ = hc.postJSON("http://"+h2+"/media/candidate", map[string]any{
		"call_id":  incomingID,
		"candidate": map[string]any{"candidate": "a=candidate:2 1 UDP 2122252543 127.0.0.1 12346 typ host"},
	}, &iceResp)
}
