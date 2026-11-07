import type { ExtensionPack } from '../extension-pack';

const extension = {
  tool: 'caddy',
  download: 'https://caddyserver.com/docs/install',
  guide: 'https://caddyserver.com/docs/api',
  setup: {
    windows: 'Install the managed companion above, or add an external Caddy binary to PATH.',
    darwin: 'Install the managed companion above, or install Caddy separately and add it to PATH.',
    linux:
      'Install the managed companion above, or install a distribution package. Some packages start a service.',
  },
  afterSetup: 'Start Caddy, then inspect upstreams through its local admin API.',
  notes: [
    'Never publish the Caddy admin port. This guide does not edit configuration or own a service.',
    'Upstream addresses can be private. Verify the chosen host and port before sending.',
  ],
  commands: [
    {
      label: 'Check the managed Caddy version',
      text: 'pp extensions run caddy version',
    },
    {
      label: 'Check a Caddy on PATH',
      text: 'caddy version',
    },
  ],
  endpoint: {
    url: 'http://127.0.0.1:2019/reverse_proxy/upstreams',
    notice:
      'Example loopback admin API, not full /config/. Keep this port private; the draft remains unsent.',
  },
} satisfies ExtensionPack;

export default extension;
