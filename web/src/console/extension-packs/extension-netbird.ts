import type { ExtensionPack } from '../extension-pack';

const extension = {
  tool: 'netbird',
  download: 'https://docs.netbird.io/get-started/install',
  guide: 'https://docs.netbird.io/manage/peers/peer-management',
  setup: {
    windows: 'Install the official NetBird Windows client and its daemon.',
    darwin: 'Install the official NetBird macOS client and its daemon.',
    linux: 'Install NetBird using the official package instructions for your distribution.',
  },
  afterSetup:
    'Sign in with the native client first. ProtoPeek inspects only when requested; installation is separate from connection.',
  notes: [
    'Sign-in and enrollment remain in the installed native client.',
    'A located CLI does not prove daemon readiness, a connected peer or network reachability.',
  ],
  route: '/extensions/netbird',
  openLabel: 'Open NetBird',
} satisfies ExtensionPack;

export default extension;
