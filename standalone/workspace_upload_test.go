package standalone

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/fullstorydev/grpcurl"
	"github.com/jhump/protoreflect/desc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/connectivity"
	"google.golang.org/grpc/credentials/insecure"
)

type testWorkspaceUploadFile struct {
	path    string
	content string
}

type testWorkspaceUploadPart struct {
	name     string
	filename string
	content  string
}

type targetJSONPart struct {
	filename string
	contents []byte
}

func TestWorkspaceConnectUploadsNestedProtoFolder(t *testing.T) {
	t.Parallel()

	manager := NewWorkspaceManager(WorkspaceManagerOptions{})
	t.Cleanup(func() { _ = manager.Close() })
	handler := Handler(nil, "", nil, nil, WithWorkspaceManager(manager))
	targetAddress := startWorkspaceUploadGRPCTarget(t)
	files := []testWorkspaceUploadFile{
		{
			path: "api/greeter.proto",
			content: `syntax = "proto3";
package demo.v1;
import "common/types.proto";
service Greeter {
  rpc SayHello(demo.common.Greeting) returns (demo.common.Greeting);
}`,
		},
		{
			path: "common/types.proto",
			content: `syntax = "proto3";
package demo.common;
message Greeting { string text = 1; }`,
		},
	}

	response := performWorkspaceUploadRequest(t, handler, WorkspaceTargetConfig{
		Address:      targetAddress,
		Plaintext:    true,
		SchemaSource: "browser-proto-folder",
	}, files)
	if response.Code != http.StatusOK {
		t.Fatalf("upload connect status = %d, body = %q", response.Code, response.Body.String())
	}

	var connected struct {
		SessionID string          `json:"sessionId"`
		Bootstrap json.RawMessage `json:"bootstrap"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &connected); err != nil {
		t.Fatalf("decode connect response: %v", err)
	}
	if connected.SessionID == "" {
		t.Fatal("connect response has an empty session ID")
	}
	session, ok := manager.Session(connected.SessionID)
	if !ok {
		t.Fatalf("workspace session %q was not published", connected.SessionID)
	}
	if session.target.SchemaSource != "browser-proto-folder" {
		t.Fatalf("session schema source = %q", session.target.SchemaSource)
	}
	if len(session.target.ProtoFiles) != 0 || len(session.target.ImportPaths) != 0 || len(session.target.Protosets) != 0 {
		t.Fatalf("uploaded session published host paths: %#v", session.target)
	}

	catalogRequest := httptest.NewRequest(
		http.MethodGet,
		"/api/workspace/protos?session_id="+connected.SessionID,
		nil,
	)
	catalogResponse := httptest.NewRecorder()
	handler.ServeHTTP(catalogResponse, catalogRequest)
	if catalogResponse.Code != http.StatusOK {
		t.Fatalf("catalog status = %d, body = %q", catalogResponse.Code, catalogResponse.Body.String())
	}
	var catalog protoCatalogResponse
	if err := json.Unmarshal(catalogResponse.Body.Bytes(), &catalog); err != nil {
		t.Fatalf("decode proto catalog: %v", err)
	}
	if len(catalog.Files) != 2 {
		t.Fatalf("catalog file count = %d, want 2", len(catalog.Files))
	}
	var foundService bool
	for _, file := range catalog.Files {
		for _, service := range file.Services {
			if service.FullName == "demo.v1.Greeter" {
				foundService = true
			}
		}
	}
	if !foundService {
		t.Fatalf("catalog does not contain demo.v1.Greeter: %#v", catalog.Files)
	}
	if _, err := session.descSource.FindSymbol("demo.common.Greeting"); err != nil {
		t.Fatalf("in-memory descriptor source failed after upload request completed: %v", err)
	}
}

func TestWorkspaceUploadCannotImportOutsideManifest(t *testing.T) {
	t.Parallel()

	tempParent := t.TempDir()
	secretPath := tempParent + string(os.PathSeparator) + "secret.proto"
	secretContents := `syntax = "proto3";
package escaped;
message Secret { string value = 1; }`
	if err := os.WriteFile(secretPath, []byte(secretContents), 0o600); err != nil {
		t.Fatalf("write out-of-manifest proto: %v", err)
	}

	manager := NewWorkspaceManager(WorkspaceManagerOptions{})
	t.Cleanup(func() { _ = manager.Close() })
	handler := Handler(nil, "", nil, nil, WithWorkspaceManager(manager))
	response := performWorkspaceUploadRequest(t, handler, WorkspaceTargetConfig{
		Address:      startWorkspaceUploadGRPCTarget(t),
		Plaintext:    true,
		SchemaSource: "browser-proto-folder",
	}, []testWorkspaceUploadFile{{
		path: "main.proto",
		content: `syntax = "proto3";
package escaped;
import "../secret.proto";
service Escaped { rpc Read(Secret) returns (Secret); }`,
	}})

	if response.Code != http.StatusBadRequest {
		t.Fatalf("traversal import status = %d, want %d; body = %q", response.Code, http.StatusBadRequest, response.Body.String())
	}
	if strings.Contains(response.Body.String(), tempParent) ||
		strings.Contains(response.Body.String(), secretContents) {
		t.Fatalf("traversal error leaked host data: %q", response.Body.String())
	}
	if len(manager.sessions) != 0 {
		t.Fatalf("traversal upload published %d sessions", len(manager.sessions))
	}
	entries, err := os.ReadDir(tempParent)
	if err != nil {
		t.Fatalf("read upload temp parent: %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != "secret.proto" {
		t.Fatalf("upload mutated the host directory: %#v", entries)
	}
}

func TestWorkspaceUploadPathPortableLimits(t *testing.T) {
	t.Parallel()

	exactPath := strings.Repeat("a", 255) + "/bb/" + strings.Repeat("b", 247) + ".proto"
	exactComponent := strings.Repeat("a", 249) + ".proto"
	exactDepth := strings.Repeat("a/", maxWorkspaceUploadPathDepth-1) + "x.proto"
	for _, value := range []string{exactPath, exactComponent, exactDepth, "dir/name.proto"} {
		if err := validateWorkspaceUploadPath(value); err != nil {
			t.Errorf("valid path %q rejected: %v", value, err)
		}
	}

	invalid := []string{
		"../secret.proto",
		"/absolute.proto",
		"C:/drive.proto",
		`dir\name.proto`,
		"dir//name.proto",
		"dir/./name.proto",
		"name.PROTO",
		"name.txt",
		"bad\x00.proto",
		"bad\n.proto",
		"bad\u0085.proto",
		"bad\x7f.proto",
		"bad<name.proto",
		"bad>name.proto",
		`bad"name.proto`,
		"bad|name.proto",
		"bad?name.proto",
		"bad*name.proto",
		"CON.proto",
		"dir/aux.proto",
		"dir./name.proto",
		"dir /name.proto",
		strings.Repeat("a", 255) + "/bb/" + strings.Repeat("b", 248) + ".proto",
		strings.Repeat("a", 250) + ".proto",
		strings.Repeat("a/", maxWorkspaceUploadPathDepth) + "x.proto",
	}
	for _, value := range invalid {
		if err := validateWorkspaceUploadPath(value); err == nil {
			t.Errorf("invalid path %q was accepted", value)
		}
	}
}

