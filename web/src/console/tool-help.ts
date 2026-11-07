import type { FeatureId } from './app/feature-registry';

type ToolHelp = { steps: readonly string[]; boundary: string };

export const mediaDownloadHelp: ToolHelp = {
  steps: [
    'Choose the media type for your link.',
    'Review Engine setup; install an engine if needed.',
    'Enter the link, destination and options. For page media, you can inspect first.',
    'Queue the download when its engine is available.',
    'Review queue status and actions.',
  ],
  boundary:
    'Site support varies. Page media needs no separate engine; other types may need optional tools or setup.',
};

/** Task guidance describes existing controls; opening it performs no operation. */
export const toolHelp: Record<FeatureId, ToolHelp> = {
  overview: {
    steps: [
      'Choose a task or enter a service address.',
      'Open a workbench to review the draft before sending or scanning.',
    ],
    boundary: 'Opening a draft sends nothing.',
  },
  protocols: {
    steps: ['Choose your service protocol, then enter its address and review the request.'],
    boundary: 'A port number alone does not establish the application protocol.',
  },
  grpc: {
    steps: [
      'Enter the server address and choose plaintext or verified TLS.',
      'Load a schema from reflection, files or host paths; choose a method and invoke.',
      'Inspect messages, headers, trailers and final status separately.',
    ],
    boundary: 'Servers without reflection need a supplied schema.',
  },
  http: {
    steps: [
      'Choose a method and enter a request URL.',
      'Add headers, authentication or a body as needed, then send.',
      'Read status, headers, body and timing.',
    ],
    boundary: 'Redirects are off and certificate verification is on by default.',
  },
  events: {
    steps: [
      'Choose WebSocket or server-sent events and enter the endpoint.',
      'Review options and connect; inspect messages or events.',
      'Disconnect when finished.',
    ],
    boundary: 'SSE uses one connection and does not automatically reconnect.',
  },
  capnp: {
    steps: [
      'Load source files or a compiled schema and choose the service and method.',
      'Enter the server address, transport and request values, then invoke.',
      'Inspect the response or use a bounded capability call plan.',
    ],
    boundary:
      'Source needs a compiler. Plans allow eight steps and exclude list elements and union branches.',
  },
  network: {
    steps: [
      'Choose a private network scope and review the plan.',
      'Start discovery only for a network you are authorized to inspect.',
    ],
    boundary: 'An observation describes a point in time, not a guarantee of reachability.',
  },
  'network-ports': {
    steps: [
      'Enter one host and choose ports or a preset.',
      'Review the plan and start the TCP scan.',
      'Inspect open, refused, timed out and unscanned results.',
    ],
    boundary: 'A TCP connection does not identify the application running on a port.',
  },
  'network-diagnostics': {
    steps: [
      'Select a diagnostic mode and provide its target.',
      'Review inputs and run the check.',
      'Read the result and mode limitations.',
    ],
    boundary: 'Active modes contact the chosen destination; subnet planning is offline.',
  },
  netbird: {
    steps: [
      'Check the installed client and its local status.',
      'Review and confirm an action before changing connection state.',
    ],
    boundary: 'NetBird needs its client and an account.',
  },
  'network-route': {
    steps: [
      'Enter an address and inspect the local route.',
      'Review the interface, gateway and route evidence.',
    ],
    boundary: 'A local routing decision does not prove the destination is reachable.',
  },
  'network-nmap': {
    steps: [
      'Check availability of an installed Nmap executable.',
      'Choose a literal target, ports and optional service detection; review before scanning.',
      'Inspect results or export the evidence.',
    ],
    boundary:
      'The scanner runs the separately installed Nmap only on request. Offline XML import does not execute it.',
  },
  'network-packets': {
    steps: [
      'Open a capture file or choose live capture.',
      'Filter packets and inspect conversations and bounded TCP evidence.',
    ],
    boundary:
      'Live capture requires installed dumpcap and permissions. Encrypted payloads remain encrypted.',
  },
  'network-path': {
    steps: [
      'Enter the destination and choose the path check.',
      'Run the check; inspect DNS, route and hops.',
    ],
    boundary: 'Hop times start here. A silent hop may still forward traffic.',
  },
  'network-local': {
    steps: [
      'Choose a private network scope and review the plan.',
      'Start discovery only for a network you are authorized to inspect.',
      'Open a discovered service as a draft in a suitable workbench.',
    ],
    boundary: 'Discovery sends probes; presence does not prove a service is healthy.',
  },
  'network-map': {
    steps: [
      'Save a scan or path, import a map, or choose a workspace.',
      'Review nodes and observations; save a snapshot or export.',
    ],
    boundary: 'Maps store observed or manual links in this browser.',
  },
  'network-history': {
    steps: [
      'Choose a workspace and inspect its snapshots.',
      'Compare observations or preview an offline Nmap XML import before saving.',
    ],
    boundary: 'Importing saved XML runs no scan.',
  },
  'this-pc': {
    steps: [
      'Refresh the local device view.',
      'Inspect interfaces, sockets, processes and available counters.',
      'Open a related tool for an active check.',
    ],
    boundary:
      'Observations describe the host or container running ProtoPeek, not Internet reachability.',
  },
  tailnet: {
    steps: [
      'Check the installed Tailscale client and its local status.',
      'Inspect peers or diagnostics. Review changes before applying them.',
    ],
    boundary: 'Use your Tailscale or compatible coordination account.',
  },
  extensions: {
    steps: [
      'Search or filter the library; choose a tool.',
      'Review integration and setup before opening its workspace or guide.',
    ],
    boundary: 'Browsing and pinning do not install tools or connect accounts.',
  },
  tunnels: {
    steps: [
      'Inspect the local cloudflared installation and configuration.',
      'Review a route or service action before applying it.',
    ],
    boundary: 'Local config and account tunnels use separate permissions.',
  },
  publishing: {
    steps: [
      'Choose an audience and local origin.',
      'Review the session and confirm its audience before starting.',
      'Check the session and stop the owned process when finished.',
    ],
    boundary: 'Public sessions expose your origin and continue after you leave.',
  },
  downloader: {
    steps: [
      'Enter a download URL and choose the destination and options.',
      'Start the job; inspect progress, pause or resume.',
    ],
    boundary: 'The built-in downloader uses one connection per transfer; aria2 is optional.',
  },
  'local-transfer': {
    steps: [
      'Start sharing and connect the other device using the shown details.',
      'Select files, review on the receiver and approve.',
      'Check the result and stop sharing.',
    ],
    boundary:
      'Receiver approval is required. Network reachability and firewall rules depend on your devices.',
  },
  security: {
    steps: [
      'Enter a public website and choose the evidence to collect.',
      'Run the selected checks and inspect DNS, TLS and HTTP observations.',
    ],
    boundary: 'Responses are target evidence, not a certification of overall security.',
  },
  settings: {
    steps: [
      'Choose your appearance and interface preferences.',
      'Use the relevant section to manage local settings or data.',
    ],
    boundary: 'With storage blocked, preferences last for this session.',
  },
  agents: {
    steps: [
      'Choose an agent client and review its connection instructions.',
      'Enable pairing only when needed, then inspect available tools and activity.',
    ],
    boundary: 'Pair a separately configured client to enable local access.',
  },
  updates: {
    steps: [
      'Check the current installation and available stable version.',
      'Follow the update action or your package manager’s instructions.',
    ],
    boundary: 'Package-managed installs are updated through their manager.',
  },
  roadmap: {
    steps: [
      'Browse shipped capabilities and planned work.',
      'Use the status filters to compare available and planned work.',
    ],
    boundary: 'Planned items are not claims of shipped functionality.',
  },
};
