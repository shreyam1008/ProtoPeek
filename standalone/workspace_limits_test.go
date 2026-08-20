package standalone

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/fullstorydev/grpcurl"
	"github.com/jhump/protoreflect/desc"
	"github.com/jhump/protoreflect/desc/protoparse"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/descriptorpb"
)

func TestWorkspaceSchemaPathAndFilePreflightLimits(t *testing.T) {
	t.Parallel()

	limits := defaultWorkspaceSchemaLimits()
	limits.maxProtoFiles = 2
	limits.maxImportPaths = 1
	limits.maxProtosets = 1
	limits.maxPathBytes = 12
	limits.maxPathAggregateBytes = 20
	limits.maxFileBytes = 3
	limits.maxFileAggregateBytes = 5

	t.Run("path counts and bytes", func(t *testing.T) {
		t.Parallel()
		for _, test := range []struct {
			name string
			cfg  WorkspaceTargetConfig
			want string
		}{
			{
				name: "proto count",
				cfg:  WorkspaceTargetConfig{SchemaSource: "proto-files", ProtoFiles: []string{"a", "b", "c"}},
				want: "2 proto file path limit",
			},
			{
				name: "import count",
				cfg:  WorkspaceTargetConfig{SchemaSource: "proto-files", ProtoFiles: []string{"a"}, ImportPaths: []string{"one", "two"}},
				want: "1 import path limit",
			},
			{
				name: "protoset count",
				cfg:  WorkspaceTargetConfig{SchemaSource: "protoset", Protosets: []string{"one", "two"}},
				want: "1 protoset path limit",
			},
			{
				name: "individual path bytes",
				cfg:  WorkspaceTargetConfig{SchemaSource: "proto-files", ProtoFiles: []string{strings.Repeat("x", 13)}},
				want: "12 byte path limit",
			},
			{
				name: "aggregate path bytes",
				cfg:  WorkspaceTargetConfig{SchemaSource: "proto-files", ProtoFiles: []string{"12345678901", "12345678901"}},
				want: "20 byte aggregate path limit",
			},
		} {
			t.Run(test.name, func(t *testing.T) {
				err := validateWorkspaceSchemaPaths(test.cfg, limits)
				if err == nil || !strings.Contains(err.Error(), test.want) {
					t.Fatalf("validateWorkspaceSchemaPaths() error = %v, want %q", err, test.want)
				}
				var limitErr *workspaceSchemaLimitError
				if !errors.As(err, &limitErr) {
					t.Fatalf("error type = %T, want *workspaceSchemaLimitError", err)
				}
			})
		}
	})

	t.Run("file and aggregate bytes", func(t *testing.T) {
		t.Parallel()
		fileLimits := limits
		fileLimits.maxPathBytes = 4096
		fileLimits.maxPathAggregateBytes = 8192
		directory := t.TempDir()
		first := filepath.Join(directory, "first.proto")
		second := filepath.Join(directory, "second.proto")
		if err := os.WriteFile(first, []byte("123"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(second, []byte("456"), 0o600); err != nil {
			t.Fatal(err)
		}

		err := preflightWorkspaceSchemaFiles(context.Background(), WorkspaceTargetConfig{
			SchemaSource: "proto-files",
			ProtoFiles:   []string{first, second},
		}, fileLimits)
		if err == nil || !strings.Contains(err.Error(), "5 byte aggregate file limit") {
			t.Fatalf("aggregate preflight error = %v", err)
		}

		if err := os.WriteFile(first, []byte("1234"), 0o600); err != nil {
			t.Fatal(err)
		}
		err = preflightWorkspaceSchemaFiles(context.Background(), WorkspaceTargetConfig{
			SchemaSource: "proto-files",
			ProtoFiles:   []string{first},
		}, fileLimits)
		if err == nil || !strings.Contains(err.Error(), "3 byte per-file limit") {
			t.Fatalf("per-file preflight error = %v", err)
		}
	})

	t.Run("cancellation", func(t *testing.T) {
		t.Parallel()
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		err := preflightWorkspaceSchemaFiles(ctx, WorkspaceTargetConfig{
			SchemaSource: "proto-files",
			ProtoFiles:   []string{"never-inspected.proto"},
		}, limits)
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("preflight error = %v, want context.Canceled", err)
		}
	})
}

func TestWorkspaceConnectPreflightsHostSchemaBeforeDial(t *testing.T) {
	t.Parallel()

	directory := t.TempDir()
	protoPath := filepath.Join(directory, "oversized.proto")
	if err := os.WriteFile(protoPath, []byte("1234"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := NewWorkspaceManager(WorkspaceManagerOptions{})
	manager.schemaLimits.maxFileBytes = 3
	var dialed atomic.Int32
	manager.dialTargetOverride = func(context.Context, WorkspaceTargetConfig) (*grpc.ClientConn, error) {
		dialed.Add(1)
		return nil, errors.New("dial should not run")
	}

	_, err := manager.Connect(context.Background(), WorkspaceTargetConfig{
		Address:      "127.0.0.1:50051",
		Plaintext:    true,
		SchemaSource: "proto-files",
		ProtoFiles:   []string{protoPath},
	})
	if err == nil || !strings.Contains(err.Error(), "per-file limit") {
		t.Fatalf("Connect() error = %v", err)
	}
	if dialed.Load() != 0 {
		t.Fatalf("dial count = %d, want 0", dialed.Load())
	}
	if len(manager.activeSchemaConnects) != 0 {
		t.Fatalf("active schema connects after preflight failure = %d", len(manager.activeSchemaConnects))
	}
}

func TestWorkspaceSchemaProductionBoundariesAcceptExactAndRejectPlusOne(t *testing.T) {
	t.Parallel()

	limits := defaultWorkspaceSchemaLimits()
	directory := t.TempDir()
	protoFiles := make([]string, 0, 5)
	for index := range 5 {
		fileName := filepath.Join(directory, fmt.Sprintf("entry-%d.proto", index))
		fileBytes := maxWorkspaceSchemaFileBytes
		if index == 4 {
			fileBytes = 1
		}
		file, err := os.Create(fileName)
		if err != nil {
			t.Fatal(err)
		}
		if err := file.Truncate(fileBytes); err != nil {
			_ = file.Close()
			t.Fatal(err)
		}
		if err := file.Close(); err != nil {
			t.Fatal(err)
		}
		protoFiles = append(protoFiles, fileName)
	}
	exactFiles := protoFiles[:4]
	if err := preflightWorkspaceSchemaFiles(context.Background(), WorkspaceTargetConfig{
		SchemaSource: "proto-files",
		ProtoFiles:   exactFiles,
	}, limits); err != nil {
		t.Fatalf("exact production file aggregate rejected: %v", err)
	}
	if err := preflightWorkspaceSchemaFiles(context.Background(), WorkspaceTargetConfig{
		SchemaSource: "proto-files",
		ProtoFiles:   protoFiles,
	}, limits); err == nil || !strings.Contains(err.Error(), fmt.Sprintf("%d byte aggregate file limit", maxWorkspaceSchemaFileAggregateBytes)) {
		t.Fatalf("aggregate +1 error = %v", err)
	}

	exactUsage := workspaceSchemaUsage{
		services:        maxWorkspaceSchemaServices,
		methods:         maxWorkspaceSchemaMethods,
		files:           maxWorkspaceSchemaFiles,
		descriptorBytes: maxWorkspaceSchemaDescriptorBytes,
		messages:        maxWorkspaceSchemaMessages,
		fields:          maxWorkspaceSchemaFields,
		enums:           maxWorkspaceSchemaEnums,
		enumValues:      maxWorkspaceSchemaEnumValues,
		messageDepth:    maxWorkspaceSchemaMessageDepth,
	}
	if err := validateWorkspaceSchemaUsage(exactUsage, limits); err != nil {
		t.Fatalf("exact production retained usage rejected: %v", err)
	}
	for _, test := range []struct {
		name   string
		change func(*workspaceSchemaUsage)
		want   string
	}{
		{name: "services", change: func(usage *workspaceSchemaUsage) { usage.services++ }, want: fmt.Sprintf("%d service limit", maxWorkspaceSchemaServices)},
		{name: "methods", change: func(usage *workspaceSchemaUsage) { usage.methods++ }, want: fmt.Sprintf("%d method limit", maxWorkspaceSchemaMethods)},
		{name: "files", change: func(usage *workspaceSchemaUsage) { usage.files++ }, want: fmt.Sprintf("%d file limit", maxWorkspaceSchemaFiles)},
		{name: "descriptor bytes", change: func(usage *workspaceSchemaUsage) { usage.descriptorBytes++ }, want: fmt.Sprintf("%d byte descriptor limit", maxWorkspaceSchemaDescriptorBytes)},
		{name: "messages", change: func(usage *workspaceSchemaUsage) { usage.messages++ }, want: fmt.Sprintf("%d message limit", maxWorkspaceSchemaMessages)},
		{name: "fields", change: func(usage *workspaceSchemaUsage) { usage.fields++ }, want: fmt.Sprintf("%d field limit", maxWorkspaceSchemaFields)},
		{name: "enums", change: func(usage *workspaceSchemaUsage) { usage.enums++ }, want: fmt.Sprintf("%d enum limit", maxWorkspaceSchemaEnums)},
		{name: "enum values", change: func(usage *workspaceSchemaUsage) { usage.enumValues++ }, want: fmt.Sprintf("%d enum value limit", maxWorkspaceSchemaEnumValues)},
		{name: "message depth", change: func(usage *workspaceSchemaUsage) { usage.messageDepth++ }, want: fmt.Sprintf("%d message nesting depth limit", maxWorkspaceSchemaMessageDepth)},
	} {
		t.Run(test.name, func(t *testing.T) {
			usage := exactUsage
			test.change(&usage)
			err := validateWorkspaceSchemaUsage(usage, limits)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("production +1 usage error = %v, want %q", err, test.want)
			}
		})
	}
	if err := validateWorkspaceSchemaCatalogBytes(maxWorkspaceSchemaCatalogBytes, limits); err != nil {
		t.Fatalf("exact production catalog bytes rejected: %v", err)
	}
	if err := validateWorkspaceSchemaCatalogBytes(maxWorkspaceSchemaCatalogBytes+1, limits); err == nil || !strings.Contains(err.Error(), fmt.Sprintf("%d byte catalog limit", maxWorkspaceSchemaCatalogBytes)) {
		t.Fatalf("catalog +1 error = %v", err)
	}
}

func TestWorkspaceSchemaStructuralLimitsRunBeforeCatalogExpansion(t *testing.T) {
	t.Parallel()

	parser := protoparse.Parser{Accessor: protoparse.FileContentsFromMap(map[string]string{
		"structure.proto": `
syntax = "proto3";
package limits.v1;
message Outer {
  string first = 1;
  string second = 2;
  message Inner {
    string third = 1;
    enum State { STATE_UNSPECIFIED = 0; STATE_READY = 1; }
  }
}
enum TopState { TOP_STATE_UNSPECIFIED = 0; }
`,
	})}
	files, err := parser.ParseFiles("structure.proto")
	if err != nil {
		t.Fatal(err)
	}

	exact := defaultWorkspaceSchemaLimits()
	exact.maxMessages = 2
	exact.maxFields = 3
	exact.maxEnums = 2
	exact.maxEnumValues = 3
	exact.maxMessageDepth = 2
	if err := validateWorkspaceSchemaResources(context.Background(), nil, files, exact); err != nil {
		t.Fatalf("exact structural limits rejected: %v", err)
	}

	for _, test := range []struct {
		name   string
		change func(*workspaceSchemaLimits)
		want   string
	}{
		{name: "messages", change: func(limits *workspaceSchemaLimits) { limits.maxMessages = 1 }, want: "1 message limit"},
		{name: "fields", change: func(limits *workspaceSchemaLimits) { limits.maxFields = 2 }, want: "2 field limit"},
		{name: "enums", change: func(limits *workspaceSchemaLimits) { limits.maxEnums = 1 }, want: "1 enum limit"},
		{name: "enum values", change: func(limits *workspaceSchemaLimits) { limits.maxEnumValues = 2 }, want: "2 enum value limit"},
		{name: "message depth", change: func(limits *workspaceSchemaLimits) { limits.maxMessageDepth = 1 }, want: "1 message nesting depth limit"},
	} {
		t.Run(test.name, func(t *testing.T) {
			limits := exact
			test.change(&limits)
			err := validateWorkspaceSchemaResources(context.Background(), nil, files, limits)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("structural limit error = %v, want %q", err, test.want)
			}
			var limitErr *workspaceSchemaLimitError
			if !errors.As(err, &limitErr) {
				t.Fatalf("error type = %T, want *workspaceSchemaLimitError", err)
			}
		})
	}
}

func TestWorkspaceConnectRejectsNonRegularHostSchemaBeforeDial(t *testing.T) {
	t.Parallel()

	for _, schemaSource := range []string{"proto-files", "protoset"} {
		schemaSource := schemaSource
		t.Run(schemaSource, func(t *testing.T) {
			t.Parallel()
			manager := NewWorkspaceManager(WorkspaceManagerOptions{})
			var dialed atomic.Int32
			manager.dialTargetOverride = func(context.Context, WorkspaceTargetConfig) (*grpc.ClientConn, error) {
				dialed.Add(1)
				return nil, errors.New("dial should not run")
			}
			cfg := WorkspaceTargetConfig{
				Address:      "127.0.0.1:50051",
				Plaintext:    true,
				SchemaSource: schemaSource,
			}
			if schemaSource == "proto-files" {
				cfg.ProtoFiles = []string{t.TempDir()}
			} else {
				cfg.Protosets = []string{t.TempDir()}
			}
			_, err := manager.Connect(context.Background(), cfg)
			if err == nil || !strings.Contains(err.Error(), "not a regular file") {
				t.Fatalf("Connect() error = %v", err)
			}
			if dialed.Load() != 0 {
				t.Fatalf("dial count = %d, want 0", dialed.Load())
			}
		})
	}
}

func TestWorkspaceSchemaConnectCapacityAndManagerCancellation(t *testing.T) {
	t.Parallel()

	manager := NewWorkspaceManager(WorkspaceManagerOptions{})
	started := make(chan struct{}, maxWorkspaceConcurrentSchemaConnects)
	manager.dialTargetOverride = func(ctx context.Context, _ WorkspaceTargetConfig) (*grpc.ClientConn, error) {
		started <- struct{}{}
		<-ctx.Done()
		return nil, ctx.Err()
	}
	errorsByConnect := make(chan error, maxWorkspaceConcurrentSchemaConnects)
	for range maxWorkspaceConcurrentSchemaConnects {
		go func() {
			_, err := manager.Connect(context.Background(), WorkspaceTargetConfig{
				Address:      "127.0.0.1:50051",
				Plaintext:    true,
				SchemaSource: "reflection",
			})
			errorsByConnect <- err
		}()
	}
	for range maxWorkspaceConcurrentSchemaConnects {
		<-started
	}

	_, err := manager.Connect(context.Background(), WorkspaceTargetConfig{
		Address:      "127.0.0.1:50052",
		Plaintext:    true,
		SchemaSource: "reflection",
	})
	var busyErr *workspaceSchemaBusyError
	if !errors.As(err, &busyErr) {
		t.Fatalf("saturated Connect() error = %v, want *workspaceSchemaBusyError", err)
	}

	if err := manager.Close(); err != nil {
		t.Fatal(err)
	}
	for range maxWorkspaceConcurrentSchemaConnects {
		if err := <-errorsByConnect; !errors.Is(err, context.Canceled) {
			t.Fatalf("active Connect() error = %v, want context.Canceled", err)
		}
	}
	if len(manager.activeSchemaConnects) != 0 {
		t.Fatalf("active schema connects after Close = %d", len(manager.activeSchemaConnects))
	}
}

func TestWorkspaceSchemaHTTPStatusContracts(t *testing.T) {
	t.Run("JSON limit is 413", func(t *testing.T) {
		manager := NewWorkspaceManager(WorkspaceManagerOptions{})
		manager.schemaLimits.maxProtoFiles = 0
		handler := Handler(nil, "", nil, nil, WithWorkspaceManager(manager))
		cookie := workspaceSchemaCSRFCookie(t, handler)
		request := httptest.NewRequest(http.MethodPost, "/api/workspace/connect", strings.NewReader(`{
  "target": {
    "address": "127.0.0.1:50051",
    "plaintext": true,
    "schemaSource": "proto-files",
    "protoFiles": ["entry.proto"]
  }
}`))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set(csrfHeaderName, cookie.Value)
		request.AddCookie(cookie)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusRequestEntityTooLarge || !strings.Contains(response.Body.String(), "0 proto file path limit") {
			t.Fatalf("JSON limit response = %d, %q", response.Code, response.Body.String())
		}
	})

	t.Run("JSON saturation is retryable 503", func(t *testing.T) {
		manager := NewWorkspaceManager(WorkspaceManagerOptions{})
		started := make(chan struct{}, maxWorkspaceConcurrentSchemaConnects)
		manager.dialTargetOverride = func(ctx context.Context, _ WorkspaceTargetConfig) (*grpc.ClientConn, error) {
			started <- struct{}{}
			<-ctx.Done()
			return nil, ctx.Err()
		}
		connectErrors := make(chan error, maxWorkspaceConcurrentSchemaConnects)
		for range maxWorkspaceConcurrentSchemaConnects {
			go func() {
				_, err := manager.Connect(context.Background(), WorkspaceTargetConfig{
					Address: "127.0.0.1:50051", Plaintext: true, SchemaSource: "reflection",
				})
				connectErrors <- err
			}()
		}
		for range maxWorkspaceConcurrentSchemaConnects {
			<-started
		}
		handler := Handler(nil, "", nil, nil, WithWorkspaceManager(manager))
		cookie := workspaceSchemaCSRFCookie(t, handler)
		request := httptest.NewRequest(http.MethodPost, "/api/workspace/connect", strings.NewReader(`{
  "target": {"address": "127.0.0.1:50052", "plaintext": true, "schemaSource": "reflection"}
}`))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set(csrfHeaderName, cookie.Value)
		request.AddCookie(cookie)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusServiceUnavailable || response.Header().Get("Retry-After") != "1" {
			t.Fatalf("JSON saturation response = %d Retry-After=%q body=%q", response.Code, response.Header().Get("Retry-After"), response.Body.String())
		}
		if err := manager.Close(); err != nil {
			t.Fatal(err)
		}
		for range maxWorkspaceConcurrentSchemaConnects {
			if err := <-connectErrors; !errors.Is(err, context.Canceled) {
				t.Fatalf("active Connect() error = %v", err)
			}
		}
	})

	t.Run("browser folder retained schema limit is 413", func(t *testing.T) {
		manager := NewWorkspaceManager(WorkspaceManagerOptions{})
		manager.schemaLimits.maxServices = 0
		var dialed atomic.Int32
		manager.dialTargetOverride = func(context.Context, WorkspaceTargetConfig) (*grpc.ClientConn, error) {
			dialed.Add(1)
			return nil, nil
		}
		handler := Handler(nil, "", nil, nil, WithWorkspaceManager(manager))
		response := performWorkspaceUploadRequest(t, handler, WorkspaceTargetConfig{
			Address: "127.0.0.1:50051", Plaintext: true, SchemaSource: "browser-proto-folder",
		}, []testWorkspaceUploadFile{{
			path: "service.proto",
			content: `syntax = "proto3";
package fixture.v1;
message Request {}
message Response {}
service Fixture { rpc Check(Request) returns (Response); }`,
		}})
		if response.Code != http.StatusRequestEntityTooLarge || !strings.Contains(response.Body.String(), "0 service limit") {
			t.Fatalf("browser retained-limit response = %d, %q", response.Code, response.Body.String())
		}
		if dialed.Load() != 0 {
			t.Fatalf("browser retained-limit dial count = %d, want 0", dialed.Load())
		}
	})
}

func TestReflectionWorkspaceDescriptorLoadingStopsAtBounds(t *testing.T) {
	t.Parallel()

	source := newTrackingWorkspaceDescriptorSource(t, 3)
	limits := defaultWorkspaceSchemaLimits()
	limits.maxServices = 2
	_, _, _, err := loadReflectionWorkspaceDescriptors(context.Background(), source, limits)
	if err == nil || !strings.Contains(err.Error(), "2 service limit") {
		t.Fatalf("service-limit error = %v", err)
	}
	if len(source.findCalls) != 0 {
		t.Fatalf("FindSymbol calls = %v, want none after oversized service list", source.findCalls)
	}

	source = newTrackingWorkspaceDescriptorSource(t, 3)
	limits.maxServices = 3
	limits.maxMethods = 1
	_, _, _, err = loadReflectionWorkspaceDescriptors(context.Background(), source, limits)
	if err == nil || !strings.Contains(err.Error(), "1 method limit") {
		t.Fatalf("method-limit error = %v", err)
	}
	if len(source.findCalls) != 2 {
		t.Fatalf("FindSymbol calls = %v, want two and no fetch after the limit", source.findCalls)
	}
	if source.getAllCalls != 0 {
		t.Fatalf("reflection GetAllFiles calls = %d, want 0", source.getAllCalls)
	}
}

func TestReflectionWorkspaceDescriptorLoadingCollectsOnlyFetchedGraphs(t *testing.T) {
	t.Parallel()

	source := newTrackingWorkspaceDescriptorSource(t, 2)
	methods, files, retainedSource, err := loadReflectionWorkspaceDescriptors(context.Background(), source, defaultWorkspaceSchemaLimits())
	if err != nil {
		t.Fatal(err)
	}
	if len(methods) != 2 || len(files) != 2 || retainedSource == nil {
		t.Fatalf("retained methods/files/source = %d/%d/%T", len(methods), len(files), retainedSource)
	}
	if source.getAllCalls != 0 {
		t.Fatalf("reflection GetAllFiles calls = %d, want 0", source.getAllCalls)
	}
}

func TestReflectionWorkspaceDescriptorLoadingObservesCancellationBetweenFetches(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	source := newTrackingWorkspaceDescriptorSource(t, 3)
	source.afterFind = func() {
		if len(source.findCalls) == 1 {
			cancel()
		}
	}
	_, _, _, err := loadReflectionWorkspaceDescriptors(ctx, source, defaultWorkspaceSchemaLimits())
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("loadReflectionWorkspaceDescriptors() error = %v, want context.Canceled", err)
	}
	if len(source.findCalls) != 1 {
		t.Fatalf("FindSymbol calls after cancellation = %v", source.findCalls)
	}
}

