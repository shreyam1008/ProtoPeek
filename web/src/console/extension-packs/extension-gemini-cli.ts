import type { ExtensionPack } from '../extension-pack';

const extension = {
  tool: 'Gemini CLI',
  download: 'https://geminicli.com/docs/get-started/installation/',
  guide: 'https://geminicli.com/docs/tools/mcp-server/',
  setup: 'Install Gemini CLI with Node.js 20+ and sign in.',
  afterSetup:
    'Pair in AI agent setup and merge the Gemini CLI mcpServers snippet into settings.json.',
  notes: [
    'The command and arguments refer to your paired local workbench, not a hosted connector.',
    'Client configuration checked October 2026. Verify pairing in the client.',
  ],
  client: 'gemini-cli',
} satisfies ExtensionPack;

export default extension;
