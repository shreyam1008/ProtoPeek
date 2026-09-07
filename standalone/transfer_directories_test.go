package standalone

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func realTransferTestDirectory(t *testing.T) string {
	t.Helper()
	// macOS exposes its temporary directory through /var -> /private/var.
	// The picker intentionally requires a real path rather than following links.
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return root
}

func TestTransferDirectoryListing(t *testing.T) {
	root := realTransferTestDirectory(t)
	for _, name := range []string{"alpha", "Folder with spaces"} {
		if err := os.Mkdir(filepath.Join(root, name), 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "private.txt"), []byte("never read or returned"), 0600); err != nil {
		t.Fatal(err)
	}
	got, err := listTransferDirectories(context.Background(), root)
	if err != nil || len(got.Directories) != 2 || got.Directories[0].Name != "alpha" || got.Path != root || got.Parent != filepath.Dir(root) {
		t.Fatalf("listing = %+v, %v", got, err)
	}
	for _, path := range []string{"relative", `\\server\share`, filepath.Join(root, "private.txt")} {
		if _, err := listTransferDirectories(context.Background(), path); err == nil {
			t.Fatalf("accepted %s", path)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := listTransferDirectories(ctx, root); err == nil {
		t.Fatal("ignored cancellation")
	}
	for i := 0; i < 513; i++ {
		if err := os.Mkdir(filepath.Join(root, fmt.Sprint(i)), 0700); err != nil {
			t.Fatal(err)
		}
	}
	got, err = listTransferDirectories(context.Background(), root)
	if err != nil || !got.Truncated || len(got.Directories) != 512 {
		t.Fatalf("unbounded listing: %+v %v", got, err)
	}
}

func TestTransferDirectoryAPIRequiresLocalCSRFAndStrictBody(t *testing.T) {
	// The picker also serves Taildrop when no transfer engine is injected.
	handler := Handler(nil, "", nil, nil)
	cookie := handlerCSRFCookie(t, handler)
	body, _ := json.Marshal(map[string]string{"path": realTransferTestDirectory(t)})
	for _, tc := range []struct {
		peer, body      string
		csrf, forwarded bool
		want            int
	}{
		{"127.0.0.1:1234", string(body), true, false, 200},
		{"127.0.0.1:1234", string(body), false, false, 401},
		{"203.0.113.4:1234", string(body), true, false, 403},
		{"127.0.0.1:1234", string(body), true, true, 403},
		{"127.0.0.1:1234", `{"path":"","create":true}`, true, false, 400},
	} {
		r := httptest.NewRequest("POST", "/api/transfers/directories", strings.NewReader(tc.body))
		r.RemoteAddr = tc.peer
		r.Header.Set("Content-Type", "application/json")
		if tc.csrf {
			r.AddCookie(cookie)
			r.Header.Set(csrfHeaderName, cookie.Value)
		}
		if tc.forwarded {
			r.Header.Set("Forwarded", "for=203.0.113.4")
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != tc.want {
			t.Fatalf("%+v: %d %s", tc, w.Code, w.Body.String())
		}
	}
}
