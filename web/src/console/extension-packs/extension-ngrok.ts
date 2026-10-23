import type { ExtensionPack } from '../extension-pack';

const extension = {
  tool: 'ngrok',
  download: 'https://ngrok.com/download',
  guide: 'https://ngrok.com/docs/getting-started/',
  setup: {
    windows: "Use ngrok's official Windows installer and complete native account setup.",
    darwin: "Use ngrok's official macOS package or binary and complete native account setup.",
    linux: "Use ngrok's official repository or binary for your architecture.",
  },
  afterSetup:
    'Requires your ngrok account. Review the service, authentication and intended public audience before running the example yourself; ProtoPeek does not own this tunnel.',
  notes: [
    'Running the example in your terminal creates a public endpoint. Choosing this guide does not publish anything.',
    "Never expose admin or model-server ports. Keep authtokens in ngrok's native configuration.",
  ],
  commands: [
    {
      label: 'Example: publish your chosen HTTP service',
      text: 'ngrok http http://127.0.0.1:8080',
    },
  ],
} satisfies ExtensionPack;

export default extension;
