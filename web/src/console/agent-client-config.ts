import type { AgentClient } from './agent-client-kind';

// File formats checked against the linked vendor docs on 2026-10-23.
// These fragments never contain the pairing secret: the native MCP process reads
// the private connection file, which is specific to the running workbench.
export const agentClients: Record<
  AgentClient,
  { label: string; file: string; key: string; docs?: string }
> = {
  codex: {
    label: 'Codex CLI',
    file: '~/.codex/config.toml',
    key: 'mcp_servers.protopeek',
    docs: 'https://learn.chatgpt.com/docs/extend/mcp?surface=cli',
  },
  'claude-code': {
    label: 'Claude Code',
    file: '.mcp.json in your project',
    key: 'mcpServers.protopeek',
    docs: 'https://code.claude.com/docs/en/mcp',
  },
  'gemini-cli': {
    label: 'Gemini CLI',
    file: '~/.gemini/settings.json',
    key: 'mcpServers.protopeek',
    docs: 'https://geminicli.com/docs/tools/mcp-server/',
  },
  opencode: {
    label: 'OpenCode',
    file: 'opencode.json in your project',
    key: 'mcp.protopeek',
    docs: 'https://opencode.ai/docs/mcp-servers/',
  },
  'lm-studio': {
    label: 'LM Studio',
    file: 'mcp.json (Program → Install → Edit mcp.json)',
    key: 'mcpServers.protopeek',
    docs: 'https://lmstudio.ai/docs/app/mcp',
  },
  generic: {
    label: 'Other local MCP client',
    file: 'your client’s MCP JSON configuration',
    key: 'mcpServers.protopeek',
  },
};

// TOML basic strings share JSON's quoting except that DEL requires a Unicode
// escape. These are file-format strings, never interpolated shell commands.
function tomlString(value: string) {
  return JSON.stringify(value).replaceAll('\u007f', '\\u007f');
}

export function agentClientConfig(
  client: AgentClient,
  executable: string,
  connectionFile: string
): string | null {
  if (!executable.trim() || !connectionFile.trim()) return null;
  const env = { PROTOPEEK_AGENT_CONNECTION: connectionFile };
  if (client === 'codex') {
    return `[mcp_servers.protopeek]\ncommand = ${tomlString(executable)}\nargs = ["mcp"]\n\n[mcp_servers.protopeek.env]\nPROTOPEEK_AGENT_CONNECTION = ${tomlString(connectionFile)}\n`;
  }
  return JSON.stringify(
    client === 'opencode'
      ? {
          mcp: {
            protopeek: {
              type: 'local',
              command: [executable, 'mcp'],
              environment: env,
              enabled: true,
            },
          },
        }
      : { mcpServers: { protopeek: { command: executable, args: ['mcp'], env } } },
    null,
    2
  );
}
