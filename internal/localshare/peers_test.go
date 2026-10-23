package localshare

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestManualConnectRecoversDiscoveryCapacity(t *testing.T) {
	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintf(w, `{"protocol":%q,"name":"Untrusted receiver name"}`, protocol)
	}))
	defer receiver.Close()
	hash := sha256.Sum256(receiver.Certificate().Raw)
	fingerprint := hex.EncodeToString(hash[:])
	address := strings.TrimPrefix(receiver.URL, "https://")

	for _, scenario := range []string{"stale discovery", "full discovery", "mixed capacity", "full manual", "reconnect full manual"} {
		t.Run(scenario, func(t *testing.T) {
			s := New()
			// Connect admission is independent of the discovery listener. The target
			// above is a real loopback TLS receiver, checked against its exact pin.
			s.server = &http.Server{}
			now := time.Now()
			oldest := fmt.Sprintf("%064x", 1)
			for i := range maxPeers {
				id := fmt.Sprintf("%064x", i+1)
				seen := now.Add(time.Duration(i-maxPeers) * time.Second)
				manual := scenario == "full manual" || scenario == "reconnect full manual" || scenario == "mixed capacity" && i > 0
				if scenario == "stale discovery" {
					seen = now.Add(-4 * time.Minute)
				}
				s.peers[id] = Peer{ID: id, Name: "Self-reported announcement", Address: "192.0.2.1:53318", Seen: seen, Manual: manual}
			}
			if scenario == "reconnect full manual" {
				delete(s.peers, oldest)
				s.peers[fingerprint] = Peer{ID: fingerprint, Name: "Old name", Address: "192.0.2.2:53318", Manual: true}
			}
			peer, err := s.Connect(context.Background(), address, fingerprint)
			if scenario == "full manual" {
				if err == nil || !strings.Contains(err.Error(), "Connected device limit") || len(s.peers) != maxPeers {
					t.Fatalf("manual cap was not preserved: peer=%+v count=%d err=%v", peer, len(s.peers), err)
				}
				return
			}
			if err != nil || !peer.Manual || peer.ID != fingerprint || peer.Address != address {
				t.Fatalf("explicit pinned connection failed: %+v, %v", peer, err)
			}
			if len(s.peers) > maxPeers || s.peers[fingerprint] != peer {
				t.Fatalf("manual admission exceeded capacity or lost peer: %d", len(s.peers))
			}
			if scenario == "stale discovery" {
				if len(s.peers) != 1 {
					t.Fatalf("Connect did not prune stale discoveries without Snapshot: %d", len(s.peers))
				}
			} else if _, remains := s.peers[oldest]; remains {
				t.Fatal("oldest discovery was not evicted for manual connection")
			}
			if scenario == "mixed capacity" {
				for i := 2; i <= maxPeers; i++ {
					if !s.peers[fmt.Sprintf("%064x", i)].Manual {
						t.Fatal("manual peer was evicted instead of an announcement")
					}
				}
			}
		})
	}
}
