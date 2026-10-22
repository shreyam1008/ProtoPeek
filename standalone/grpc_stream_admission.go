package standalone

import (
	"net/http"

	grpcui "github.com/shreyam1008/ProtoPeek"
)

type grpcInvokeAdmission struct {
	total   *admissionLimiter
	streams *admissionLimiter
}

func newGRPCInvokeAdmission() *grpcInvokeAdmission {
	return &grpcInvokeAdmission{total: newAdmissionLimiter(maxConcurrentGRPCInvokes), streams: newAdmissionLimiter(4)}
}

func (admission *grpcInvokeAdmission) serveHTTP(operation string, writer http.ResponseWriter, request *http.Request, next http.Handler) {
	if grpcui.RPCInvokeStreamRequested(request) {
		admission.streams.serveHTTP("gRPC stream", writer, request, http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			admission.total.serveHTTP(operation, writer, request, next)
		}))
		return
	}
	admission.total.serveHTTP(operation, writer, request, next)
}
