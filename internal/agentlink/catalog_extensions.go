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
		{Name: "managed_tools", Description: "Read local availability for aria2, cloudflared, yt-dlp, gallery-dl, Deno and FFmpeg. Media status inspects metadata and receipts; managed bytes are verified before use or removal. No tool starts and no network request is made. Manage aria2 and cloudflared in Extensions, and media tools in Files or the local CLI.", Route: "/extensions", Method: "GET", Endpoint: "/api/extensions/managed", MaxDurationSeconds: 30, InputSchema: json.RawMessage(object("", ""))},
		{Name: "extensions_list", Description: "Read the fixed optional-extension IDs and capability levels. Metadata only: no host lookup, executable, provider, account or network probe. A guide or external link is not a native workbench.", Route: "/extensions", Method: "GET", Endpoint: "/api/extensions/catalog", MaxDurationSeconds: 5, InputSchema: json.RawMessage(object("", ""))},
		{Name: "extension_inspect", Description: "Locate one fixed optional command without running it. Shares bounded local executable-path metadata with this paired client/model; does not verify daemon, login, model or endpoint readiness. ChatGPT is external guidance with no lookup. Aria2 may read its saved engine setting and verify an existing cached bundle checksum. Slow filesystem calls can outlive cancellation; at most two lookups keep their slots until they return.", Route: "/extensions", Method: "GET", Endpoint: "/api/extensions", MaxDurationSeconds: 30, InputSchema: json.RawMessage(object(`"id":{"type":"string","enum":`+string(enum)+`}`, `"id"`))},
	}
}
