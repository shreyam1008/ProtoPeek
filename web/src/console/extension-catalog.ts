export const extensionIds = ['tailscale', 'cloudflared', 'wireshark', 'nmap', 'aria2'] as const;
export type ExtensionId = (typeof extensionIds)[number];
export type SetupPlatform = 'windows' | 'darwin' | 'linux';
export type ExtensionObservation = {
  id: ExtensionId;
  status: 'detected' | 'included' | 'missing' | 'unavailable';
  source: 'configured' | 'path' | 'standard-location' | 'bundled' | 'cached-bundle' | 'none';
  path: string;
  message: string;
  bundled: boolean;
  bundledBytes: number;
};
export type ExtensionSnapshot = {
  schemaVersion: 1;
  platform: string;
  architecture: string;
  observedAt: string;
  extensions: ExtensionObservation[];
};
export type ExtensionDefinition = {
  id: ExtensionId;
  name: string;
  group: 'Connect & publish' | 'Inspect traffic & services' | 'Transfer files';
  summary: string;
  tool: string;
  route: '/network/tailnet' | '/tunnels' | '/network/packets' | '/network/nmap' | '/downloader';
  openLabel: string;
  download: string;
  guide: string;
  setup: Record<SetupPlatform, string>;
  afterSetup: string;
};

export const extensionCatalog: readonly ExtensionDefinition[] = [
  {
    id: 'tailscale',
    name: 'Tailscale',
    group: 'Connect & publish',
    summary: 'Reach devices on your tailnet, inspect peers, and prepare service connections.',
    tool: 'Tailscale app and CLI',
    route: '/network/tailnet',
    openLabel: 'Open Tailscale',
    download: 'https://tailscale.com/download',
    guide: 'https://tailscale.com/docs/install',
    setup: {
      windows: 'Install Tailscale for Windows, then sign in through its app.',
      darwin: 'Install Tailscale for macOS and follow its CLI setup instructions.',
      linux: 'Install the package for your distribution and connect through Tailscale.',
    },
    afterSetup:
      'Open the workbench to inspect connection state. Finding the CLI does not prove that you are signed in or connected.',
  },
  {
    id: 'cloudflared',
    name: 'Cloudflare Tunnel',
    group: 'Connect & publish',
    summary: 'Inspect connectors and ingress routes, then prepare changes to a local tunnel.',
    tool: 'cloudflared',
    route: '/tunnels',
    openLabel: 'Open Cloudflare Tunnel',
    download:
      'https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/',
    guide:
      'https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/',
    setup: {
      windows:
        'Install cloudflared using the official Windows instructions and make it available on PATH.',
      darwin: 'Use the official macOS package instructions to install cloudflared.',
      linux: 'Use the official repository or package for your distribution and architecture.',
    },
    afterSetup:
      'Open the workbench to inspect configuration and service state. Installing the connector does not publish a service.',
  },
  {
    id: 'wireshark',
    name: 'Wireshark capture',
    group: 'Inspect traffic & services',
    summary: 'Capture a short sample of traffic using dumpcap, then inspect packets in ProtoPeek.',
    tool: 'dumpcap from Wireshark',
    route: '/network/packets',
    openLabel: 'Open live capture',
    download: 'https://www.wireshark.org/download.html',
    guide: 'https://wiki.wireshark.org/CaptureSetup/CapturePrivileges',
    setup: {
      windows:
        'Install Wireshark with dumpcap and the Npcap capture driver. Follow the installer’s capture-permission choices.',
      darwin: 'Install Wireshark and its ChmodBPF helper for capture permissions.',
      linux:
        'Install your distribution’s dumpcap or Wireshark package and follow its capture-group permission setup.',
    },
    afterSetup:
      'Open Live capture to check interfaces and permissions. Reading an existing PCAP or PCAPNG file needs no Wireshark installation.',
  },
  {
    id: 'nmap',
    name: 'Nmap',
    group: 'Inspect traffic & services',
    summary: 'Run bounded service scans with an installed Nmap, or import an existing XML report.',
    tool: 'nmap',
    route: '/network/nmap',
    openLabel: 'Open Nmap',
    download: 'https://nmap.org/download.html',
    guide: 'https://nmap.org/book/install.html',
    setup: {
      windows: 'Use the official Nmap Windows installer and include its command-line tool on PATH.',
      darwin: 'Follow Nmap’s macOS installation instructions and make nmap available on PATH.',
      linux: 'Install Nmap using your distribution’s package manager.',
    },
    afterSetup:
      'A scan starts only when you request one. The built-in TCP port scanner and XML import work without Nmap.',
  },
  {
    id: 'aria2',
    name: 'aria2',
    group: 'Transfer files',
    summary: 'Power resumable downloads, transfer queues, and file verification.',
    tool: 'aria2c',
    route: '/downloader',
    openLabel: 'Open Downloader',
    download: 'https://github.com/aria2/aria2/releases/latest',
    guide: 'https://aria2.github.io/',
    setup: {
      windows:
        'Get the official aria2 Windows archive. Add aria2c.exe to PATH or select its full path in Downloader settings.',
      darwin:
        'Install aria2 using a package manager, then make aria2c available to the ProtoPeek process.',
      linux:
        'Install your distribution’s aria2 package, or select an existing aria2c in Downloader settings.',
    },
    afterSetup:
      'Downloader prefers its configured engine, then PATH. Any included or cached companion is identified separately below.',
  },
];

export function setupPlatform(value: string | undefined): SetupPlatform | undefined {
  return value === 'windows' || value === 'darwin' || value === 'linux' ? value : undefined;
}

export function parseExtensionSnapshot(value: unknown): ExtensionSnapshot {
  const invalid = () => new Error('Could not read local tool status. Refresh to try again.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const data = value as Record<string, unknown>;
  if (
    data.schemaVersion !== 1 ||
    typeof data.platform !== 'string' ||
    data.platform.length > 32 ||
    typeof data.architecture !== 'string' ||
    data.architecture.length > 32 ||
    typeof data.observedAt !== 'string' ||
    data.observedAt.length > 64 ||
    !Number.isFinite(Date.parse(data.observedAt)) ||
    !Array.isArray(data.extensions) ||
    data.extensions.length !== extensionIds.length
  )
    throw invalid();
  const found = new Set<ExtensionId>();
  for (const candidate of data.extensions) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw invalid();
    const item = candidate as ExtensionObservation;
    if (
      !extensionIds.includes(item.id) ||
      found.has(item.id) ||
      !['detected', 'included', 'missing', 'unavailable'].includes(item.status) ||
      !['configured', 'path', 'standard-location', 'bundled', 'cached-bundle', 'none'].includes(
        item.source
      ) ||
      typeof item.path !== 'string' ||
      item.path.length > 4096 ||
      typeof item.message !== 'string' ||
      item.message.length > 2048 ||
      typeof item.bundled !== 'boolean' ||
      !Number.isSafeInteger(item.bundledBytes) ||
      item.bundledBytes < 0 ||
      item.bundledBytes > 64 * 1024 * 1024
    )
      throw invalid();
    found.add(item.id);
  }
  return data as ExtensionSnapshot;
}