func TestWorkspaceConnectRejectsUnsafeManifestPaths(t *testing.T) {
	t.Parallel()

	manager := NewWorkspaceManager(WorkspaceManagerOptions{})
	t.Cleanup(func() { _ = manager.Close() })
	handler := Handler(nil, "", nil, nil, WithWorkspaceManager(manager))
	target := WorkspaceTargetConfig{Address: "127.0.0.1:1", Plaintext: true, SchemaSource: "browser-proto-folder"}
	for _, value := range []string{
		"../escape.proto",
		"C:/drive.proto",
		`dir\name.proto`,
		"bad?name.proto",
		"bad\n.proto",
		"CON.proto",
		"name.PROTO",
	} {
		manifest := workspaceUploadManifest{Version: 1, Files: []workspaceUploadManifestFile{{Path: value}}}
		response := performWorkspaceUploadMultipartRequest(t, handler, target, manifest, nil)
		if response.Code != http.StatusBadRequest {
			t.Errorf("unsafe path %q status = %d, body = %q", value, response.Code, response.Body.String())
		}
	}

	caseCollision := workspaceUploadManifest{Version: 1, Files: []workspaceUploadManifestFile{
		{Path: "api/Service.proto"},
		{Path: "API/service.proto"},
	}}
	if response := performWorkspaceUploadMultipartRequest(t, handler, target, caseCollision, nil); response.Code != http.StatusBadRequest {
		t.Errorf("case-collision status = %d, body = %q", response.Code, response.Body.String())
	}
}

func TestWorkspaceUploadSupportsWellKnownImports(t *testing.T) {
	t.Parallel()

	manager := NewWorkspaceManager(WorkspaceManagerOptions{})
	t.Cleanup(func() { _ = manager.Close() })
	handler := Handler(nil, "", nil, nil, WithWorkspaceManager(manager))
	response := performWorkspaceUploadRequest(t, handler, WorkspaceTargetConfig{
		Address:      startWorkspaceUploadGRPCTarget(t),
		Plaintext:    true,
		SchemaSource: "browser-proto-folder",
	}, []testWorkspaceUploadFile{{
		path: "clock.proto",
		content: `syntax = "proto3";
package clock.v1;
import "google/protobuf/timestamp.proto";
service Clock { rpc Now(google.protobuf.Timestamp) returns (google.protobuf.Timestamp); }`,
	}})
	if response.Code != http.StatusOK {
		t.Fatalf("well-known import status = %d, body = %q", response.Code, response.Body.String())
	}
}

