package publishsession

import (
	"context"
	"errors"
	"net"
	"net/http"
	"time"
)

func verifyEndpoint(ctx context.Context, endpoint string) (int, error) {
	transport := &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 2 * time.Second}).DialContext, TLSHandshakeTimeout: 2 * time.Second, ResponseHeaderTimeout: 2 * time.Second, MaxResponseHeaderBytes: 16 << 10, DisableKeepAlives: true}
	return verifyWithTransport(ctx, endpoint, transport)
}
func verifyWithTransport(ctx context.Context, endpoint string, transport *http.Transport) (int, error) {
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 3 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	request, err := http.NewRequestWithContext(ctx, http.MethodHead, endpoint, nil)
	if err != nil || request.URL.Scheme != "https" || request.URL.User != nil || request.URL.RawQuery != "" || request.URL.Fragment != "" {
		return 0, errors.New("invalid reported HTTPS endpoint")
	}
	response, err := client.Do(request)
	if err != nil {
		return 0, errors.New("endpoint HTTPS check did not complete")
	}
	defer response.Body.Close()
	return response.StatusCode, nil
}
