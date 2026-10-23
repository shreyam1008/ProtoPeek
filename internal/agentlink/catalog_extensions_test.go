package agentlink

import (
	"encoding/json"
	"testing"

	"github.com/shreyam1008/ProtoPeek/internal/extensions/catalogids"
)

func TestExtensionAgentCatalogOnlyAllowsFixedReadOnlyMetadataTools(t *testing.T) {
	if len(Tools()) != 23 {
		t.Fatalf("tool count=%d", len(Tools()))
	}
	list, err := Lookup("extensions_list", json.RawMessage(`{}`))
	if err != nil || list.Writes || list.Method != "GET" || list.Endpoint != "/api/extensions/catalog" || list.MaxDurationSeconds != 5 {
		t.Fatalf("list=%+v err=%v", list, err)
	}
	for _, entry := range catalogids.All() {
		input, _ := json.Marshal(map[string]string{"id": entry.ID})
		tool, err := Lookup("extension_inspect", input)
		if err != nil || tool.Writes || tool.Method != "GET" || tool.Endpoint != "/api/extensions" || tool.MaxDurationSeconds != 30 {
			t.Fatalf("inspect=%+v err=%v", tool, err)
		}
	}
	for _, input := range []string{`{}`, `{"id":"../caddy"}`, `{"id":"ssh"}`, `{"id":"caddy","path":"/private"}`, `{"id":"caddy","command":"run"}`, `{"id":["caddy"]}`} {
		if _, err := Lookup("extension_inspect", json.RawMessage(input)); err == nil {
			t.Fatalf("unsafe inspection arguments accepted: %s", input)
		}
	}
	if _, err := Lookup("extensions_list", json.RawMessage(`{"inspect":true}`)); err == nil {
		t.Fatal("metadata list accepted a lookup operation")
	}
}
