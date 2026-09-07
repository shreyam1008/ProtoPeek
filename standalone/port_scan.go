package standalone

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/shreyam1008/ProtoPeek/internal/portscan"
)

func registerPortScanner(mux *http.ServeMux) {
	limiter := newAdmissionLimiter(2)
	operation := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input portscan.Request
		if !decodeJSONRequest(w, r, 16<<10, &input) {
			return
		}
		result, err := (portscan.Scanner{}).Scan(r.Context(), input)
		if err != nil {
			code := http.StatusBadGateway
			if errors.Is(err, portscan.ErrInvalid) {
				code = http.StatusBadRequest
			}
			http.Error(w, err.Error(), code)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		_ = json.NewEncoder(w).Encode(result)
	})
	mux.HandleFunc("/api/ports/scan", func(w http.ResponseWriter, r *http.Request) {
		if validateAdmittedPOST(w, r) {
			limiter.serveHTTP("Port scans", w, r, operation)
		}
	})
}
