import type { ExtensionPack } from '../extension-pack';

const extension = {
  client: 'lm-studio',
  tool: 'lms CLI',
  download: 'https://lmstudio.ai/download',
  guide: 'https://lmstudio.ai/docs/developer/openai-compat',
  setup: {
    windows: 'Install LM Studio for your CPU/GPU, then start its local server.',
    darwin: 'Use an Apple Silicon Mac and start the local server.',
    linux: 'Install a supported Linux build for your CPU/GPU.',
  },
  afterSetup: 'Start your local server. Set the draft to its listening port (typically 1234).',
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
