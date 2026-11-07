package standalone

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/shreyam1008/ProtoPeek/internal/bundledaria2"
	"github.com/shreyam1008/ProtoPeek/internal/extensionstore"
	"github.com/shreyam1008/ProtoPeek/internal/managedtools"
)

func registerManagedExtensions(mux *http.ServeMux) {
	mux.HandleFunc("/api/extensions/managed", func(w http.ResponseWriter, r *http.Request) {
		if !extensionReadRequest(w, r) {
			return
		}
		site := r.Header.Get("Sec-Fetch-Site")
		if !isLoopbackPeer(r.RemoteAddr) || hasForwardingHeaders(r) || (site != "" && site != "same-origin" && site != "none") {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		query, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil || strings.HasPrefix(r.URL.RawQuery, "&") || strings.HasSuffix(r.URL.RawQuery, "&") || strings.Contains(r.URL.RawQuery, "&&") || (r.URL.RawQuery != "" && (len(query) != 1 || len(query["id"]) != 1 || !extensionstore.IsKnown(query.Get("id")))) {
			http.Error(w, "Choose one known managed extension", http.StatusBadRequest)
			return
		}
		manager, err := managedtools.New()
		if err != nil {
			http.Error(w, "Managed extensions unavailable", http.StatusServiceUnavailable)
			return
		}
		if r.URL.RawQuery == "" {
			writeTransferJSON(w, http.StatusOK, extensionstore.Inventory(manager))
			return
		}
		tool, err := extensionstore.Status(manager, query.Get("id"))
		if err != nil {
			http.Error(w, "Managed extension unavailable", http.StatusBadRequest)
			return
		}
		writeTransferJSON(w, http.StatusOK, tool)
	})
	admission := newAdmissionLimiter(2)
	for _, action := range []string{"install", "remove"} {
		action := action
		registerTransferConfigPOST(mux, admission, "/api/extensions/managed/"+action, "manage extension", func(w http.ResponseWriter, r *http.Request) {
			var input struct {
				ID string `json:"id"`
			}
			if !decodeStrictTransferJSON(w, r, 1024, &input) {
				return
			}
			if extensionstore.IsMedia(input.ID) {
				http.Error(w, "Manage media tools in Files using the media service", http.StatusBadRequest)
				return
			}
			if !extensionstore.IsKnown(input.ID) {
				http.Error(w, "Choose one known managed extension", http.StatusBadRequest)
				return
			}
			manager, err := managedtools.New()
			if err != nil {
				http.Error(w, "Managed extensions unavailable", http.StatusServiceUnavailable)
				return
			}
			tool, err := extensionstore.Mutate(r.Context(), manager, action, input.ID)
			if err != nil {
				switch {
				case errors.Is(err, context.Canceled):
					http.Error(w, "Operation cancelled", 499)
				case errors.Is(err, managedtools.ErrBusy):
					message := "Stop the running companion or wait for the current operation, then try again."
					if input.ID == "aria2" {
						message = "Wait for the current operation or save the queue and stop Downloader in Settings, then try again."
					} else if input.ID == "cloudflared" {
						message = "Wait for the current operation or stop the owned Quick Tunnel in Share a local service, then try again."
					}
					http.Error(w, message, http.StatusConflict)
				case errors.Is(err, os.ErrPermission):
					http.Error(w, "Check the permissions on the local companion directory and retry.", http.StatusConflict)
				case errors.Is(err, managedtools.ErrUnavailable):
					http.Error(w, "This companion is unavailable on this platform", http.StatusServiceUnavailable)
				case errors.Is(err, managedtools.ErrStorageUnsupported):
					http.Error(w, "This filesystem cannot safely install the companion. Use a local cache on a filesystem that supports atomic rename.", http.StatusConflict)
				case errors.Is(err, managedtools.ErrInvalid):
					http.Error(w, "Local companion files failed verification; nothing was replaced", http.StatusConflict)
				case errors.Is(err, bundledaria2.ErrCompanionMissing), errors.Is(err, bundledaria2.ErrCompanionInvalid):
					http.Error(w, bundledaria2.CompanionMessage(err), http.StatusConflict)
				default:
					http.Error(w, "The companion operation could not complete; check your connection and try again", http.StatusBadGateway)
				}
				return
			}
			writeTransferJSON(w, http.StatusOK, tool)
		})
	}
}