func TestWorkspaceSchemaRetainedEvidenceLimits(t *testing.T) {
	t.Parallel()

	source := newTrackingWorkspaceDescriptorSource(t, 2)
	descriptors := make([]*desc.FileDescriptor, 0, 2)
	methods := make([]*desc.MethodDescriptor, 0, 2)
	for _, serviceName := range source.services {
		descriptor, err := source.DescriptorSource.FindSymbol(serviceName)
		if err != nil {
			t.Fatal(err)
		}
		service := descriptor.(*desc.ServiceDescriptor)
		descriptors = append(descriptors, service.GetFile())
		methods = append(methods, service.GetMethods()...)
	}

	for _, test := range []struct {
		name   string
		change func(*workspaceSchemaLimits)
		want   string
	}{
		{name: "services", change: func(limits *workspaceSchemaLimits) { limits.maxServices = 1 }, want: "1 service limit"},
		{name: "methods", change: func(limits *workspaceSchemaLimits) { limits.maxMethods = 1 }, want: "1 method limit"},
		{name: "files", change: func(limits *workspaceSchemaLimits) { limits.maxFiles = 1 }, want: "1 file limit"},
		{name: "descriptor bytes", change: func(limits *workspaceSchemaLimits) { limits.maxDescriptorBytes = 1 }, want: "1 byte descriptor limit"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			limits := defaultWorkspaceSchemaLimits()
			test.change(&limits)
			err := validateWorkspaceSchemaResources(context.Background(), methods, descriptors, limits)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("validateWorkspaceSchemaResources() error = %v, want %q", err, test.want)
			}
		})
	}

	limits := defaultWorkspaceSchemaLimits()
	limits.maxCatalogBytes = 3
	if err := validateWorkspaceSchemaCatalog([]byte("1234"), limits); err == nil || !strings.Contains(err.Error(), "3 byte catalog limit") {
		t.Fatalf("catalog limit error = %v", err)
	}
}

