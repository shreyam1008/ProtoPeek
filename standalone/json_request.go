package standalone

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
)

func decodeJSONRequest(w http.ResponseWriter, r *http.Request, maxBytes int64, dst any) bool {
	contentType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || !strings.EqualFold(contentType, "application/json") {
		http.Error(w, "Request must use application/json", http.StatusUnsupportedMediaType)
		return false
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(dst); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			http.Error(w, "Request body is too large", http.StatusRequestEntityTooLarge)
			return false
		}
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return false
	}

	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			http.Error(w, "Request body is too large", http.StatusRequestEntityTooLarge)
			return false
		}
		http.Error(w, "Request body must contain one JSON object", http.StatusBadRequest)
		return false
	}
	return true
}
