package cli

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDefaultLauncherReusesOnlyAuthenticatedOwnedInstance(t *testing.T) {
	directory := t.TempDir()
	instance, reused, err := acquireLauncherInstance(context.Background(), directory)
	if err != nil || instance == nil || reused != "" {
		t.Fatalf("acquire: %v %s", err, reused)
	}
	defer instance.close()
	server := httptest.NewServer(instance.handler(http.NotFoundHandler()))
	defer server.Close()
	if err := instance.publish(server.URL + "/"); err != nil {
		t.Fatal(err)
	}
	second, url, err := acquireLauncherInstance(context.Background(), directory)
	if err != nil || second != nil || url != server.URL+"/" {
		t.Fatalf("reuse: %v %s", err, url)
	}
	request := httptest.NewRequest("GET", instanceEndpoint, nil)
	response := httptest.NewRecorder()
	instance.handler(http.NotFoundHandler()).ServeHTTP(response, request)
	if response.Code != 404 || strings.Contains(response.Body.String(), instance.Token) {
		t.Fatal("identity was exposed without its secret")
	}
	instance.close()
	if _, err := os.Stat(filepath.Join(directory, "launcher-instance.json")); !os.IsNotExist(err) {
		t.Fatalf("owned metadata remains: %v", err)
	}
	third, _, err := acquireLauncherInstance(context.Background(), directory)
	if err != nil {
		t.Fatal(err)
	}
	third.close()
}

func TestLauncherRejectsUnsafeEndpointStateAndForeignServer(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "launcher-instance.json")
	for _, url := range []string{"https://127.0.0.1:80/", "http://example.com:80/", "http://127.0.0.1:80/path", "http://user@127.0.0.1:80/", "http://127.0.0.1:80/?x=y", "http://127.0.0.1:0/"} {
		if err := os.WriteFile(path, []byte(`{"url":"`+url+`","token":"`+strings.Repeat("a", 64)+`"}`), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := readLauncherInstance(path); err == nil {
			t.Fatalf("accepted %s", url)
		}
	}
	foreign := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		// A foreign echo server must not be mistaken for our authenticated instance.
		if request.Header.Get(instanceHeader) == strings.Repeat("a", 64) {
			t.Error("profile secret sent to an unverified listener")
		}
		_, _ = writer.Write([]byte(request.Header.Get(instanceHeader)))
	}))
	defer foreign.Close()
	if (&launcherInstance{URL: foreign.URL + "/", Token: strings.Repeat("a", 64)}).probe(context.Background()) {
		t.Fatal("reused unrelated listener")
	}
}

func TestLauncherStaleMetadataReplacedAfterLockReleased(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "launcher-instance.json")
	if err := os.WriteFile(path, []byte(`{"url":"http://127.0.0.1:1/","token":"`+strings.Repeat("a", 64)+`"}`), 0600); err != nil {
		t.Fatal(err)
	}
	instance, existing, err := acquireLauncherInstance(context.Background(), directory)
	if err != nil || existing != "" {
		t.Fatalf("stale acquire: %s %v", existing, err)
	}
	defer instance.close()
	if err := instance.publish("http://127.0.0.1:12345/"); err != nil {
		t.Fatal(err)
	}
	read, err := readLauncherInstance(path)
	if err != nil || read.Token == strings.Repeat("a", 64) {
		t.Fatal("did not replace stale owned state")
	}
}

func TestLauncherExplicitTargetIsNeverSilentlyReused(t *testing.T) {
	for _, target := range []string{"localhost:50051", "https://api.example.test:443", "http://127.0.0.1:8080"} {
		if reusableLauncherLaunch(true, target) {
			t.Fatalf("explicit target %s was discarded by launcher reuse", target)
		}
	}
}
