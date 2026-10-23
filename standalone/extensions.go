package standalone

import (
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/shreyam1008/ProtoPeek/internal/extensions"
)

type extensionTransferConfig interface {
	ConfiguredAria2Path() (string, error)
}

func registerExtensions(mux *http.ServeMux, service TransferService) {
	registerExtensionsWithInspector(mux, service, extensions.Inspect, extensions.InspectOne)
}

func registerExtensionsWithInspector(mux *http.ServeMux, service TransferService, inspect func(extensions.Options) extensions.Snapshot, inspectOne func(string, extensions.Options) (extensions.Snapshot, error)) {
	// Filesystem-backed PATH/stat calls cannot be interrupted. A cancelled HTTP
	// request detaches, but its worker owns this slot until the lookup returns.
	slots := make(chan struct{}, 2)
	mux.HandleFunc("/api/extensions/catalog", func(w http.ResponseWriter, r *http.Request) {
		if !extensionReadRequest(w, r) {
			return
		}
		if r.URL.RawQuery != "" {
			http.Error(w, "extension catalog does not accept query parameters", http.StatusBadRequest)
			return
		}
		writeTransferJSON(w, http.StatusOK, extensions.Metadata())
	})
	mux.HandleFunc("/api/extensions", func(w http.ResponseWriter, r *http.Request) {
		if !extensionReadRequest(w, r) {
			return
		}
		id, err := extensionQueryID(r.URL.RawQuery)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if r.Context().Err() != nil {
			http.Error(w, "extension lookup request cancelled", 499)
			return
		}
		if id == "chatgpt" {
			// This fixed external companion produces metadata only. It must not
			// compete with filesystem-backed lookups or use their injected worker.
			value, _ := extensions.InspectOne(id, extensions.Options{})
			writeTransferJSON(w, http.StatusOK, value)
			return
		}
		select {
		case slots <- struct{}{}:
		default:
			w.Header().Set("Retry-After", "1")
			http.Error(w, "two extension lookups are still running; retry after they finish", http.StatusTooManyRequests)
			return
		}
		type inspection struct {
			snapshot extensions.Snapshot
			err      error
		}
		completed := make(chan inspection, 1)
		go func() {
			result := inspection{}
			defer func() {
				if recover() != nil {
					result = inspection{err: errors.New("extension lookup failed")}
				}
				<-slots
				// Exactly one bounded completion, including after the caller detaches.
				completed <- result
			}()
			if r.Context().Err() != nil {
				return
			}
			options := extensions.Options{}
			if id == "" || id == "aria2" {
				if config, ok := service.(extensionTransferConfig); ok {
					options.Aria2ConfigKnown = true
					options.Aria2Path, options.Aria2ConfigError = config.ConfiguredAria2Path()
				}
			}
			if id == "" {
				result.snapshot = inspect(options)
			} else {
				result.snapshot, result.err = inspectOne(id, options)
			}
		}()
		select {
		case result := <-completed:
			if r.Context().Err() != nil {
				http.Error(w, "extension lookup request cancelled; no result retained", 499)
			} else if result.err != nil {
				http.Error(w, "extension lookup could not complete", http.StatusServiceUnavailable)
			} else {
				writeTransferJSON(w, http.StatusOK, result.snapshot)
			}
		case <-r.Context().Done():
			http.Error(w, "request cancelled locally; an in-progress filesystem lookup keeps its slot until it returns", 499)
		}
	})
}

func extensionReadRequest(w http.ResponseWriter, r *http.Request) bool {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return false
	}
	return true
}

func extensionQueryID(raw string) (string, error) {
	if raw == "" {
		return "", nil
	}
	query, err := url.ParseQuery(raw)
	if err != nil || strings.HasPrefix(raw, "&") || strings.HasSuffix(raw, "&") || strings.Contains(raw, "&&") || len(query) != 1 || len(query["id"]) != 1 || !extensions.KnownID(query.Get("id")) {
		return "", errors.New("use no query for the legacy snapshot, or exactly one allowlisted extension id")
	}
	return query.Get("id"), nil
}