func TestWorkspaceUploadParseFailuresReleaseCapacityAndDoNotPublish(t *testing.T) {
	t.Parallel()

	manager := NewWorkspaceManager(WorkspaceManagerOptions{})
	t.Cleanup(func() { _ = manager.Close() })
	handler := Handler(nil, "", nil, nil, WithWorkspaceManager(manager))
	target := WorkspaceTargetConfig{Address: "127.0.0.1:1", Plaintext: true, SchemaSource: "browser-proto-folder"}
	for _, file := range []testWorkspaceUploadFile{
		{path: "missing.proto", content: `syntax = "proto3"; import "missing/types.proto";`},
		{path: "syntax.proto", content: `syntax = "proto3"; message {`},
	} {
		response := performWorkspaceUploadRequest(t, handler, target, []testWorkspaceUploadFile{file})
		if response.Code != http.StatusBadRequest {
			t.Fatalf("parse failure for %q status = %d, body = %q", file.path, response.Code, response.Body.String())
		}
		if len(manager.sessions) != 0 {
			t.Fatalf("parse failure for %q published %d sessions", file.path, len(manager.sessions))
		}
		if len(manager.activeUploads) != 0 {
			t.Fatalf("parse failure for %q retained %d upload slots", file.path, len(manager.activeUploads))
		}
	}
}

func TestWorkspaceUploadCapacityIsBoundedBeforeBodyRead(t *testing.T) {
	t.Parallel()

	manager := NewWorkspaceManager(WorkspaceManagerOptions{})
	t.Cleanup(func() { _ = manager.Close() })
	originalLoader := manager.uploadDescriptorLoader
	parseStarted := make(chan struct{}, maxWorkspaceConcurrentUploads)
	releaseParse := make(chan struct{})
	manager.uploadDescriptorLoader = func(contents map[string][]byte, paths []string) ([]*desc.MethodDescriptor, []*desc.FileDescriptor, grpcurl.DescriptorSource, error) {
		parseStarted <- struct{}{}
		<-releaseParse
		return originalLoader(contents, paths)
	}
	dialStarted := make(chan struct{}, maxWorkspaceConcurrentUploads)
	releaseDial := make(chan struct{})
	manager.dialTargetOverride = func(context.Context, WorkspaceTargetConfig) (*grpc.ClientConn, error) {
		dialStarted <- struct{}{}
		<-releaseDial
		return nil, errors.New("injected blocked dial")
	}
	handler := Handler(nil, "", nil, nil, WithWorkspaceManager(manager))
	cookie := workspaceUploadCSRFCookie(t, handler)
	target := WorkspaceTargetConfig{Address: "127.0.0.1:1", Plaintext: true, SchemaSource: "browser-proto-folder"}
	manifest := workspaceUploadManifest{Version: 1, Files: []workspaceUploadManifestFile{{Path: "service.proto", Size: 18}}}
	parts := []testWorkspaceUploadPart{{name: "file.0", filename: "ignored", content: `syntax = "proto3";`}}
	responses := make([]*httptest.ResponseRecorder, maxWorkspaceConcurrentUploads)
	done := make(chan struct{}, maxWorkspaceConcurrentUploads)
	for index := 0; index < maxWorkspaceConcurrentUploads; index++ {
		request := newWorkspaceUploadRequest(t, context.Background(), cookie, target, manifest, parts)
		responses[index] = httptest.NewRecorder()
		go func(response *httptest.ResponseRecorder, request *http.Request) {
			handler.ServeHTTP(response, request)
			done <- struct{}{}
		}(responses[index], request)
	}
	for range maxWorkspaceConcurrentUploads {
		waitWorkspaceUploadSignal(t, parseStarted, "upload parser")
	}

	body := &countingReadCloser{reader: strings.NewReader("body must remain unread")}
	request := httptest.NewRequest(http.MethodPost, "/api/workspace/connect", body)
	request.Header.Set("Content-Type", "multipart/form-data; boundary=unused")
	request.Header.Set(csrfHeaderName, cookie.Value)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("saturated status = %d, want %d; body = %q", response.Code, http.StatusServiceUnavailable, response.Body.String())
	}
	if body.reads != 0 {
		t.Fatalf("saturated upload read request body %d times", body.reads)
	}
	if response.Header().Get("Retry-After") == "" {
		t.Fatal("saturated response omitted Retry-After")
	}

	close(releaseParse)
	for range maxWorkspaceConcurrentUploads {
		waitWorkspaceUploadSignal(t, dialStarted, "target dial")
	}
	invalidManifest := workspaceUploadManifest{Version: 1, Files: []workspaceUploadManifestFile{{Path: "../escape.proto"}}}
	if invalidResponse := performWorkspaceUploadMultipartRequest(t, handler, target, invalidManifest, nil); invalidResponse.Code != http.StatusBadRequest {
		t.Fatalf("slot was not released before dial: status = %d, body = %q", invalidResponse.Code, invalidResponse.Body.String())
	}
	close(releaseDial)
	for range maxWorkspaceConcurrentUploads {
		waitWorkspaceUploadSignal(t, done, "blocked request completion")
	}
	for index, blockedResponse := range responses {
		if blockedResponse.Code != http.StatusBadRequest {
			t.Fatalf("blocked response %d status = %d, body = %q", index, blockedResponse.Code, blockedResponse.Body.String())
		}
	}

	manager.uploadDescriptorLoader = originalLoader
	manager.dialTargetOverride = nil
	fresh := performWorkspaceUploadRequest(t, handler, WorkspaceTargetConfig{
		Address:      startWorkspaceUploadGRPCTarget(t),
		Plaintext:    true,
		SchemaSource: "browser-proto-folder",
	}, []testWorkspaceUploadFile{{path: "fresh.proto", content: `syntax = "proto3"; package fresh; service Fresh {}`}})
	if fresh.Code != http.StatusOK {
		t.Fatalf("fresh upload after capacity release status = %d, body = %q", fresh.Code, fresh.Body.String())
	}
}

