package transfer

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

type batchSequenceEngine struct {
	mu       sync.Mutex
	requests []AddRequest
	ids      []string
	errors   []error
	added    int
}

func (engine *batchSequenceEngine) Snapshot(context.Context, int) (EngineSnapshot, error) {
	engine.mu.Lock()
	defer engine.mu.Unlock()
	return EngineSnapshot{Metrics: Metrics{TotalCount: engine.added}}, nil
}

func (engine *batchSequenceEngine) Add(_ context.Context, request AddRequest, _ HostConfig) (string, error) {
	engine.mu.Lock()
	defer engine.mu.Unlock()
	index := len(engine.requests)
	engine.requests = append(engine.requests, request)
	if index < len(engine.errors) && engine.errors[index] != nil {
		return "", engine.errors[index]
	}
	engine.added++
	if index < len(engine.ids) {
		return engine.ids[index], nil
	}
	return "aabbccdd", nil
}

func (*batchSequenceEngine) Pause(context.Context, string) error  { return nil }
func (*batchSequenceEngine) Resume(context.Context, string) error { return nil }
func (*batchSequenceEngine) Retry(context.Context, string, AddRequest, HostConfig) (string, error) {
	return "", errors.New("not implemented")
}
func (*batchSequenceEngine) Cancel(context.Context, string) error { return nil }
func (*batchSequenceEngine) SaveSession(context.Context) error    { return nil }
func (*batchSequenceEngine) Shutdown(context.Context) error       { return nil }

