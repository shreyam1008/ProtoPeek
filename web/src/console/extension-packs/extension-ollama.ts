import type { ExtensionPack } from '../extension-pack';

const extension = {
  tool: 'ollama CLI',
  download: 'https://ollama.com/download',
  guide: 'https://docs.ollama.com/api/introduction',
  setup: {
    windows:
      'Use the official Windows app; review its background-server behavior and hardware requirements.',
    darwin: 'Use the official macOS app and review hardware needs before choosing a local model.',
    linux:
      'Follow the official Linux installation/service instructions; start your server deliberately.',
  },
  afterSetup:
    'Prepare the model-list request for your own running local server. Installation, server startup and model download/loading are separate steps.',
  notes: [
    'Never publish the model-server port. ProtoPeek does not download models, sign in or start Ollama.',
    'Native streaming JSON is not SSE. Keep the actual protocol and response limits visible.',
  ],
  endpoint: {
    url: 'http://127.0.0.1:11434/api/tags',
    notice:
      'Example loopback model API. Verify your server and authentication; never expose this port. The draft remains unsent.',
  },
} satisfies ExtensionPack;

export default extension;
