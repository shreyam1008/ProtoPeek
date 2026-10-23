import type { ExtensionPack } from '../extension-pack';

const extension = {
  tool: 'Gemini CLI',
  download: 'https://geminicli.com/docs/get-started/installation/',
  guide: 'https://geminicli.com/docs/tools/mcp-server/',
  setup: {
    windows:
      "Use the official supported Windows setup with Node.js 20+; check the vendor's current OS requirements.",
    darwin: 'Use the official macOS setup with Node.js 20+ and complete your own authentication.',
    linux: 'Use the official Linux setup with Node.js 20+ and complete your own authentication.',
  },
  afterSetup:
    'Pair in AI agent setup, select Gemini CLI and merge the mcpServers fragment into settings.json. Keep your existing settings intact.',
  notes: [
    'The command and arguments refer to your paired local workbench, not a hosted connector.',
    'Format checked against official docs on 23 October 2026. Model access, supported OS versions and native client acceptance are separate.',
  ],
  client: 'gemini-cli',
} satisfies ExtensionPack;

export default extension;
