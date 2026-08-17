package grpcui

import (
	"encoding/json"
	"testing"
)

func TestNewRPCResultMarshalsCollectionsAsArrays(t *testing.T) {
	t.Parallel()

	stats := rpcRequestStats{Total: 1}
	encoded, err := json.Marshal(newRPCResult(nil, false, &stats))
	if err != nil {
		t.Fatalf("marshal result: %v", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(encoded, &payload); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}
	for _, key := range []string{"headers", "responses", "trailers"} {
		value, ok := payload[key].([]any)
		if !ok {
			t.Fatalf("%s = %#v, want JSON array", key, payload[key])
		}
		if len(value) != 0 {
			t.Fatalf("%s length = %d, want 0", key, len(value))
		}
	}
}
