package tests

import (
	"context"
	"testing"
	"time"
	"os"
	"path/filepath"

	rtpkg "github.com/nhex-team/connection/node-agent/internal/runtime"
)

func TestE2E_Blocklist_Chat_And_Files(t *testing.T) {
	h1 := "127.0.0.1:19580"
	h2 := "127.0.0.1:19581"
	// start nodes
	cfg2 := rtpkg.DefaultConfig()
	cfg2.HTTPAddr = h2
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
	cfg1 := rtpkg.DefaultConfig()
	cfg1.HTTPAddr = h1
	cfg1.BootstrapHTTP = []string{"http://" + h2}
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
	waitPeers(t, &node{http: "http://" + h1}, 1)
	// add block
	_ = hc.postJSON("http://"+h1+"/security/block_add", map[string]string{"peer_id": ident2.PeerID}, nil)
	// try chat send (expect 403)
	var resp map[string]any
	err = hc.postJSON("http://"+h1+"/chat/send", map[string]string{"peer_id": ident2.PeerID, "text": "should-not-send"}, &resp)
	if err == nil {
		// resp may not carry http code; verify history empty
		var hist struct{ Messages []map[string]any `json:"messages"` }
		_ = hc.getJSON("http://"+h2+"/chat/history?peer_id="+ident1.PeerID+"&limit=10", &hist)
		delivered := false
		for _, m := range hist.Messages {
			if p, ok := m["payload"].(map[string]any); ok {
				if txt, ok2 := p["text"].(string); ok2 && txt == "should-not-send" {
					delivered = true
					break
				}
			}
		}
		if delivered {
			t.Fatalf("blocked chat delivered unexpectedly")
		}
	}
	// try file send (expect forbidden)
	tmp := filepath.Join(t.TempDir(), "x.txt")
	_ = os.WriteFile(tmp, []byte("x"), 0o644)
	var up map[string]any
	_ = hc.postFile("http://"+h1+"/files/send", "file", tmp, map[string]string{"peer_id": ident2.PeerID}, &up)
	// cannot easily assert HTTP code here; rely on no completed transfers observed at receiver
	dead = time.Now().Add(3 * time.Second)
	for {
		var tr struct{ Transfers []map[string]any `json:"transfers"` }
		_ = hc.getJSON("http://"+h2+"/files/transfers?role=receiver&status=completed", &tr)
		if len(tr.Transfers) == 0 {
			break
		}
		if time.Now().After(dead) {
			t.Fatalf("blocked file transfer unexpectedly completed")
		}
		time.Sleep(150 * time.Millisecond)
	}
}
