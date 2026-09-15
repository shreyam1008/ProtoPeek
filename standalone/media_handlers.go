package standalone

import (
	"net/http"

	"github.com/shreyam1008/ProtoPeek/internal/media"
)

// WithMediaService shares one local queue across console handlers.
func WithMediaService(service *media.Service) HandlerOption {
	return optFunc(func(opts *handlerOptions) { opts.mediaService = service })
}

func registerMediaHandlers(mux *http.ServeMux, service *media.Service) {
	if service == nil {
		mux.HandleFunc("/api/media/", func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "Media downloads require writable local state and exclusive queue ownership; they are unavailable in remote mode.", http.StatusServiceUnavailable)
		})
		return
	}
	mux.HandleFunc("/api/media/snapshot", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if !isLoopbackPeer(r.RemoteAddr) || hasForwardingHeaders(r) {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		writeTransferJSON(w, http.StatusOK, service.Snapshot())
	})
	admission := newAdmissionLimiter(3)
	registerTransferConfigPOST(mux, admission, "/api/media/install", "install media engine", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Engine string `json:"engine"`
		}
		if !decodeStrictTransferJSON(w, r, 1024, &input) {
			return
		}
		if err := service.Install(r.Context(), input.Engine); err != nil {
			writeTransferError(w, err, http.StatusBadRequest)
			return
		}
		writeTransferJSON(w, http.StatusOK, service.Snapshot())
	})
	registerTransferConfigPOST(mux, admission, "/api/media/inspect", "inspect media", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			URL string `json:"url"`
		}
		if !decodeStrictTransferJSON(w, r, 16<<10, &input) {
			return
		}
		preview, err := service.Inspect(r.Context(), input.URL)
		if err != nil {
			writeTransferError(w, err, http.StatusBadRequest)
			return
		}
		writeTransferJSON(w, http.StatusOK, preview)
	})

	registerTransferConfigPOST(mux, admission, "/api/media/add", "queue media", func(w http.ResponseWriter, r *http.Request) {
		var input media.Request
		if !decodeStrictTransferJSON(w, r, 16<<10, &input) {
			return
		}
		job, err := service.Add(input)
		if err != nil {
			writeTransferError(w, err, http.StatusBadRequest)
			return
		}
		writeTransferJSON(w, http.StatusOK, job)
	})
	registerTransferConfigPOST(mux, admission, "/api/media/action", "control media job", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			ID     string `json:"id"`
			Action string `json:"action"`
		}
		if !decodeStrictTransferJSON(w, r, 1024, &input) {
			return
		}
		if err := service.Action(input.ID, input.Action); err != nil {
			writeTransferError(w, err, http.StatusConflict)
			return
		}
		writeTransferJSON(w, http.StatusOK, service.Snapshot())
	})
}
