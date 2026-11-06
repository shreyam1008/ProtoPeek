import type { ExtensionPack } from '../extension-pack';

const extension = {
  tool: 'OpenCode',
  download: 'https://opencode.ai/docs/',
  guide: 'https://opencode.ai/docs/mcp-servers/',
  setup: {
    windows: 'Install natively or use the recommended WSL workflow.',
    darwin: 'Install OpenCode and configure a provider.',
    linux: 'Install OpenCode and configure a provider.',
  },
  afterSetup: 'Pair in AI agent setup and merge the OpenCode MCP fragment into your configuration.',
  notes: [
    'A client running in WSL has different executable paths and network context from the Windows host.',
    'Client configuration checked October 2026. Verify pairing in the client.',
  ],
  client: 'opencode',
} satisfies ExtensionPack;

export default extension;