func TestWorkspaceManagerCloseDuringUploadParsePreventsDialAndPublication(t *testing.T) {
	t.Parallel()

	manager := NewWorkspaceManager(WorkspaceManagerOptions{})
	originalLoader := manager.uploadDescriptorLoader
	parseStarted := make(chan struct{}, 1)
	releaseParse := make(chan struct{})
	manager.uploadDescriptorLoader = func(contents map[string][]byte, paths []string) ([]*desc.MethodDescriptor, []*desc.FileDescriptor, grpcurl.DescriptorSource, error) {
		parseStarted <- struct{}{}
		<-releaseParse
		return originalLoader(contents, paths)
	}
	dialCalled := make(chan struct{}, 1)
	manager.dialTargetOverride = func(context.Context, WorkspaceTargetConfig) (*grpc.ClientConn, error) {
		dialCalled <- struct{}{}
		return nil, errors.New("dial must not run")
	}
	handler := Handler(nil, "", nil, nil, WithWorkspaceManager(manager))
	cookie := workspaceUploadCSRFCookie(t, handler)
	target := WorkspaceTargetConfig{Address: "127.0.0.1:1", Plaintext: true, SchemaSource: "browser-proto-folder"}
	manifest := workspaceUploadManifest{Version: 1, Files: []workspaceUploadManifestFile{{Path: "close.proto", Size: 18}}}
	parts := []testWorkspaceUploadPart{{name: "file.0", filename: "ignored", content: `syntax = "proto3";`}}
	request := newWorkspaceUploadRequest(t, context.Background(), cookie, target, manifest, parts)
	response := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		handler.ServeHTTP(response, request)
		close(done)
	}()
	waitWorkspaceUploadSignal(t, parseStarted, "upload parser")
	if err := manager.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	close(releaseParse)
	waitWorkspaceUploadSignal(t, done, "closed upload completion")
	if response.Code != http.StatusBadRequest {
		t.Fatalf("closed upload status = %d, body = %q", response.Code, response.Body.String())
	}
	select {
	case <-dialCalled:
		t.Fatal("manager Close during parse allowed a target dial")
	default:
	}
	if len(manager.sessions) != 0 || len(manager.activeUploads) != 0 {
		t.Fatalf("manager Close retained sessions=%d active=%d", len(manager.sessions), len(manager.activeUploads))
	}
}

func TestWorkspaceConcurrentUploadsPublishSafely(t *testing.T) {
	t.Parallel()

	manager := NewWorkspaceManager(WorkspaceManagerOptions{})
	t.Cleanup(func() { _ = manager.Close() })
	dialReady := make(chan struct{}, maxWorkspaceConcurrentUploads)
	releaseDial := make(chan struct{})
	manager.dialTargetOverride = func(context.Context, WorkspaceTargetConfig) (*grpc.ClientConn, error) {
		dialReady <- struct{}{}
		<-releaseDial
		return grpc.NewClient("passthrough:///unused", grpc.WithTransportCredentials(insecure.NewCredentials()))
	}
	handler := Handler(nil, "", nil, nil, WithWorkspaceManager(manager))
	cookie := workspaceUploadCSRFCookie(t, handler)
	target := WorkspaceTargetConfig{Address: "unused", Plaintext: true, SchemaSource: "browser-proto-folder"}
	responses := make([]*httptest.ResponseRecorder, maxWorkspaceConcurrentUploads)
	done := make(chan struct{}, maxWorkspaceConcurrentUploads)
	for index := 0; index < maxWorkspaceConcurrentUploads; index++ {
		content := fmt.Sprintf(`syntax = "proto3"; package concurrent%d; message Request {}; service Service { rpc Call(Request) returns (Request); }`, index)
		manifest := workspaceUploadManifest{Version: 1, Files: []workspaceUploadManifestFile{{Path: fmt.Sprintf("service-%d.proto", index), Size: int64(len(content))}}}
		request := newWorkspaceUploadRequest(t, context.Background(), cookie, target, manifest, []testWorkspaceUploadPart{{
			name: "file.0", filename: "ignored", content: content,
		}})
		responses[index] = httptest.NewRecorder()
		go func(response *httptest.ResponseRecorder, request *http.Request) {
			handler.ServeHTTP(response, request)
			done <- struct{}{}
		}(responses[index], request)
	}
	for range maxWorkspaceConcurrentUploads {
		waitWorkspaceUploadSignal(t, dialReady, "concurrent target dial")
	}
	close(releaseDial)
	for range maxWorkspaceConcurrentUploads {
		waitWorkspaceUploadSignal(t, done, "concurrent publish")
	}
	for index, response := range responses {
		if response.Code != http.StatusOK {
			t.Fatalf("concurrent response %d status = %d, body = %q", index, response.Code, response.Body.String())
		}
	}
	if len(manager.sessions) != maxWorkspaceConcurrentUploads {
		t.Fatalf("concurrent publishes created %d sessions, want %d", len(manager.sessions), maxWorkspaceConcurrentUploads)
	}
}

