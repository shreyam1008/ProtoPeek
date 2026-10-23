package standalone

import (
	"net/http"

	"github.com/shreyam1008/ProtoPeek/internal/media"
)

// WithMediaService shares one local queue across console handlers.
func WithMediaService(service *media.Service) HandlerOption {
	return optFunc(func(opts *handlerOptions) {
		opts.mediaService = service
		opts.mediaServiceFactory = nil
	})
}

// WithMediaServiceFactory resolves a process-owned queue only after request
// admission. The caller owns its lifetime; this option never constructs it.
func WithMediaServiceFactory(factory func() (*media.Service, error)) HandlerOption {
	return optFunc(func(opts *handlerOptions) {
		opts.mediaService = nil
		opts.mediaServiceFactory = factory
	})
}

func registerMediaHandlers(mux *http.ServeMux, service *media.Service, factory func() (*media.Service, error)) {
	resolve := func(w http.ResponseWriter) *media.Service {
		if service != nil {
			return service
		}
		message := "Media downloads are disabled for this host. Use the safe local ProtoPeek launcher."
		if factory != nil {
			resolved, err := factory()
			if err == nil && resolved != nil {
				return resolved
			}
			message = "Media downloader could not be initialized."
			if err != nil {
				message = "Media downloader unavailable: " + err.Error()
			}
		}
		http.Error(w, message, http.StatusServiceUnavailable)
		return nil
	}
	mux.HandleFunc("/api/media/snapshot", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		site := r.Header.Get("Sec-Fetch-Site")
		if !isLoopbackPeer(r.RemoteAddr) || hasForwardingHeaders(r) || (site != "" && site != "same-origin" && site != "none") {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if resolved := resolve(w); resolved != nil {
			writeTransferJSON(w, http.StatusOK, resolved.Snapshot())
		}
	})
	admission := newAdmissionLimiter(3)
	registerTransferConfigPOST(mux, admission, "/api/media/install", "install media engine", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Engine string `json:"engine"`
		}
		if !decodeStrictTransferJSON(w, r, 1024, &input) {
			return
		}
		service := resolve(w)
		if service == nil {
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
		service := resolve(w)
		if service == nil {
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
		service := resolve(w)
		if service == nil {
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
		service := resolve(w)
		if service == nil {
			return
		}
		if err := service.Action(input.ID, input.Action); err != nil {
			writeTransferError(w, err, http.StatusConflict)
			return
		}
		writeTransferJSON(w, http.StatusOK, service.Snapshot())
	})
}