func TestWorkspaceSessionPublicationRejectsOversizedRetainedEvidence(t *testing.T) {
	t.Parallel()

	source := newTrackingWorkspaceDescriptorSource(t, 1)
	descriptor, err := source.DescriptorSource.FindSymbol(source.services[0])
	if err != nil {
		t.Fatal(err)
	}
	service := descriptor.(*desc.ServiceDescriptor)
	methods := service.GetMethods()
	files := []*desc.FileDescriptor{service.GetFile()}
	target := WorkspaceTargetConfig{Address: "127.0.0.1:50051", Plaintext: true, SchemaSource: "reflection"}

	for _, test := range []struct {
		name   string
		change func(*workspaceSchemaLimits)
		want   string
	}{
		{name: "descriptor evidence", change: func(limits *workspaceSchemaLimits) { limits.maxServices = 0 }, want: "0 service limit"},
		{name: "catalog evidence", change: func(limits *workspaceSchemaLimits) { limits.maxCatalogBytes = 1 }, want: "1 byte catalog limit"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			manager := NewWorkspaceManager(WorkspaceManagerOptions{})
			test.change(&manager.schemaLimits)
			session, err := manager.publishSession(context.Background(), target, nil, methods, files, source.DescriptorSource)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("publishSession() = %#v, %v; want %q", session, err, test.want)
			}
			if len(manager.sessions) != 0 {
				t.Fatalf("published sessions = %d, want 0", len(manager.sessions))
			}
		})
	}
}

