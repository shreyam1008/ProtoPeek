package standalone

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeJSONRequestAcceptsMediaTypeParametersAndBoundsInput(t *testing.T) {
	t.Parallel()

	t.Run("parameters", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"ok":true}`))
		req.Header.Set("Content-Type", "application/json; charset=utf-8")
		res := httptest.NewRecorder()
		var body struct {
			OK bool `json:"ok"`
		}
		if !decodeJSONRequest(res, req, 64, &body) || !body.OK {
			t.Fatalf("decode failed: status=%d body=%q", res.Code, res.Body.String())
		}
	})

	t.Run("limit", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"value":"`+strings.Repeat("x", 128)+`"}`))
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		var body map[string]string
		if decodeJSONRequest(res, req, 32, &body) {
			t.Fatal("oversized request unexpectedly decoded")
		}
		if res.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("status = %d, want %d", res.Code, http.StatusRequestEntityTooLarge)
		}
	})

	t.Run("trailing data crosses limit", func(t *testing.T) {
		body := `{"ok":true}` + strings.Repeat(" ", 64)
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		var decoded map[string]bool
		if decodeJSONRequest(res, req, int64(len(`{"ok":true}`)+8), &decoded) {
			t.Fatal("oversized trailing data unexpectedly decoded")
		}
		if res.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("status = %d, want %d", res.Code, http.StatusRequestEntityTooLarge)
		}
	})
}
