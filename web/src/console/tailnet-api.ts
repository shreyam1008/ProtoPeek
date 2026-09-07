export type TailPeer = {
  id: string;
  name: string;
  dnsName: string;
  os: string;
  ips: string[];
  routes: string[];
  online: boolean | null;
  active: boolean;
  connection: string;
  endpoint: string;
  relay: string;
  exitNode: boolean;
  exitNodeOption: boolean;
  taildropAvailable: boolean;
  fileSharingReason: string;
  lastSeen: string;
  lastHandshake: string;
  keyExpiry: string;
  rxBytes: string;
  txBytes: string;
};
export type TailProfile = {
  id: string;
  nickname: string;
  tailnet: string;
  account: string;
  selected: boolean;
};
export type TailSnapshot = {
  available: boolean;
  path: string;
  observedAt: string;
  revision: string;
  version: string;
  state: string;
  tailnet: string;
  magicDNS: string;
  self: TailPeer | null;
  peers: TailPeer[];
  profiles: TailProfile[];
  warnings: string[];
};
export type TailAction =
  | 'connect'
  | 'disconnect'
  | 'logout'
  | 'switch'
  | 'exit-node'
  | 'clear-exit'
  | 'advertise-exit'
  | 'stop-advertising-exit'
  | 'netcheck'
  | 'ping'
  | 'send-file'
  | 'receive-files';
export const tailActions: Record<TailAction, { label: string; detail: string }> = {
  connect: {
    label: 'Connect Tailscale',
    detail:
      'Bring the installed client online using its saved settings. Sign-in may need the Tailscale app.',
  },
  disconnect: {
    label: 'Disconnect Tailscale',
    detail:
      'Stop private-network connectivity on this computer. Connections using Tailscale will be interrupted.',
  },
  logout: {
    label: 'Log out of Tailscale',
    detail:
      'Disconnect and expire this device’s current login. Reconnecting requires sign-in again.',
  },
  switch: {
    label: 'Switch account',
    detail:
      'Change this computer to the selected saved account. Existing private-network connections may be interrupted.',
  },
  'exit-node': {
    label: 'Use exit node',
    detail:
      'Route this computer’s internet traffic through the selected peer. Existing LAN-access preferences remain owned by Tailscale.',
  },
  'clear-exit': {
    label: 'Stop using exit node',
    detail: 'Return internet routing to this computer’s normal connection.',
  },
  'advertise-exit': {
    label: 'Offer this device as an exit node',
    detail:
      'Advertise this computer for exit routing. OS forwarding and approval by your tailnet administrator may still be required.',
  },
  'stop-advertising-exit': {
    label: 'Stop offering an exit node',
    detail: 'Withdraw this computer’s exit-node advertisement; other devices may depend on it.',
  },
  netcheck: {
    label: 'Run network diagnostics',
    detail:
      'Send Tailscale connectivity probes to measure UDP, NAT and relay reachability. One bounded check, with no background monitoring.',
  },
  ping: {
    label: 'Check peer connection',
    detail:
      'Send up to three Tailscale pings to the selected peer to observe its current path. This does not test application access.',
  },
  'send-file': {
    label: 'Send with Taildrop',
    detail:
      'Send the selected file from the ProtoPeek computer to this peer. A cancelled or timed-out operation may already have transferred data.',
  },
  'receive-files': {
    label: 'Receive pending Taildrop files',
    detail:
      'Save pending incoming files in the selected existing directory. Conflicting names are renamed by Tailscale.',
  },
};
