package grpcui

import (
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	maxRPCStreamLineBytes = maxInvokeRetainedResponseBytes + 256<<10
	maxRPCStreamBytes     = maxInvokeRetainedResponseBytes + 1<<20
	rpcStreamWriteTimeout = 2 * time.Second
)

// RPCInvokeStreamRequested requires an explicit acceptable NDJSON media type.
// Wildcard Accept values preserve the legacy buffered JSON contract.
func RPCInvokeStreamRequested(request *http.Request) bool {
	for _, value := range request.Header.Values("Accept") {
		for _, item := range strings.Split(value, ",") {
			mediaType, parameters, err := mime.ParseMediaType(strings.TrimSpace(item))
			if err != nil || !strings.EqualFold(mediaType, "application/x-ndjson") {
				continue
			}
			if quality, exists := parameters["q"]; exists {
				q, err := strconv.ParseFloat(quality, 64)
				if err != nil || !(q > 0 && q <= 1) {
					continue
				}
			}
			return true
		}
	}
	return false
}

type rpcStreamEvent struct {
	Type          string              `json:"type"`
	TotalRequests int                 `json:"totalRequests,omitempty"`
	Headers       []rpcMetadata       `json:"headers,omitempty"`
	ElapsedMs     *float64            `json:"elapsedMs,omitempty"`
	Response      *rpcResponseElement `json:"response,omitempty"`
	Result        *rpcResult          `json:"result,omitempty"`
	RelayError    string              `json:"relayError,omitempty"`
}

type rpcStreamWriter struct {
	writer     http.ResponseWriter
	controller *http.ResponseController
	timeout    time.Duration
	bytes      int
	started    bool
	err        error
}

func newRPCStreamWriter(writer http.ResponseWriter, timeout time.Duration) (*rpcStreamWriter, error) {
	if timeout <= 0 || timeout > rpcStreamWriteTimeout {
		timeout = rpcStreamWriteTimeout
	}
	controller := http.NewResponseController(writer)
	if err := controller.SetWriteDeadline(time.Now().Add(timeout)); err != nil {
		return nil, err
	}
	return &rpcStreamWriter{writer: writer, controller: controller, timeout: timeout}, nil
}

func (stream *rpcStreamWriter) close() { _ = stream.controller.SetWriteDeadline(time.Time{}) }

func (stream *rpcStreamWriter) write(event rpcStreamEvent) error {
	if stream.err != nil {
		return stream.err
	}
	line, err := json.Marshal(event)
	if err == nil && (len(line)+1 > maxRPCStreamLineBytes || len(line)+1 > maxRPCStreamBytes-stream.bytes) {
		err = fmt.Errorf("RPC stream exceeded its byte limit")
	}
	if err == nil {
		err = stream.controller.SetWriteDeadline(time.Now().Add(stream.timeout))
	}
	if err == nil {
		if !stream.started {
			stream.writer.Header().Set("Content-Type", "application/x-ndjson")
			stream.writer.Header().Set("Content-Encoding", "identity")
			stream.writer.Header().Set("Cache-Control", "no-store, no-transform")
			stream.writer.Header().Set("X-Content-Type-Options", "nosniff")
			stream.writer.Header().Set("X-Accel-Buffering", "no")
			stream.writer.Header().Add("Vary", "Accept")
			stream.started = true
		}
		line = append(line, '\n')
		var written int
		written, err = stream.writer.Write(line)
		stream.bytes += written
		if err == nil && written != len(line) {
			err = io.ErrShortWrite
		}
		if err == nil {
			err = stream.controller.Flush()
		}
	}
	stream.err = err
	return err
}
