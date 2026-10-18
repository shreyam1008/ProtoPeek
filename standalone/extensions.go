package standalone

import (
	"net/http"

	"github.com/shreyam1008/ProtoPeek/internal/extensions"
)

type extensionTransferConfig interface {
	ConfiguredAria2Path() (string, error)
}

func registerExtensions(mux *http.ServeMux, service TransferService) {
	mux.HandleFunc("/api/extensions", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		options := extensions.Options{}
		if config, ok := service.(extensionTransferConfig); ok {
			options.Aria2ConfigKnown = true
			options.Aria2Path, options.Aria2ConfigError = config.ConfiguredAria2Path()
		}
		w.Header().Set("Cache-Control", "no-store")
		writeTransferJSON(w, http.StatusOK, extensions.Inspect(options))
	})
}
