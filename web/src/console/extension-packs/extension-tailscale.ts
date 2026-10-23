import type { ExtensionPack } from '../extension-pack';

const extension = {
  tool: 'Tailscale app and CLI',
  download: 'https://tailscale.com/download',
  guide: 'https://tailscale.com/docs/install',
  setup: {
    windows: 'Install Tailscale for Windows, then sign in through its app.',
    darwin: 'Install Tailscale for macOS and follow its CLI setup instructions.',
    linux: 'Install the package for your distribution and connect through Tailscale.',
  },
  afterSetup:
    'Open the workbench to inspect connection state. Finding the CLI does not prove that you are signed in or connected.',
  notes: [
    'Headscale uses the separate HTTPS login-server account flow; this guide does not administer its server.',
    'Temporary Serve/Funnel needs the reviewed publishing workflow, explicit audience and supported native platform.',
  ],
  route: '/network/tailnet',
  openLabel: 'Open Tailscale',
} satisfies ExtensionPack;

export default extension;
