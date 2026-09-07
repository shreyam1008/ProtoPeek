package standalone

import (
	"github.com/shreyam1008/ProtoPeek/internal/tailnet"
	"net/http"
)

func registerTailnet(mux *http.ServeMux) {
	service := tailnet.New()
	admission := newAdmissionLimiter(1)
	registerTransferConfigPOST(mux, admission, "/api/tailnet/inspect", "Tailscale inspection", func(w http.ResponseWriter, r *http.Request) {
		if !requireEmptyTransferBody(w, r) {
			return
		}
		result, err := service.Inspect(r.Context())
		if err != nil {
			writeTransferError(w, err, http.StatusBadGateway)
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
		if err != nil {
			writeTransferError(w, err, http.StatusConflict)
			return
		}
		writeTransferJSON(w, http.StatusOK, result)
	})
}
