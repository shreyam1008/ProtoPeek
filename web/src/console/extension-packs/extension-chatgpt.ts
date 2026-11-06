import type { ExtensionPack } from '../extension-pack';

const extension = {
  tool: 'ChatGPT web (external)',
  download: 'https://chatgpt.com/',
  guide: 'https://help.openai.com/en/articles/11487775-connected-apps-in-chatgpt',
  setup: {
    windows: 'Open ChatGPT in your browser.',
    darwin: 'Open ChatGPT in your browser.',
    linux: 'Open ChatGPT in your browser.',
  },
  afterSetup: 'Copy the prompt and review any evidence before sharing it in ChatGPT.',
  notes: [
    'ChatGPT web does not read local Codex config. ProtoPeek supplies no hosted account, public MCP relay or web stdio connector.',
    'For local stdio, use the separate Codex CLI setup.',
  ],
  commands: [
    {
      label: 'Companion prompt — no service data',
      text: 'Help me plan a local service check with ProtoPeek. Ask which protocol and evidence I need. Do not assume access to my computer or run any action.',
    },
  ],
} satisfies ExtensionPack;

export default extension;
