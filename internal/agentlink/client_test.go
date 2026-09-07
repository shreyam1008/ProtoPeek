package agentlink

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConnectionValidationAndRoundTrip(t *testing.T) {
	for _, raw := range []string{"https://127.0.0.1:8844", "http://evil.example:8844", "http://localhost:8844", "http://127.0.0.1", "http://name:secret@127.0.0.1:8844", "http://127.0.0.1:8844?token=secret"} {
		if ValidateURL(raw) == nil {
			t.Fatal("unsafe URL accepted", raw)
		}
	}
	for _, raw := range []string{"http://127.0.0.1:8844", "http://[::1]:8844/base"} {
		if err := ValidateURL(raw); err != nil {
			t.Fatal(err)
		}
	}
	path := filepath.Join(t.TempDir(), "private", "connection.json")
	t.Setenv("PROTOPEEK_AGENT_CONNECTION", path)
	for _, token := range []string{strings.Repeat("a", 64), strings.Repeat("b", 64)} {
		want := Connection{"http://127.0.0.1:8844", token}
		if err := SaveConnection(path, want); err != nil {
			t.Fatal(err)
		}
		got, err := LoadConnection()
		if err != nil || got != want {
			t.Fatal(got, err)
		}
	}
	if err := os.WriteFile(path, []byte(strings.Repeat("x", 5000)), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadConnection(); err == nil {
		t.Fatal("oversize connection accepted")
	}
}
func TestClientDoesNotFollowRedirectsOrEnvironmentProxy(t *testing.T) {
	contacted := false
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { contacted = true }))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer source.Close()
	client, err := NewClient(Connection{source.URL, strings.Repeat("a", 64)})
	if err != nil {
		t.Fatal(err)
	}
	defer client.HTTP.CloseIdleConnections()
	if client.HTTP.Transport.(*http.Transport).Proxy != nil {
		t.Fatal("environment proxy enabled")
	}
	_, err = client.Call(context.Background(), Call{Name: "workbench_info", Arguments: json.RawMessage(`{}`)})
	if err == nil || contacted {
		t.Fatal("redirect followed", err)
	}
}
func TestCatalogRejectsUnknownAndMalformedInputs(t *testing.T) {
	for _, input := range []string{`null`, `[]`, `{"extra":true}`, `{"url":"x"}`} {
		if _, err := Lookup("http_request", json.RawMessage(input)); err == nil {
			t.Fatal(input)
		}
	}
	if _, err := Lookup("shell", json.RawMessage(`{}`)); err == nil {
		t.Fatal("arbitrary command admitted")
	}
	if _, err := Lookup("http_request", json.RawMessage(`{"url":"http://127.0.0.1","method":"GET"}`)); err != nil {
		t.Fatal(err)
	}
}
