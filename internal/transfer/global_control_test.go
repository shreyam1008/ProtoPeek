package transfer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type fakeGlobalEngine struct {
	*fakeEngine
	pauseAllErr  error
	resumeAllErr error
}

func (engine *fakeGlobalEngine) PauseAll(context.Context) error {
	engine.record("pause-all")
	return engine.pauseAllErr
}

func (engine *fakeGlobalEngine) ResumeAll(context.Context) error {
	engine.record("resume-all")
	return engine.resumeAllErr
}

type fakeGlobalAriaRPC struct {
	*fakeAriaRPC
	pauseAllErr   error
	unpauseAllErr error
}

func (rpc *fakeGlobalAriaRPC) PauseAll(context.Context) error {
	rpc.record("pauseAll")
	return rpc.pauseAllErr
}

func (rpc *fakeGlobalAriaRPC) UnpauseAll(context.Context) error {
	rpc.record("unpauseAll")
	return rpc.unpauseAllErr
}

func TestServiceGlobalQueueControlsUseTheRunningEngine(t *testing.T) {
	t.Parallel()
	engine := &fakeGlobalEngine{fakeEngine: &fakeEngine{}}
	service, _, _, _, _ := testService(t, engine)
	if err := service.PauseAll(context.Background()); !errors.Is(err, ErrEngineNotRunning) {
		t.Fatalf("pause-all while stopped = %v", err)
	}
	if _, err := service.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := service.PauseAll(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := service.ResumeAll(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(engine.calls, ","); got != "pause-all,resume-all" {
		t.Fatalf("global engine calls = %q", got)
	}
}

func TestAria2GlobalQueueControlsPersistAndReportPartialSuccess(t *testing.T) {
	t.Parallel()
	rpc := &fakeGlobalAriaRPC{fakeAriaRPC: &fakeAriaRPC{}}
	engine := &aria2Engine{rpc: rpc}
	if err := engine.PauseAll(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := engine.ResumeAll(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(rpc.methods, ","); got != "pauseAll,save,unpauseAll,save" {
		t.Fatalf("aria2 methods = %q", got)
	}

	rpc.saveErr = errors.New("session unavailable")
	if err := engine.PauseAll(context.Background()); !errors.Is(err, ErrQueueStateNotPersisted) {
		t.Fatalf("pause-all persistence error = %v", err)
	}
}

func TestRPCClientGlobalControlsCallRealAria2Methods(t *testing.T) {
	t.Parallel()
	methods := make([]string, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var input rpcRequest
		if err := json.NewDecoder(request.Body).Decode(&input); err != nil {
			t.Errorf("decode request: %v", err)
		}
		methods = append(methods, input.Method)
		writer.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(writer, `{"jsonrpc":"2.0","id":%q,"result":"OK"}`, input.ID)
	}))
	defer server.Close()
	client := newRPCClient(server.URL, "")
	if err := client.PauseAll(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := client.UnpauseAll(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(methods, ","); got != "aria2.pauseAll,aria2.unpauseAll" {
		t.Fatalf("RPC methods = %q", got)
	}
}
