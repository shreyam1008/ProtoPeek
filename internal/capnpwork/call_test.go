package capnpwork

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"encoding/pem"
	"errors"
	"net"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/shreyam1008/ProtoPeek/testing/capnpfixture"
)

func rpcPeer(t *testing.T, secure bool) (string, string) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ca := ""
	if secure {
		httpFixture := httptest.NewTLSServer(nil)
		config := httpFixture.TLS.Clone()
		config.NextProtos = nil
		ca = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: config.Certificates[0].Certificate[0]}))
		httpFixture.Close()
		listener = tls.NewListener(listener, config)
	}
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		for {
			socket, err := listener.Accept()
			if err != nil {
				return
			}
			go capnpfixture.ServeConnection(socket)
		}
	}()
	return listener.Addr().String(), ca
}

func TestRPCFixtureEchoExactIntegersFailureAndCancellation(t *testing.T) {
	s, _ := fixtureSchema(t)
	address, _ := rpcPeer(t, false)
	input := CallRequest{Address: address, Transport: "tcp", InterfaceID: "0xb1529bf8e102de33", Ordinal: 0, TimeoutMs: 3000, Params: json.RawMessage(`{"value":` + exampleJSON + `}`)}
	result, err := s.Call(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if result.RemoteAddress != address || !strings.Contains(string(result.Result), `"unsigned":"18446744073709551615"`) {
		t.Fatalf("echo: %+v", result)
	}
	input.Ordinal, input.Params = 1, json.RawMessage(`{"a":"9007199254740993","b":7}`)
	result, err = s.Call(context.Background(), input)
	if err != nil || strings.TrimSpace(string(result.Result)) != `{"sum":"9007199254741000"}` {
		t.Fatalf("exact sum: %+v %v", result, err)
	}
	input.Ordinal, input.Params = 2, json.RawMessage(`{}`)
	if _, err := s.Call(context.Background(), input); err == nil || !strings.Contains(err.Error(), "deliberate QA RPC failure") {
		t.Fatalf("remote failure: %v", err)
	}
	input.Ordinal, input.Params, input.TimeoutMs = 3, json.RawMessage(`{"milliseconds":10000}`), 100
	started := time.Now()
	if _, err := s.Call(context.Background(), input); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("deadline: %v", err)
	}
	if time.Since(started) > time.Second {
		t.Fatal("deadline did not close the socket promptly")
	}
	input.TimeoutMs = 3000
	ctx, cancel := context.WithCancel(context.Background())
	timer := time.AfterFunc(50*time.Millisecond, cancel)
	defer timer.Stop()
	defer cancel()
	if _, err := s.Call(ctx, input); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel: %v", err)
	}
}

func TestRPCVerifiedTLSAndHostnameChecks(t *testing.T) {
	s, _ := fixtureSchema(t)
	address, ca := rpcPeer(t, true)
	input := CallRequest{Address: address, Transport: "tls", InterfaceID: "0xb1529bf8e102de33", Ordinal: 1, TimeoutMs: 3000, Params: json.RawMessage(`{"a":1,"b":2}`)}
	if _, err := s.Call(context.Background(), input); err == nil || !strings.Contains(err.Error(), "TLS verification") {
		t.Fatalf("untrusted certificate: %v", err)
	}
	input.RootCAPEM = ca
	result, err := s.Call(context.Background(), input)
	if err != nil || result.TLSVersion == "" || strings.TrimSpace(string(result.Result)) != `{"sum":"3"}` {
		t.Fatalf("verified TLS: %+v %v", result, err)
	}
	input.ServerName = "wrong.example"
	if _, err := s.Call(context.Background(), input); err == nil {
		t.Fatal("ignored hostname mismatch")
	}
}