func TestWorkspaceUploadManifestCaps(t *testing.T) {
	t.Parallel()

	filesAtCountLimit := make([]workspaceUploadManifestFile, maxWorkspaceUploadFiles)
	for index := range filesAtCountLimit {
		filesAtCountLimit[index] = workspaceUploadManifestFile{Path: fmt.Sprintf("file-%03d.proto", index)}
	}
	if err := validateWorkspaceUploadManifest(workspaceUploadManifest{Version: 1, Files: filesAtCountLimit}); err != nil {
		t.Fatalf("manifest at file-count cap rejected: %v", err)
	}
	if err := validateWorkspaceUploadManifest(workspaceUploadManifest{Version: 1, Files: append(filesAtCountLimit, workspaceUploadManifestFile{Path: "overflow.proto"})}); err == nil {
		t.Fatal("manifest above file-count cap was accepted")
	}

	if err := validateWorkspaceUploadManifest(workspaceUploadManifest{Version: 1, Files: []workspaceUploadManifestFile{{Path: "max.proto", Size: maxWorkspaceUploadFileBytes}}}); err != nil {
		t.Fatalf("manifest at per-file cap rejected: %v", err)
	}
	if err := validateWorkspaceUploadManifest(workspaceUploadManifest{Version: 1, Files: []workspaceUploadManifestFile{{Path: "max.proto", Size: maxWorkspaceUploadFileBytes + 1}}}); err == nil {
		t.Fatal("manifest above per-file cap was accepted")
	}

	aggregate := []workspaceUploadManifestFile{
		{Path: "one.proto", Size: maxWorkspaceUploadFileBytes},
		{Path: "two.proto", Size: maxWorkspaceUploadFileBytes},
		{Path: "three.proto", Size: maxWorkspaceUploadFileBytes},
		{Path: "four.proto", Size: maxWorkspaceUploadFileBytes},
	}
	if err := validateWorkspaceUploadManifest(workspaceUploadManifest{Version: 1, Files: aggregate}); err != nil {
		t.Fatalf("manifest at aggregate cap rejected: %v", err)
	}
	aggregate[3].Size++
	if err := validateWorkspaceUploadManifest(workspaceUploadManifest{Version: 1, Files: aggregate}); err == nil {
		t.Fatal("manifest above aggregate cap was accepted")
	}
}

func TestWorkspaceUploadPartContractAndLimits(t *testing.T) {
	t.Parallel()

	manager := NewWorkspaceManager(WorkspaceManagerOptions{})
	t.Cleanup(func() { _ = manager.Close() })
	handler := Handler(nil, "", nil, nil, WithWorkspaceManager(manager))
	target := WorkspaceTargetConfig{Address: "127.0.0.1:1", Plaintext: true, SchemaSource: "browser-proto-folder"}
	manifest := workspaceUploadManifest{Version: 1, Files: []workspaceUploadManifestFile{{Path: "one.proto", Size: 1}}}
	for _, test := range []struct {
		name  string
		parts []testWorkspaceUploadPart
	}{
		{name: "missing", parts: nil},
		{name: "wrong-order", parts: []testWorkspaceUploadPart{{name: "file.1", filename: "ignored", content: "x"}}},
		{name: "not-file", parts: []testWorkspaceUploadPart{{name: "file.0", content: "x"}}},
		{name: "short", parts: []testWorkspaceUploadPart{{name: "file.0", filename: "ignored", content: ""}}},
		{name: "long", parts: []testWorkspaceUploadPart{{name: "file.0", filename: "ignored", content: "xx"}}},
		{name: "extra", parts: []testWorkspaceUploadPart{{name: "file.0", filename: "ignored", content: "x"}, {name: "file.1", filename: "ignored", content: "x"}}},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			response := performWorkspaceUploadMultipartRequest(t, handler, target, manifest, test.parts)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
			}
		})
	}
}

