package standalone

import (
	"github.com/shreyam1008/ProtoPeek/internal/packetwork"
	"io"
	"net/http"
)

func registerPacketWorkbench(mux *http.ServeMux) {
	limiter := newAdmissionLimiter(1)
	mux.HandleFunc("/api/packets/capabilities", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		_, err := packetwork.FindCaptureTool()
		reason := ""
		if err != nil {
			reason = err.Error()
		}
		writeTransferJSON(w, 200, struct {
			Available bool   `json:"available"`
			Reason    string `json:"reason"`
		}{err == nil, reason})
	})
	operations := map[string]http.HandlerFunc{
		"analyze": func(w http.ResponseWriter, r *http.Request) {
			raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, packetwork.MaxFileBytes))
			if err != nil {
				http.Error(w, "Capture file exceeds 16 MiB or could not be read", 400)
				return
			}
			result, err := packetwork.Analyze(r.Context(), raw)
			if err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			writeTransferJSON(w, 200, result)
		},
		"interfaces": func(w http.ResponseWriter, r *http.Request) {
			var input struct{}
			if !decodeStrictTransferJSON(w, r, 1024, &input) {
				return
			}
			path, err := packetwork.FindCaptureTool()
			if err != nil {
				http.Error(w, err.Error(), http.StatusServiceUnavailable)
				return
			}
			result, err := packetwork.CaptureInterfaces(r.Context(), path)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadGateway)
				return
			}
			writeTransferJSON(w, 200, result)
		},
		"capture": func(w http.ResponseWriter, r *http.Request) {
			var input packetwork.CaptureRequest
			if !decodeStrictTransferJSON(w, r, 4096, &input) {
				return
			}
			if _, err := packetwork.PlanCapture(input); err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			path, err := packetwork.FindCaptureTool()
			if err != nil {
				http.Error(w, err.Error(), http.StatusServiceUnavailable)
				return
			}
			result, err := packetwork.Capture(r.Context(), path, input)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadGateway)
				return
			}
			writeTransferJSON(w, 200, result)
		},
	}
	for operation, handler := range operations {
		mux.HandleFunc("/api/packets/"+operation, func(w http.ResponseWriter, r *http.Request) {
			if validateAdmittedPOST(w, r) {
				limiter.serveHTTP("Packet inspection", w, r, handler)
			}
		})
	}
}
