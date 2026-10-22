package cli

import (
	"bufio"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestCredentialBearingHTTPNeverDumped(t *testing.T) {
	for _, target := range []string{"http://localhost/api/network/diagnostics", "http://localhost/api/http/request", "http://localhost/invoke/service.Method", "http://localhost/assets/a.js?secret=sentinel"} {
		for _, method := range []string{"GET", "POST"} {
			if mayDumpHTTP(httptest.NewRequest(method, target, nil)) {
				t.Fatalf("dumped %s %s", method, target)
			}
		}
	}
	if !mayDumpHTTP(httptest.NewRequest("GET", "http://localhost/assets/a.js", nil)) {
		t.Fatal("static asset debug disappeared")
	}
}

func TestLoggingWrappersPreserveFlushAndWriteDeadlines(t *testing.T) {
	proceed := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		tee := &teeWriter{w: []http.ResponseWriter{writer, httptest.NewRecorder()}}
		wrapped := &codeSniffer{w: tee}
		controller := http.NewResponseController(wrapped)
		if err := controller.SetWriteDeadline(time.Now().Add(2 * time.Second)); err != nil {
			t.Error(err)
		}
		_, _ = io.WriteString(wrapped, "first\n")
		if err := controller.Flush(); err != nil {
			t.Error(err)
		}
		<-proceed
		_, _ = io.WriteString(wrapped, "last\n")
	}))
	defer server.Close()
	response, err := server.Client().Get(server.URL)
	if err != nil {
		close(proceed)
		t.Fatal(err)
	}
	defer response.Body.Close()
	first, err := bufio.NewReader(response.Body).ReadString('\n')
	close(proceed)
	if err != nil || strings.TrimSpace(first) != "first" {
		t.Fatalf("first frame wasn't flushed: %q %v", first, err)
	}
}