func TestWorkspaceUploadHTTPRejectsManifestAndEnvelopeLimits(t *testing.T) {
	t.Parallel()

	manager := NewWorkspaceManager(WorkspaceManagerOptions{})
	t.Cleanup(func() { _ = manager.Close() })
	handler := Handler(nil, "", nil, nil, WithWorkspaceManager(manager))
	target := WorkspaceTargetConfig{Address: "127.0.0.1:1", Plaintext: true, SchemaSource: "browser-proto-folder"}

	tooManyFiles := make([]workspaceUploadManifestFile, maxWorkspaceUploadFiles+1)
	for index := range tooManyFiles {
		tooManyFiles[index] = workspaceUploadManifestFile{Path: fmt.Sprintf("file-%03d.proto", index)}
	}
	for _, manifest := range []workspaceUploadManifest{
		{Version: 1, Files: tooManyFiles},
		{Version: 1, Files: []workspaceUploadManifestFile{{Path: "large.proto", Size: maxWorkspaceUploadFileBytes + 1}}},
	} {
		response := performWorkspaceUploadMultipartRequest(t, handler, target, manifest, nil)
		if response.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("manifest limit status = %d, body = %q", response.Code, response.Body.String())
		}
	}

	duplicate := workspaceUploadManifest{Version: 1, Files: []workspaceUploadManifestFile{
		{Path: "api/Service.proto"},
		{Path: "API/service.proto"},
	}}
	if response := performWorkspaceUploadMultipartRequest(t, handler, target, duplicate, nil); response.Code != http.StatusBadRequest {
		t.Fatalf("case-fold duplicate status = %d, body = %q", response.Code, response.Body.String())
	}

	cookie := workspaceUploadCSRFCookie(t, handler)
	body := &countingReadCloser{reader: strings.NewReader("--x--\r\n")}
	request := httptest.NewRequest(http.MethodPost, "/api/workspace/connect", body)
	request.ContentLength = maxWorkspaceUploadBodyBytes + 1
	request.Header.Set("Content-Type", "multipart/form-data; boundary=x")
	request.Header.Set(csrfHeaderName, cookie.Value)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("declared oversized envelope status = %d, body = %q", response.Code, response.Body.String())
	}
	if body.reads != 0 {
		t.Fatalf("declared oversized envelope read body %d times", body.reads)
	}

	missingBoundary := httptest.NewRequest(http.MethodPost, "/api/workspace/connect", strings.NewReader("unused"))
	missingBoundary.Header.Set("Content-Type", "multipart/form-data")
	missingBoundary.Header.Set(csrfHeaderName, cookie.Value)
	missingBoundary.AddCookie(cookie)
	missingBoundaryResponse := httptest.NewRecorder()
	handler.ServeHTTP(missingBoundaryResponse, missingBoundary)
	if missingBoundaryResponse.Code != http.StatusBadRequest {
		t.Fatalf("missing boundary status = %d, body = %q", missingBoundaryResponse.Code, missingBoundaryResponse.Body.String())
	}
}

func TestWorkspaceUploadJSONPartsAreBoundedAndStrict(t *testing.T) {
	t.Parallel()

	manager := NewWorkspaceManager(WorkspaceManagerOptions{})
	t.Cleanup(func() { _ = manager.Close() })
	handler := Handler(nil, "", nil, nil, WithWorkspaceManager(manager))
	cookie := workspaceUploadCSRFCookie(t, handler)
	target := WorkspaceTargetConfig{Address: "127.0.0.1:1", Plaintext: true, SchemaSource: "browser-proto-folder"}
	targetJSON, err := json.Marshal(target)
	if err != nil {
		t.Fatalf("marshal target: %v", err)
	}
	manifestJSON := []byte(`{"version":1,"files":[{"path":"one.proto","size":0}]}`)

	for _, test := range []struct {
		name             string
		targetFilename   string
		targetPayload    []byte
		manifestFilename string
		manifestPayload  []byte
		wantStatus       int
	}{
		{name: "target-file", targetFilename: "target.json", targetPayload: targetJSON, manifestPayload: manifestJSON, wantStatus: http.StatusBadRequest},
		{name: "manifest-file", targetPayload: targetJSON, manifestFilename: "manifest.json", manifestPayload: manifestJSON, wantStatus: http.StatusBadRequest},
		{name: "manifest-unknown", targetPayload: targetJSON, manifestPayload: []byte(`{"version":1,"files":[{"path":"one.proto","size":0}],"unknown":true}`), wantStatus: http.StatusBadRequest},
		{name: "manifest-invalid-utf8", targetPayload: targetJSON, manifestPayload: []byte{'{', 0xff, '}'}, wantStatus: http.StatusBadRequest},
		{name: "target-over-cap", targetPayload: append(targetJSON, bytes.Repeat([]byte{' '}, int(maxWorkspaceUploadTargetBytes)+1)...), manifestPayload: manifestJSON, wantStatus: http.StatusRequestEntityTooLarge},
		{name: "manifest-over-cap", targetPayload: targetJSON, manifestPayload: append(manifestJSON, bytes.Repeat([]byte{' '}, int(maxWorkspaceUploadManifestBytes)+1)...), wantStatus: http.StatusRequestEntityTooLarge},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			request := newWorkspaceUploadRawJSONRequest(t, cookie, targetJSONPart{
				filename: test.targetFilename,
				contents: test.targetPayload,
			}, targetJSONPart{
				filename: test.manifestFilename,
				contents: test.manifestPayload,
			})
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d; body = %q", response.Code, test.wantStatus, response.Body.String())
			}
		})
	}
}

