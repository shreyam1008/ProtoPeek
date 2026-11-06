import type { ExtensionPack } from '../extension-pack';

const extension = {
  tool: 'podman CLI',
  download: 'https://podman.io/docs/installation',
  guide: 'https://docs.podman.io/en/latest/markdown/podman-port.1.html',
  setup: {
    windows: 'Install Podman and set up its WSL2 machine.',
    darwin: 'Install Podman and initialize its VM.',
    linux: 'Install Podman and configure rootless operation if needed.',
  },
  afterSetup: 'Check the running container’s mapped port in Podman, then open it in HTTP.',
  notes: [
    'This guide does not create or start machines, contact Podman, pull images or run containers.',
    'Keep local services bound to loopback. A guest port can differ from its host mapping.',
  ],
  commands: [
    {
      label: 'Example: inspect existing mapped ports',
      text: 'podman port example-container',
    },
  ],
  endpoint: {
    url: 'http://127.0.0.1:8080/',
    notice:
      'Example host HTTP port. Confirm your running container/machine and its actual port mapping before Send.',
  },
} satisfies ExtensionPack;

export default extension;
