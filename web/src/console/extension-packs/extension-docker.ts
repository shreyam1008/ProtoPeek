import type { ExtensionPack } from '../extension-pack';

const extension = {
  tool: 'docker CLI',
  download: 'https://docs.docker.com/get-started/get-docker/',
  guide: 'https://docs.docker.com/engine/network/port-publishing/',
  setup: {
    windows: 'Install Docker Desktop and its Windows backend. Check commercial terms.',
    darwin: 'Install Docker Desktop for your CPU and start it.',
    linux: 'Install Docker Engine or Desktop.',
  },
  afterSetup: 'Read the container’s published port in Docker and use it in the HTTP draft.',
  notes: [
    'Manage images, containers and port bindings in Docker.',
    'Bind to loopback and use the mapped host port.',
  ],
  commands: [
    {
      label: 'Example: inspect existing mapped ports',
      text: 'docker port example-container',
    },
  ],
  endpoint: {
    url: 'http://127.0.0.1:8080/',
    notice: 'Confirm the container and mapped loopback port before Send.',
  },
} satisfies ExtensionPack;

export default extension;
