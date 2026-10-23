// Package catalogids is the dependency-free extension identity and capability contract.
package catalogids

type Entry struct {
	ID         string `json:"id"`
	Capability string `json:"capability"`
}

var entries = [...]Entry{
	{"tailscale", "native-workbench"},
	{"cloudflared", "native-workbench"},
	{"netbird", "native-workbench"},
	{"wireshark", "native-workbench"},
	{"nmap", "native-workbench"},
	{"aria2", "native-workbench"},
	{"caddy", "command-guide"},
	{"ngrok", "command-guide"},
	{"openssh", "command-guide"},
	{"docker", "command-guide"},
	{"podman", "command-guide"},
	{"kubectl", "command-guide"},
	{"openssl", "command-guide"},
	{"codex", "mcp-setup"},
	{"claude-code", "mcp-setup"},
	{"gemini-cli", "mcp-setup"},
	{"opencode", "mcp-setup"},
	{"ollama", "endpoint-guide"},
	{"lm-studio", "endpoint-guide"},
	{"chatgpt", "external-link"},
}

func All() []Entry { return append([]Entry(nil), entries[:]...) }

func Lookup(id string) (Entry, bool) {
	for _, entry := range entries {
		if entry.ID == id {
			return entry, true
		}
	}
	return Entry{}, false
}
