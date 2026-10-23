import type { ExtensionPack } from '../extension-pack';

const extension = {
  tool: 'cloudflared',
  download:
    'https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/',
  guide: 'https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/',
  setup: {
    windows:
      'Install cloudflared using the official Windows instructions and make it available on PATH.',
    darwin: 'Use the official macOS package instructions to install cloudflared.',
    linux: 'Use the official repository or package for your distribution and architecture.',
  },
  afterSetup:
    'Open the workbench to inspect configuration and service state. Installing the connector does not publish a service.',
  notes: [
    'Config writes require the exact supported user-owned canonical file, fresh revision and explicit review.',
    'Owned foreground publishing is gated to Windows/Linux; macOS modes remain unavailable. Account and cleanup acceptance are separate.',
  ],
  route: '/tunnels',
  openLabel: 'Open Cloudflare Tunnel',
} satisfies ExtensionPack;

export default extension;
