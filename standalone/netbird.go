package standalone

import (
	"context"
	"github.com/shreyam1008/ProtoPeek/internal/netbird"
	"net/http"
)

type NetBirdService interface {
	Inspect(context.Context) (netbird.Snapshot, error)
	Execute(context.Context, netbird.ActionRequest) (netbird.ActionResult, error)
}

func registerNetBird(mux *http.ServeMux, service NetBirdService) {
	if service == nil {
		return
	}
	admission := newAdmissionLimiter(1)
	registerTransferConfigPOST(mux, admission, "/api/netbird/inspect", "NetBird inspection", func(w http.ResponseWriter, r *http.Request) {
		if !requireEmptyTransferBody(w, r) {
			return
		}
		result, err := service.Inspect(r.Context())
		if err != nil {
			writeProviderError(w, err, http.StatusBadGateway, "NetBird status could not be read. Check the installed client, daemon and permissions, then inspect again; no daemon state was inferred.")
			return
		}
		writeTransferJSON(w, http.StatusOK, result)
	})
	registerTransferConfigPOST(mux, admission, "/api/netbird/action", "NetBird operation", func(w http.ResponseWriter, r *http.Request) {
		var input netbird.ActionRequest
		if !decodeStrictTransferJSON(w, r, 1024, &input) {
			return
		}
		result, err := service.Execute(r.Context(), input)
		if err != nil {
			writeProviderError(w, err, http.StatusConflict, "NetBird operation was not started. Inspect the client state, review the selected operation and confirm before retrying.")
			return
		}
		writeTransferJSON(w, http.StatusOK, result)
	})
}
