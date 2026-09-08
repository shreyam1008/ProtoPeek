package standalone

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/shreyam1008/ProtoPeek/internal/selfupdate"
)

func registerUpdates(mux *http.ServeMux, version string) {
	registerUpdateEngine(mux, selfupdate.New(version))
}
func registerUpdateEngine(mux *http.ServeMux, e *selfupdate.Engine) {
	mux.HandleFunc("/api/update/state", func(w http.ResponseWriter, r *http.Request) {
		if !agentAdmin(w, r, http.MethodGet) {
			return
		}
		_ = json.NewEncoder(w).Encode(e.Snapshot())
	})
	mux.HandleFunc("/api/update/check", func(w http.ResponseWriter, r *http.Request) {
		if !agentAdmin(w, r, http.MethodPost) {
			return
		}
		var input struct {
			Channel string `json:"channel"`
		}
		if !updateInput(w, r, &input) {
			return
		}
		if _, err := e.Check(r.Context(), input.Channel); err != nil {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		_ = json.NewEncoder(w).Encode(e.Snapshot())
	})
	mux.HandleFunc("/api/update/apply", func(w http.ResponseWriter, r *http.Request) {
		if !agentAdmin(w, r, http.MethodPost) {
			return
		}
		var input struct {
			ID      string `json:"id"`
			Confirm bool   `json:"confirm"`
		}
		if !updateInput(w, r, &input) {
			return
		}
		if !input.Confirm || input.ID == "" {
			http.Error(w, "review and confirm the checked release first", http.StatusBadRequest)
			return
		}
		if err := e.Apply(r.Context(), input.ID); err != nil {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		_ = json.NewEncoder(w).Encode(e.Snapshot())
	})
}
func updateInput(w http.ResponseWriter, r *http.Request, out any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		http.Error(w, "invalid update request", http.StatusBadRequest)
		return false
	}
	if err := d.Decode(new(any)); err != io.EOF {
		http.Error(w, "update request must contain one JSON object", http.StatusBadRequest)
		return false
	}
	return true
}