func TestServiceAddBatchQueuesIndependentJobsAndReportsPartialSuccess(t *testing.T) {
	t.Parallel()
	engine := &batchSequenceEngine{ids: []string{"aabbccdd", "eeff0011"}}
	service, _, _, _, _ := testService(t, engine)
	if _, err := service.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	destination := t.TempDir()
	secret := "Bearer private-credential"
	result, err := service.AddBatch(context.Background(), BatchAddRequest{Jobs: []AddRequest{
		{
			Sources:              []string{"https://example.com/one.iso"},
			DestinationDirectory: destination,
			UserAgent:            "ProtoPeek batch/1",
			Headers:              []RequestHeader{{Name: "Authorization", Value: secret}},
		},
		{
			Sources: []string{"https://example.com/rejected.iso"},
			Headers: []RequestHeader{{Name: "Host", Value: secret}},
		},
		{Sources: []string{"https://example.com/two.iso"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if result.RequestedCount != 3 || result.QueuedCount != 2 || result.FailedCount != 1 {
		t.Fatalf("batch result = %#v", result)
	}
	if result.Results[1].FailureCode != BatchFailureInvalidRequest || result.Results[0].ID != "aabbccdd" || result.Results[2].ID != "eeff0011" {
		t.Fatalf("batch item results = %#v", result.Results)
	}
	if len(engine.requests) != 2 || len(engine.requests[0].Sources) != 1 || len(engine.requests[1].Sources) != 1 {
		t.Fatalf("independent engine requests = %#v", engine.requests)
	}
	if engine.requests[0].DestinationDirectory != filepath.Clean(destination) || engine.requests[0].UserAgent != "ProtoPeek batch/1" || engine.requests[0].Headers[0].Value != secret {
		t.Fatalf("per-job options = %#v", engine.requests[0])
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), secret) || strings.Contains(string(encoded), "example.com") {
		t.Fatalf("batch response leaked source or header value: %s", encoded)
	}
}

func TestServiceAddBatchBoundsEnvelopeAndClassifiesQueueFailures(t *testing.T) {
	t.Parallel()
	service, _, _, _, _ := testService(t, &batchSequenceEngine{})
	if _, err := service.AddBatch(context.Background(), BatchAddRequest{}); !errors.Is(err, ErrInvalidBatchRequest) {
		t.Fatalf("empty batch error = %v", err)
	}
	tooMany := make([]AddRequest, MaxBatchJobs+1)
	if _, err := service.AddBatch(context.Background(), BatchAddRequest{Jobs: tooMany}); !errors.Is(err, ErrInvalidBatchRequest) {
		t.Fatalf("oversized batch error = %v", err)
	}

	engine := &batchSequenceEngine{errors: []error{ErrQueueFull}}
	service, _, _, _, _ = testService(t, engine)
	if _, err := service.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	result, err := service.AddBatch(context.Background(), BatchAddRequest{Jobs: []AddRequest{{Sources: []string{"https://example.com/file"}}}})
	if err != nil || result.QueuedCount != 0 || result.Results[0].FailureCode != BatchFailureQueueFull {
		t.Fatalf("queue result=%#v err=%v", result, err)
	}
}

func TestValidateAddRequestBoundsPerJobOptionsWithoutEchoingValues(t *testing.T) {
	t.Parallel()
	secret := "private-header-value"
	tests := []AddRequest{
		{Sources: []string{"https://example.com/a"}, DestinationDirectory: "relative/path"},
		{Sources: []string{"https://example.com/a"}, Headers: []RequestHeader{{Name: "X-Test", Value: secret + "\r\nInjected: yes"}}},
		{Sources: []string{"https://example.com/a"}, Headers: []RequestHeader{{Name: "Host", Value: secret}}},
		{Sources: []string{"https://example.com/a"}, Headers: []RequestHeader{{Name: "X-Test", Value: secret}, {Name: "x-test", Value: "other"}}},
	}
	for _, request := range tests {
		_, err := validateAddRequest(request)
		if err == nil {
			t.Fatalf("unsafe request accepted: %#v", request)
		}
		if strings.Contains(err.Error(), secret) {
			t.Fatalf("validation error leaked header value: %v", err)
		}
	}
}

func TestServiceAddChecksThePerJobDestinationReserve(t *testing.T) {
	t.Parallel()
	engine := &batchSequenceEngine{ids: []string{"aabbccdd"}}
	service, _, _, _, _ := testService(t, engine)
	if _, err := service.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	missing := filepath.Join(t.TempDir(), "missing")
	if _, err := service.Add(context.Background(), AddRequest{
		Sources:              []string{"https://example.com/file"},
		DestinationDirectory: missing,
	}); err == nil || !strings.Contains(err.Error(), "free disk space") {
		t.Fatalf("missing per-job destination error = %v", err)
	}
	if _, err := os.Stat(missing); !os.IsNotExist(err) {
		t.Fatalf("per-job destination was unexpectedly created: %v", err)
	}
}

func TestAria2AddAppliesPerJobOptionsWithoutChangingHostDefaults(t *testing.T) {
	t.Parallel()
	config := DefaultHostConfig()
	config.DownloadDirectory = t.TempDir()
	destination := t.TempDir()
	rpc := &fakeAriaRPC{addID: "aabbccdd"}
	_, err := (&aria2Engine{rpc: rpc}).Add(context.Background(), AddRequest{
		Sources:              []string{"https://example.com/file"},
		DestinationDirectory: destination,
		UserAgent:            "One job/1",
		Headers: []RequestHeader{
			{Name: "Authorization", Value: "Bearer private"},
			{Name: "X-Trace", Value: "trace-id"},
		},
	}, config)
	if err != nil {
		t.Fatal(err)
	}
	if rpc.lastOpts["dir"] != destination || rpc.lastOpts["user-agent"] != "One job/1" {
		t.Fatalf("per-job aria2 options = %#v", rpc.lastOpts)
	}
	headers, ok := rpc.lastOpts["header"].([]string)
	if !ok || len(headers) != 2 || headers[0] != "Authorization: Bearer private" {
		t.Fatalf("aria2 headers = %#v", rpc.lastOpts["header"])
	}
	if config.DownloadDirectory == destination || config.UserAgent == "One job/1" {
		t.Fatalf("host defaults were mutated: %#v", config)
	}
}
