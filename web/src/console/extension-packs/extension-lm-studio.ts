import type { ExtensionPack } from '../extension-pack';

const extension = {
  client: 'lm-studio',
  tool: 'lms CLI',
  download: 'https://lmstudio.ai/download',
  guide: 'https://lmstudio.ai/docs/developer/openai-compat',
  setup: {
    windows:
      'Use the official Windows build and review CPU/GPU requirements; start LM Studio or llmster yourself.',
    darwin:
      'Use a supported Apple Silicon Mac; current official requirements do not support Intel Macs.',
    linux: 'Use an official supported Linux build and check CPU/GPU and distribution requirements.',
  },
  afterSetup:
    'Enable your local HTTP server separately and set its actual port. The example uses 1234; finding lms does not prove that the server or a model is running.',
  notes: [
    'Never publish the model-server port. ProtoPeek does not start the app/daemon or download/load models.',
    'CLI location is separate from app, model and server readiness. Native runtime acceptance remains separate.',
  ],
  endpoint: {
    url: 'http://127.0.0.1:1234/v1/models',
    notice:
      "Example loopback API. Confirm your running server's port/authentication before Send; never expose this port publicly.",
  },
} satisfies ExtensionPack;

export default extension;
