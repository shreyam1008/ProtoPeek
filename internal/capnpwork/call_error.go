package capnpwork

import "strings"

type boundedCallError struct{ cause error }

func (e boundedCallError) Error() string {
	message := e.cause.Error()
	if len(message) > 4096 {
		message = message[:4096]
	}
	return "RPC failed: " + strings.ToValidUTF8(message, "?")
}
func (e boundedCallError) Unwrap() error { return e.cause }
