package standalone

import (
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/localshare"
)

func registerLocalShareHandlers(mux *http.ServeMux) {
	service := localshare.New()
	controls := newAdmissionLimiter(4)
	sends := newAdmissionLimiter(4)
	for _, action := range []string{"snapshot", "start", "stop", "discover", "connect", "decide", "cancel", "send"} {
		mux.HandleFunc("/api/local-share/"+action, func(w http.ResponseWriter, r *http.Request) {
			// A network-facing transfer listener never exposes these host controls.
			if !validateLoopbackAdmittedPOST(w, r) {
				return
			}
			w.Header().Set("Cache-Control", "no-store")
			handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if action == "send" {
					// The normal console read timeout must not cut off large files or
					// the wait for receiver acceptance. Cancellation still closes the body.
					_ = http.NewResponseController(w).SetReadDeadline(time.Time{})
					defer r.Body.Close()
					body := &localShareBody{ReadCloser: r.Body, controller: http.NewResponseController(w)}
					err := service.Send(r.Context(), r.URL.Query().Get("peer"), r.URL.Query().Get("name"), r.ContentLength, body)
					if err != nil {
						http.Error(w, err.Error(), http.StatusConflict)
						return
					}
					writeTransferJSON(w, 200, map[string]bool{"sent": true})
					return
				}
				var input struct {
					Name        string `json:"name"`
					Directory   string `json:"directory"`
					Address     string `json:"address"`
					Fingerprint string `json:"fingerprint"`
					ID          string `json:"id"`
					Accept      bool   `json:"accept"`
				}
				if !decodeStrictTransferJSON(w, r, 8192, &input) {
					return
				}
				var err error
				switch action {
				case "start":
					err = service.Start(input.Name, input.Directory, localshare.DefaultPort)
				case "stop":
					service.Stop()
				case "discover":
					err = service.Discover()
				case "connect":
					_, err = service.Connect(r.Context(), input.Address, input.Fingerprint)
				case "decide":
					err = service.Decide(input.ID, input.Accept)
				case "cancel":
					err = service.Cancel(input.ID)
				}
				if err != nil {
					http.Error(w, err.Error(), http.StatusConflict)
					return
				}
				writeTransferJSON(w, 200, service.Snapshot())
			})
			if action == "send" {
				sends.serveHTTP("send file", w, r, handler)
			} else {
				controls.serveHTTP("local transfer", w, r, handler)
			}
		})
	}
}

// net/http's Body.Close waits for a concurrent Read. A socket deadline must
// unblock that read first when cancellation comes from the job controls.
type localShareBody struct {
	io.ReadCloser
	controller *http.ResponseController
	mu         sync.Mutex
	closed     bool
}

func (body *localShareBody) Read(p []byte) (int, error) {
	body.mu.Lock()
	if body.closed {
		body.mu.Unlock()
		return 0, io.ErrClosedPipe
	}
	_ = body.controller.SetReadDeadline(time.Now().Add(30 * time.Second))
	body.mu.Unlock()
	return body.ReadCloser.Read(p)
}

func (body *localShareBody) Close() error {
	body.mu.Lock()
	body.closed = true
	_ = body.controller.SetReadDeadline(time.Now())
	body.mu.Unlock()
	return body.ReadCloser.Close()
}
