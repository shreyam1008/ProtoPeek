package standalone

import (
	"encoding/json"
	"testing"

	oldproto "github.com/golang/protobuf/proto"
	"github.com/golang/protobuf/protoc-gen-go/descriptor"
	"github.com/jhump/protoreflect/desc"
)

func TestBootstrapCollectionsAreArrays(t *testing.T) {
	t.Parallel()

	encoded, err := buildBootstrap("", nil, &handlerOptions{})
	if err != nil {
		t.Fatalf("build bootstrap: %v", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(encoded, &payload); err != nil {
		t.Fatalf("unmarshal bootstrap: %v", err)
	}
	assertJSONArray(t, payload, "defaultMetadata")
	assertJSONArray(t, payload, "services")
	defaults := payload["targetDefaults"].(map[string]any)
	assertJSONArray(t, defaults, "protoFiles")
	assertJSONArray(t, defaults, "importPaths")
	assertJSONArray(t, defaults, "protosets")
}

func TestProtoCatalogCollectionsAreArraysRecursively(t *testing.T) {
	t.Parallel()

	file, err := desc.CreateFileDescriptor(&descriptor.FileDescriptorProto{
		Name:    oldproto.String("sparse.proto"),
		Package: oldproto.String("test"),
		MessageType: []*descriptor.DescriptorProto{{
			Name: oldproto.String("Empty"),
		}},
	})
	if err != nil {
		t.Fatalf("create descriptor: %v", err)
	}
	encoded, err := buildProtoCatalog([]*desc.FileDescriptor{file})
	if err != nil {
		t.Fatalf("build proto catalog: %v", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(encoded, &payload); err != nil {
		t.Fatalf("unmarshal catalog: %v", err)
	}
	files := assertJSONArray(t, payload, "files")
	fileJSON := files[0].(map[string]any)
	assertJSONArray(t, fileJSON, "dependencies")
	assertJSONArray(t, fileJSON, "services")
	messages := assertJSONArray(t, fileJSON, "messages")
	assertJSONArray(t, fileJSON, "enums")
	messageJSON := messages[0].(map[string]any)
	assertJSONArray(t, messageJSON, "fields")
	assertJSONArray(t, messageJSON, "messages")
	assertJSONArray(t, messageJSON, "enums")
}

func assertJSONArray(t *testing.T, object map[string]any, key string) []any {
	t.Helper()
	value, ok := object[key].([]any)
	if !ok {
		t.Fatalf("%s = %#v, want JSON array", key, object[key])
	}
	return value
}
