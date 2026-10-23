import { describe, expect, it } from 'vitest';
import { agentClientConfig, agentClients } from './agent-client-config';
import { agentClient, agentClientIds } from './agent-client-kind';

const executable = 'C:\\A space\\$cash\\श्रेया\\"quoted"\\protopeek.exe';
const connectionFile = 'C:\\Private\\agent "quoted"\\instance.json';

describe('local MCP client file fragments (vendor docs checked 2026-10-23)', () => {
  it('round-trips literal paths through each JSON profile without shell commands or tokens', () => {
    for (const client of ['claude-code', 'gemini-cli', 'lm-studio', 'generic'] as const) {
      expect(JSON.parse(agentClientConfig(client, executable, connectionFile) ?? '')).toEqual({
        mcpServers: {
          protopeek: {
            command: executable,
            args: ['mcp'],
            env: { PROTOPEEK_AGENT_CONNECTION: connectionFile },
          },
        },
      });
      expect(agentClients[client].file).toBeTruthy();
      expect(agentClients[client].key).toBe('mcpServers.protopeek');
    }
  });

  it('uses OpenCode’s local command array and environment schema', () => {
    expect(JSON.parse(agentClientConfig('opencode', executable, connectionFile) ?? '')).toEqual({
      mcp: {
        protopeek: {
          type: 'local',
          command: [executable, 'mcp'],
          environment: { PROTOPEEK_AGENT_CONNECTION: connectionFile },
          enabled: true,
        },
      },
    });
    expect(agentClients.opencode.key).toBe('mcp.protopeek');
  });

  it('emits Codex TOML tables and escapes Windows paths, quotes, newlines and DEL', () => {
    expect(agentClientConfig('codex', executable, `${connectionFile}\n\u007f`)).toBe(
      '[mcp_servers.protopeek]\ncommand = "C:\\\\A space\\\\$cash\\\\श्रेया\\\\\\"quoted\\"\\\\protopeek.exe"\nargs = ["mcp"]\n\n[mcp_servers.protopeek.env]\nPROTOPEEK_AGENT_CONNECTION = "C:\\\\Private\\\\agent \\"quoted\\"\\\\instance.json\\n\\u007f"\n'
    );
    expect(agentClients.codex.file).toBe('~/.codex/config.toml');
  });

  it('cannot produce a usable-looking configuration without both observed paths', () => {
    for (const client of agentClientIds) {
      expect(agentClientConfig(client, executable, '')).toBeNull();
      expect(agentClientConfig(client, '', connectionFile)).toBeNull();
      expect(agentClientConfig(client, '  ', connectionFile)).toBeNull();
      expect(agentClientConfig(client, executable, '\n ')).toBeNull();
    }
  });

  it('accepts only the six local client route IDs', () => {
    for (const client of agentClientIds) expect(agentClient(client)).toBe(client);
    for (const invalid of ['chatgpt-web', 'Codex', 'codex ', ['codex'], {}, null, '__proto__']) {
      expect(agentClient(invalid)).toBeUndefined();
    }
  });
});
