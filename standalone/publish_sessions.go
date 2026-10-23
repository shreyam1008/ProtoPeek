package standalone

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/shreyam1008/ProtoPeek/internal/publishsession"
)

// PublishSessionService is opt-in for local launchers. Creating a handler does
// not inspect tools, start processes, or change any publishing state.
type PublishSessionService interface {
	Preview(context.Context, publishsession.Request) (publishsession.Preview, error)
	Start(context.Context, publishsession.StartRequest) (publishsession.Session, error)
	Inspect(context.Context) (publishsession.Snapshot, error)
	Stop(context.Context, string) (publishsession.Session, error)
	Verify(context.Context, string) (publishsession.Session, error)
}

func registerPublishSessionHandlers(mux *http.ServeMux, service PublishSessionService) {
	admission := newAdmissionLimiter(2)
	for _, operation := range []string{"preview", "start", "status", "stop", "verify"} {
		registerTransferConfigPOST(mux, admission, "/api/publish/"+operation, "Publishing session", func(w http.ResponseWriter, r *http.Request) {
			if service == nil {
				writePublishSessionError(w, errPublishUnavailable, http.StatusServiceUnavailable)
				return
			}
			var result any
			var err error
			switch operation {
			case "preview":
				var input publishsession.Request
				if !decodeStrictTransferJSON(w, r, 8<<10, &input) {
					return
				}
				result, err = service.Preview(r.Context(), input)
			case "start":
				var input publishsession.StartRequest
				if !decodeStrictTransferJSON(w, r, 1024, &input) {
					return
				}
				result, err = service.Start(r.Context(), input)
			case "status":
				if !requireEmptyTransferBody(w, r) {
					return
				}
				result, err = service.Inspect(r.Context())
			case "stop", "verify":
				var input struct {
					ID string `json:"id"`
				}
				if !decodeStrictTransferJSON(w, r, 1024, &input) {
					return
				}
				if operation == "stop" {
					result, err = service.Stop(r.Context(), input.ID)
				} else {
					result, err = service.Verify(r.Context(), input.ID)
				}
			}
			if err != nil {
				writePublishSessionError(w, err, http.StatusConflict)
				return
			}
			writeTransferJSON(w, http.StatusOK, result)
		})
	}
}

var errPublishUnavailable = errors.New("Publishing sessions are disabled for this host. Use the local ProtoPeek launcher.")

func writePublishSessionError(w http.ResponseWriter, err error, status int) {
	message := "Publishing operation could not complete; check this session before retrying."
	if errors.Is(err, errPublishUnavailable) {
		message = errPublishUnavailable.Error()
	} else if safe, ok := publishsession.PublicErrorMessage(err); ok && len(safe) <= 512 && !strings.ContainsAny(safe, "\r\n\t") {
		message = safe
	} else if errors.Is(err, context.Canceled) {
		status, message = http.StatusRequestTimeout, "Publishing operation cancelled."
	} else if errors.Is(err, context.DeadlineExceeded) {
		status, message = http.StatusGatewayTimeout, "Publishing operation timed out."
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.Error(w, message, status)
}
