import type { ExtensionPack } from '../extension-pack';

const extension = {
  tool: 'Codex CLI',
  download: 'https://learn.chatgpt.com/docs/codex/cli',
  guide: 'https://learn.chatgpt.com/docs/extend/mcp',
  setup: {
    windows:
      'Follow the official native Windows CLI setup and sign in with your chosen authentication method.',
    darwin: 'Use the official macOS installer or package instructions, then sign in yourself.',
    linux: 'Use the official Linux installer or package instructions, then sign in yourself.',
  },
  afterSetup:
    'Open AI agent setup, pair a local connection and select Codex. Merge the generated TOML fragment into Codex configuration; do not replace the whole file.',
  notes: [
    'The recipe needs the actual pairing-file location. Never paste its private token into chat.',
    'Format checked against official docs on 23 October 2026. Native client/account acceptance is separate.',
  ],
  client: 'codex',
} satisfies ExtensionPack;

export default extension;