func TestHostSchemaParseErrorDoesNotEchoFileContents(t *testing.T) {
	t.Parallel()

	const marker = "DO_NOT_ECHO_SCHEMA_CONTENT_4f991"
	protoPath := filepath.Join(t.TempDir(), "invalid.proto")
	if err := os.WriteFile(protoPath, []byte("syntax = \"proto3\"; "+marker), 0o600); err != nil {
		t.Fatal(err)
	}
	_, _, _, err := loadWorkspaceDescriptors(context.Background(), nil, WorkspaceTargetConfig{
		SchemaSource: "proto-files",
		ProtoFiles:   []string{protoPath},
	}, nil, defaultWorkspaceSchemaLimits())
	if err == nil {
		t.Fatal("loadWorkspaceDescriptors() succeeded for invalid proto")
	}
	if strings.Contains(err.Error(), marker) {
		t.Fatalf("schema error echoed file contents: %q", err)
	}
	if !strings.Contains(err.Error(), "verify the configured proto files, import paths, and schema syntax") {
		t.Fatalf("schema error is not actionable: %q", err)
	}
}

func TestWorkspaceHostProtoAndProtosetSourcesLoadWithinBounds(t *testing.T) {
	t.Parallel()

	directory := t.TempDir()
	dependencyPath := filepath.Join(directory, "dependency.proto")
	entryPath := filepath.Join(directory, "entry.proto")
	if err := os.WriteFile(dependencyPath, []byte(`
syntax = "proto3";
package fixture.v1;
message Request {}
message Response {}
`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(entryPath, []byte(`
syntax = "proto3";
package fixture.v1;
import "dependency.proto";
service Fixture { rpc Check(Request) returns (Response); }
`), 0o600); err != nil {
		t.Fatal(err)
	}
	limits := defaultWorkspaceSchemaLimits()
	protoConfig := WorkspaceTargetConfig{
		SchemaSource: "proto-files",
		ProtoFiles:   []string{entryPath},
		ImportPaths:  []string{directory},
	}
	if err := preflightWorkspaceSchemaFiles(context.Background(), protoConfig, limits); err != nil {
		t.Fatal(err)
	}
	methods, files, _, err := loadWorkspaceDescriptors(context.Background(), nil, protoConfig, nil, limits)
	if err != nil {
		t.Fatal(err)
	}
	if len(methods) != 1 || len(files) != 2 {
		t.Fatalf("host proto methods/files = %d/%d, want 1/2", len(methods), len(files))
	}

	descriptorSet := &descriptorpb.FileDescriptorSet{File: make([]*descriptorpb.FileDescriptorProto, 0, len(files))}
	for _, file := range files {
		descriptorSet.File = append(descriptorSet.File, file.AsFileDescriptorProto())
	}
	encoded, err := proto.Marshal(descriptorSet)
	if err != nil {
		t.Fatal(err)
	}
	protosetPath := filepath.Join(directory, "fixture.protoset")
	if err := os.WriteFile(protosetPath, encoded, 0o600); err != nil {
		t.Fatal(err)
	}
	protosetConfig := WorkspaceTargetConfig{SchemaSource: "protoset", Protosets: []string{protosetPath}}
	if err := preflightWorkspaceSchemaFiles(context.Background(), protosetConfig, limits); err != nil {
		t.Fatal(err)
	}
	methods, files, _, err = loadWorkspaceDescriptors(context.Background(), nil, protosetConfig, nil, limits)
	if err != nil {
		t.Fatal(err)
	}
	if len(methods) != 1 || len(files) != 2 {
		t.Fatalf("host protoset methods/files = %d/%d, want 1/2", len(methods), len(files))
	}
}

type trackingWorkspaceDescriptorSource struct {
	grpcurl.DescriptorSource
	services    []string
	findCalls   []string
	getAllCalls int
	afterFind   func()
}

func (source *trackingWorkspaceDescriptorSource) GetAllFiles() ([]*desc.FileDescriptor, error) {
	source.getAllCalls++
	return nil, errors.New("reflection GetAllFiles must not be called")
}

func (source *trackingWorkspaceDescriptorSource) ListServices() ([]string, error) {
	return append([]string(nil), source.services...), nil
}

func (source *trackingWorkspaceDescriptorSource) FindSymbol(name string) (desc.Descriptor, error) {
	source.findCalls = append(source.findCalls, name)
	descriptor, err := source.DescriptorSource.FindSymbol(name)
	if source.afterFind != nil {
		source.afterFind()
	}
	return descriptor, err
}

func newTrackingWorkspaceDescriptorSource(t *testing.T, serviceCount int) *trackingWorkspaceDescriptorSource {
	t.Helper()
	contents := make(map[string]string, serviceCount)
	paths := make([]string, 0, serviceCount)
	services := make([]string, 0, serviceCount)
	for index := range serviceCount {
		path := fmt.Sprintf("service_%d.proto", index)
		service := fmt.Sprintf("limit.v1.Service%d", index)
		paths = append(paths, path)
		services = append(services, service)
		contents[path] = fmt.Sprintf(`
syntax = "proto3";
package limit.v1;
message Request%d {}
message Response%d {}
service Service%d { rpc Check(Request%d) returns (Response%d); }
`, index, index, index, index, index)
	}
	parser := protoparse.Parser{Accessor: protoparse.FileContentsFromMap(contents)}
	files, err := parser.ParseFiles(paths...)
	if err != nil {
		t.Fatal(err)
	}
	descriptorSource, err := grpcurl.DescriptorSourceFromFileDescriptors(files...)
	if err != nil {
		t.Fatal(err)
	}
	return &trackingWorkspaceDescriptorSource{
		DescriptorSource: descriptorSource,
		services:         services,
	}
}

func workspaceSchemaCSRFCookie(t *testing.T, handler http.Handler) *http.Cookie {
	t.Helper()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
	cookies := response.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("handler did not issue a CSRF cookie")
	}
	return cookies[0]
}