func TestWorkspaceUploadCancellationReleasesCapacity(t *testing.T) {
	t.Parallel()

	manager := NewWorkspaceManager(WorkspaceManagerOptions{})
	t.Cleanup(func() { _ = manager.Close() })
	handler := Handler(nil, "", nil, nil, WithWorkspaceManager(manager))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	response := performWorkspaceUploadRequestWithContext(t, ctx, handler, WorkspaceTargetConfig{
		Address:      "127.0.0.1:1",
		Plaintext:    true,
		SchemaSource: "browser-proto-folder",
	}, []testWorkspaceUploadFile{{path: "cancel.proto", content: `syntax = "proto3";`}})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("canceled status = %d, body = %q", response.Code, response.Body.String())
	}
	if len(manager.activeUploads) != 0 || len(manager.sessions) != 0 {
		t.Fatalf("canceled upload retained active=%d sessions=%d", len(manager.activeUploads), len(manager.sessions))
	}
}

func TestWorkspaceUploadCancellationAfterDialDoesNotPublish(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	manager := NewWorkspaceManager(WorkspaceManagerOptions{})
	t.Cleanup(func() { _ = manager.Close() })
	var returnedConnection *grpc.ClientConn
	manager.dialTargetOverride = func(context.Context, WorkspaceTargetConfig) (*grpc.ClientConn, error) {
		connection, err := grpc.NewClient("passthrough:///unused", grpc.WithTransportCredentials(insecure.NewCredentials()))
		if err != nil {
			return nil, err
		}
		returnedConnection = connection
		cancel()
		return connection, nil
	}
	handler := Handler(nil, "", nil, nil, WithWorkspaceManager(manager))
	response := performWorkspaceUploadRequestWithContext(t, ctx, handler, WorkspaceTargetConfig{
		Address:      "unused",
		Plaintext:    true,
		SchemaSource: "browser-proto-folder",
	}, []testWorkspaceUploadFile{{path: "cancel.proto", content: `syntax = "proto3"; package cancel; service Cancel {}`}})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("cancel-after-dial status = %d, body = %q", response.Code, response.Body.String())
	}
	if len(manager.sessions) != 0 {
		t.Fatalf("cancel-after-dial published %d sessions", len(manager.sessions))
	}
	if returnedConnection == nil || returnedConnection.GetState() != connectivity.Shutdown {
		t.Fatalf("cancel-after-dial connection state = %v, want SHUTDOWN", returnedConnection)
	}
}

func TestWorkspaceUploadResponseWriteFailureDisconnectsSession(t *testing.T) {
	t.Parallel()

	manager := NewWorkspaceManager(WorkspaceManagerOptions{})
	t.Cleanup(func() { _ = manager.Close() })
	handler := Handler(nil, "", nil, nil, WithWorkspaceManager(manager))
	cookie := workspaceUploadCSRFCookie(t, handler)
	target := WorkspaceTargetConfig{
		Address:      startWorkspaceUploadGRPCTarget(t),
		Plaintext:    true,
		SchemaSource: "browser-proto-folder",
	}
	content := `syntax = "proto3"; package writefail; service WriteFail {}`
	manifest := workspaceUploadManifest{Version: 1, Files: []workspaceUploadManifestFile{{Path: "write.proto", Size: int64(len(content))}}}
	request := newWorkspaceUploadRequest(t, context.Background(), cookie, target, manifest, []testWorkspaceUploadPart{{
		name: "file.0", filename: "ignored", content: content,
	}})
	response := &failingWorkspaceUploadResponseWriter{header: make(http.Header)}
	handler.ServeHTTP(response, request)
	if response.writes == 0 {
		t.Fatal("handler did not attempt to encode the connect response")
	}
	if len(manager.sessions) != 0 {
		t.Fatalf("response write failure left %d unreachable sessions", len(manager.sessions))
	}
}

func performWorkspaceUploadRequest(t *testing.T, handler http.Handler, target WorkspaceTargetConfig, files []testWorkspaceUploadFile) *httptest.ResponseRecorder {
	return performWorkspaceUploadRequestWithContext(t, context.Background(), handler, target, files)
}

func performWorkspaceUploadRequestWithContext(t *testing.T, ctx context.Context, handler http.Handler, target WorkspaceTargetConfig, files []testWorkspaceUploadFile) *httptest.ResponseRecorder {
	t.Helper()
	manifest := workspaceUploadManifest{Version: 1}
	parts := make([]testWorkspaceUploadPart, 0, len(files))
	for _, file := range files {
		manifest.Files = append(manifest.Files, workspaceUploadManifestFile{Path: file.path, Size: int64(len(file.content))})
		parts = append(parts, testWorkspaceUploadPart{
			name:     fmt.Sprintf("file.%d", len(parts)),
			filename: "ignored.proto",
			content:  file.content,
		})
	}
	return performWorkspaceUploadMultipartRequestWithContext(t, ctx, handler, target, manifest, parts)
}

