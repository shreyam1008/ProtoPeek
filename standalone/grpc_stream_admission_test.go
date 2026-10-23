package standalone

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGRPCStreamAdmissionReservesUnaryCapacityAndSharesTotal(t *testing.T) {
	t.Parallel()
	admission := newGRPCInvokeAdmission()
	entered := make(chan struct{}, 8)
	release := make(chan struct{})
	done := make(chan struct{}, 8)
	hold := http.HandlerFunc(func(http.ResponseWriter, *http.Request) { entered <- struct{}{}; <-release })
	for index := range 8 {
		if index == 4 {
			request := httptest.NewRequest(http.MethodPost, "/invoke/test", nil)
			request.Header.Set("Accept", "application/x-ndjson")
			response := httptest.NewRecorder()
			admission.serveHTTP("gRPC invocation", response, request, hold)
			if response.Code != http.StatusTooManyRequests {
				t.Fatalf("fifth stream consumed reserved unary capacity: %d", response.Code)
			}
		}
		request := httptest.NewRequest(http.MethodPost, "/invoke/test", nil)
		if index < 4 {
			request.Header.Set("Accept", "application/x-ndjson")
		}
		go func() {
			admission.serveHTTP("gRPC invocation", httptest.NewRecorder(), request, hold)
			done <- struct{}{}
		}()
		<-entered
	}
	for _, accept := range []string{"application/x-ndjson", "application/json"} {
		request := httptest.NewRequest(http.MethodPost, "/invoke/test", nil)
		request.Header.Set("Accept", accept)
		response := httptest.NewRecorder()
		admission.serveHTTP("gRPC invocation", response, request, http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("over-capacity invocation admitted") }))
		if response.Code != http.StatusTooManyRequests {
			t.Fatalf("Accept %q: status %d", accept, response.Code)
		}
	}
	close(release)
	for range 8 {
		<-done
	}
	request := httptest.NewRequest(http.MethodPost, "/invoke/test", nil)
	request.Header.Set("Accept", "application/x-ndjson")
	response := httptest.NewRecorder()
	admission.serveHTTP("gRPC invocation", response, request, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	if response.Code != http.StatusNoContent {
		t.Fatalf("capacity not released: %d", response.Code)
	}
}
