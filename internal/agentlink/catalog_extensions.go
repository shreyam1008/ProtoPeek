package agentlink

import (
	"encoding/json"

	"github.com/shreyam1008/ProtoPeek/internal/extensions/catalogids"
)

func extensionTools() []Tool {
	entries := catalogids.All()
	ids := make([]string, len(entries))
	for i, entry := range entries {
		ids[i] = entry.ID
	}
	enum, _ := json.Marshal(ids)
	return []Tool{
		{Name: "extensions_list", Description: "Read the fixed optional-extension IDs and capability levels. Metadata only: no host lookup, executable, provider, account or network probe. A guide or external link is not a native workbench.", Route: "/extensions", Method: "GET", Endpoint: "/api/extensions/catalog", MaxDurationSeconds: 5, InputSchema: json.RawMessage(object("", ""))},
		{Name: "extension_inspect", Description: "Locate one fixed optional command without running it. Shares bounded local executable-path metadata with this paired client/model; does not verify daemon, login, model or endpoint readiness. ChatGPT is external guidance with no lookup. Aria2 may read its saved engine setting and verify an existing cached bundle checksum. Slow filesystem calls can outlive cancellation; at most two lookups keep their slots until they return.", Route: "/extensions", Method: "GET", Endpoint: "/api/extensions", MaxDurationSeconds: 30, InputSchema: json.RawMessage(object(`"id":{"type":"string","enum":`+string(enum)+`}`, `"id"`))},
	}
}
