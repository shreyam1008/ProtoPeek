package standalone

import (
	"encoding/json"
	"errors"
	"github.com/shreyam1008/ProtoPeek/internal/ipattribution"
	"net/http"
)

func registerIPAttribution(mux *http.ServeMux) {
	client, initErr := ipattribution.New()
	limiter := newAdmissionLimiter(1)
	operation := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if initErr != nil {
			http.Error(w, "IP attribution unavailable", http.StatusServiceUnavailable)
			return
		}
		var input struct {
			Addresses             []string `json:"addresses"`
			AcknowledgeThirdParty bool     `json:"acknowledgeThirdParty"`
		}
		if !decodeStrictTransferJSON(w, r, 8<<10, &input) {
			return
		}
		if !input.AcknowledgeThirdParty {
			http.Error(w, "Acknowledge sending public addresses to ipwho.is", 400)
			return
		}
		result, err := client.Enrich(r.Context(), input.Addresses)
		if err != nil {
			code := 502
			if errors.Is(err, ipattribution.ErrInvalid) {
				code = 400
			}
			http.Error(w, err.Error(), code)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(result)
	})
	mux.HandleFunc("/api/network/attribution", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if validateAdmittedPOST(w, r) {
			limiter.serveHTTP("IP attribution", w, r, operation)
		}
	})
}