func performWorkspaceUploadMultipartRequest(t *testing.T, handler http.Handler, target WorkspaceTargetConfig, manifest workspaceUploadManifest, parts []testWorkspaceUploadPart) *httptest.ResponseRecorder {
	return performWorkspaceUploadMultipartRequestWithContext(t, context.Background(), handler, target, manifest, parts)
}

func performWorkspaceUploadMultipartRequestWithContext(t *testing.T, ctx context.Context, handler http.Handler, target WorkspaceTargetConfig, manifest workspaceUploadManifest, parts []testWorkspaceUploadPart) *httptest.ResponseRecorder {
	t.Helper()

	cookie := workspaceUploadCSRFCookie(t, handler)
	request := newWorkspaceUploadRequest(t, ctx, cookie, target, manifest, parts)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func newWorkspaceUploadRequest(t *testing.T, ctx context.Context, cookie *http.Cookie, target WorkspaceTargetConfig, manifest workspaceUploadManifest, parts []testWorkspaceUploadPart) *http.Request {
	t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	targetPart, err := writer.CreateFormField("target")
	if err != nil {
		t.Fatalf("create target part: %v", err)
	}
	if err := json.NewEncoder(targetPart).Encode(target); err != nil {
		t.Fatalf("encode target: %v", err)
	}
	manifestPart, err := writer.CreateFormField("manifest")
	if err != nil {
		t.Fatalf("create manifest part: %v", err)
	}
	if err := json.NewEncoder(manifestPart).Encode(manifest); err != nil {
		t.Fatalf("encode manifest: %v", err)
	}
	for index, file := range parts {
		var part io.Writer
		var err error
		if file.filename == "" {
			part, err = writer.CreateFormField(file.name)
		} else {
			part, err = writer.CreateFormFile(file.name, file.filename)
		}
		if err != nil {
			t.Fatalf("create file part %d: %v", index, err)
		}
		if _, err := part.Write([]byte(file.content)); err != nil {
			t.Fatalf("write file part %d: %v", index, err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart body: %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/api/workspace/connect", &body).WithContext(ctx)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set(csrfHeaderName, cookie.Value)
	request.AddCookie(cookie)
	return request
}

func newWorkspaceUploadRawJSONRequest(t *testing.T, cookie *http.Cookie, targetPart targetJSONPart, manifestPart targetJSONPart) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	writePart := func(name string, part targetJSONPart) {
		var destination io.Writer
		var err error
		if part.filename == "" {
			destination, err = writer.CreateFormField(name)
		} else {
			destination, err = writer.CreateFormFile(name, part.filename)
		}
		if err != nil {
			t.Fatalf("create raw %s part: %v", name, err)
		}
		if _, err := destination.Write(part.contents); err != nil {
			t.Fatalf("write raw %s part: %v", name, err)
		}
	}
	writePart("target", targetPart)
	writePart("manifest", manifestPart)
	if err := writer.Close(); err != nil {
		t.Fatalf("close raw multipart body: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/workspace/connect", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set(csrfHeaderName, cookie.Value)
	request.AddCookie(cookie)
	return request
}

func workspaceUploadCSRFCookie(t *testing.T, handler http.Handler) *http.Cookie {
	t.Helper()
	bootstrapResponse := httptest.NewRecorder()
	handler.ServeHTTP(bootstrapResponse, httptest.NewRequest(http.MethodGet, "/", nil))
	cookies := bootstrapResponse.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("handler did not issue a CSRF cookie")
	}
	return cookies[0]
}

type countingReadCloser struct {
	reader io.Reader
	reads  int
}

func (r *countingReadCloser) Read(buffer []byte) (int, error) {
	r.reads++
	return r.reader.Read(buffer)
}

func (*countingReadCloser) Close() error { return nil }

type failingWorkspaceUploadResponseWriter struct {
	header http.Header
	writes int
}

func (w *failingWorkspaceUploadResponseWriter) Header() http.Header { return w.header }

func (*failingWorkspaceUploadResponseWriter) WriteHeader(int) {}

func (w *failingWorkspaceUploadResponseWriter) Write([]byte) (int, error) {
	w.writes++
	return 0, errors.New("injected response write failure")
}

func waitWorkspaceUploadSignal(t *testing.T, signal <-chan struct{}, description string) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for %s", description)
	}
}

func startWorkspaceUploadGRPCTarget(t *testing.T) string {
	t.Helper()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen for test gRPC target: %v", err)
	}
	server := grpc.NewServer()
	done := make(chan struct{})
	go func() {
		_ = server.Serve(listener)
		close(done)
	}()
	t.Cleanup(func() {
		server.Stop()
		_ = listener.Close()
		<-done
	})
	return listener.Addr().String()
}
