package standalone

import (
	"github.com/shreyam1008/ProtoPeek/internal/tailnet"
	"net/http"
)

func registerTailnet(mux *http.ServeMux) {
	registerTailnetService(mux, tailnet.New())
}

func registerTailnetService(mux *http.ServeMux, service *tailnet.Service) {
	admission := newAdmissionLimiter(1)
	registerTransferConfigPOST(mux, admission, "/api/tailnet/inspect", "Tailscale inspection", func(w http.ResponseWriter, r *http.Request) {
		if !requireEmptyTransferBody(w, r) {
			return
		}
		result, err := service.Inspect(r.Context())
		if err != nil {
			writeProviderError(w, err, http.StatusBadGateway, "Tailscale status could not be read. Check the installed client, daemon and permissions, then inspect again; no daemon state was inferred.")
			return
		}
		writeTransferJSON(w, http.StatusOK, result)
	})
	registerTransferConfigPOST(mux, admission, "/api/tailnet/action", "Tailscale operation", func(w http.ResponseWriter, r *http.Request) {
		var input tailnet.ActionRequest
		if !decodeStrictTransferJSON(w, r, 8<<10, &input) {
			return
		}
		result, err := service.Execute(r.Context(), input)
		if result.Outcome != "" {
			status := http.StatusOK
			if result.Outcome != "completed" {
				status = http.StatusConflict
			}
			writeTransferJSON(w, status, result)
			return
		}
		if err != nil {
			writeProviderError(w, err, http.StatusConflict, "Tailscale operation was not started. Refresh the client state, review the target and confirm the operation before retrying.")
			return
		}
		writeTransferJSON(w, http.StatusOK, result)
	})
}
