package cli

import (
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/shreyam1008/ProtoPeek/internal/thispc"
	"github.com/shreyam1008/ProtoPeek/standalone"
)

func validateWebBind(bindAddress string, allowNonLoopbackBind, unsafeAllowRemote bool) error {
	if allowNonLoopbackBind || unsafeAllowRemote || isLoopbackHost(bindAddress) {
		return nil
	}
	return fmt.Errorf("refusing non-loopback web bind %q without -allow-non-loopback-bind or -unsafe-allow-remote", bindAddress)
}

func localAccessHandler(next http.Handler, unsafeAllowRemote bool) http.Handler {
	if unsafeAllowRemote {
		return next
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isLoopbackHost(requestHostname(r.Host)) {
			http.Error(w, "ProtoPeek only accepts local browser requests", http.StatusForbidden)
			return
		}
		if origin := strings.TrimSpace(r.Header.Get("Origin")); origin != "" {
			parsed, err := url.Parse(origin)
			if err != nil || parsed.Host == "" || !sameHTTPHost(parsed.Host, r.Host) {
				http.Error(w, "ProtoPeek rejected a cross-origin request", http.StatusForbidden)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func localThisPCService(unsafeAllowRemote bool) standalone.ThisPCService {
	if unsafeAllowRemote {
		return nil
	}
	return thispc.NewService()
}

func requestHostname(hostport string) string {
	hostport = strings.TrimSpace(hostport)
	if host, _, err := net.SplitHostPort(hostport); err == nil {
		return host
	}
	return strings.Trim(hostport, "[]")
}

func isLoopbackHost(host string) bool {
	host = strings.TrimSuffix(requestHostname(host), ".")
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func sameHTTPHost(left, right string) bool {
	return strings.EqualFold(strings.TrimSuffix(left, "."), strings.TrimSuffix(right, "."))
}
