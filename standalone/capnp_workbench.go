package standalone

import (
	"encoding/base64"
	"errors"
	"net/http"

	"github.com/shreyam1008/ProtoPeek/internal/capnpwork"
)

type capnpSchemaInput struct {
	SchemaBase64 string                 `json:"schemaBase64"`
	Root         string                 `json:"root"`
	Files        []capnpwork.SourceFile `json:"files"`
}

func decodeCapnpSchema(encoded string) ([]byte, error) {
	if len(encoded) > base64.StdEncoding.EncodedLen(capnpwork.MaxSchemaBytes) {
		return nil, errors.New("compiled schema exceeds 2 MiB")
	}
	raw, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil || len(raw) == 0 {
		return nil, errors.New("choose a compiled schema or upload .capnp source files")
	}
	return raw, nil
}

func registerCapnpWorkbench(mux *http.ServeMux) {
	limiter := newAdmissionLimiter(2)
	mux.HandleFunc("/api/capnp/capabilities", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		writeTransferJSON(w, http.StatusOK, capnpwork.CompilerCapability())
	})
	operations := map[string]http.HandlerFunc{
		"schema": func(w http.ResponseWriter, r *http.Request) {
			var input capnpSchemaInput
			if !decodeStrictTransferJSON(w, r, 4<<20, &input) {
				return
			}
			var raw []byte
			var err error
			if len(input.Files) > 0 {
				if input.SchemaBase64 != "" {
					http.Error(w, "Choose source files or a compiled schema", http.StatusBadRequest)
					return
				}
				raw, err = capnpwork.Compile(r.Context(), input.Root, input.Files)
			} else {
				if input.Root != "" {
					http.Error(w, "Root requires uploaded source files", http.StatusBadRequest)
					return
				}
				raw, err = decodeCapnpSchema(input.SchemaBase64)
			}
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			schema, err := capnpwork.Parse(raw)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			defer schema.Close()
			description, err := schema.Describe()
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			writeTransferJSON(w, http.StatusOK, struct {
				capnpwork.Description
				SchemaBase64 string `json:"schemaBase64"`
			}{description, base64.StdEncoding.EncodeToString(raw)})
		},
		"call": func(w http.ResponseWriter, r *http.Request) {
			var input struct {
				SchemaBase64 string `json:"schemaBase64"`
				capnpwork.CallRequest
			}
			if !decodeStrictTransferJSON(w, r, 4<<20, &input) {
				return
			}
			raw, err := decodeCapnpSchema(input.SchemaBase64)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			schema, err := capnpwork.Parse(raw)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			defer schema.Close()
			result, err := schema.Call(r.Context(), input.CallRequest)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadGateway)
				return
			}
			writeTransferJSON(w, http.StatusOK, result)
		},
	}
	for name, operation := range operations {
		mux.HandleFunc("/api/capnp/"+name, func(w http.ResponseWriter, r *http.Request) {
			if validateAdmittedPOST(w, r) {
				limiter.serveHTTP("Cap'n Proto", w, r, operation)
			}
		})
	}
}
