import type { FeatureId } from './app/feature-registry';

type ToolHelp = { steps: readonly string[]; boundary: string };

/** Task guidance describes existing controls; opening it performs no operation. */
export const toolHelp: Record<FeatureId, ToolHelp> = {
  overview: {
    steps: [
      'Choose a task or enter a service address.',
      'Open a workbench to review the draft before sending or scanning.',
    ],
    boundary: 'Entering an address alone does not contact it.',
  },
  protocols: {
    steps: [
      'Choose the protocol used by your service.',
      'Enter its address and review the request in that workbench.',
    ],
    boundary: 'A port number alone does not establish the application protocol.',
  },
  grpc: {
    steps: [
      'Enter the server address and choose plaintext or verified TLS.',
      'Load a schema through reflection, files, or host paths; choose a method and invoke it.',
      'Inspect messages, headers, trailers and final status separately.',
    ],
    boundary: 'Reflection is optional; a server may require supplied schemas or credentials.',
  },
  http: {
    steps: [
      'Choose a method and enter a request URL.',
      'Add headers, authentication or a body as needed, then send.',
      'Review status, headers, body and timing.',
    ],
    boundary: 'Redirects are off and certificate verification is on by default.',
  },
  events: {
    steps: [
      'Choose WebSocket or server-sent events and enter the endpoint.',
      'Review connection options and connect; inspect messages or events as they arrive.',
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
      'Source compilation needs a separate compiler. Plans support up to eight steps; list elements and union branches cannot be pipelined.',
  },
  network: {
    steps: [
      'Choose a network tool for the evidence you need.',
      'Review the target and scope before starting an active check.',
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
      'Review the inputs and run the check.',
      'Read the result and any limitations for that mode.',
    ],
    boundary: 'Active modes contact the chosen destination; subnet planning is offline.',
  },
  netbird: {
    steps: [
      'Check the installed client and its local status.',
      'Review an available action and confirm before changing connection state.',
    ],
    boundary: 'NetBird must be installed and its account remains managed by you.',
  },
  'network-route': {
    steps: [
      'Enter an address and inspect the local route.',
      'Review the chosen interface, gateway and route evidence.',
    ],
    boundary: 'A local routing decision does not prove the destination is reachable.',
  },
  'network-nmap': {
    steps: [
      'Check availability of an installed Nmap executable.',
      'Choose a literal target, ports and optional service detection; review the plan before scanning.',
      'Inspect results or export the evidence.',
    ],
    boundary:
      'The scanner runs the separately installed Nmap only on request. Offline XML import does not execute it.',
  },
  'network-packets': {
    steps: [
      'Open a capture file or select an available live-capture option.',
      'Filter packets and inspect conversations and bounded TCP evidence.',
    ],
    boundary:
      'Live capture requires installed dumpcap and permissions. Encrypted payloads remain encrypted.',
  },
  'network-path': {
    steps: [
      'Enter the destination and choose the path check.',
      'Run the check and inspect DNS, route and hop observations.',
    ],
    boundary:
      'Hop round trips are measured from this host; silent hops do not necessarily indicate a fault.',
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
      'Create or open a local evidence workspace.',
      'Review nodes and observations, then save a snapshot or export it.',
    ],
    boundary: 'Maps are browser-local evidence; missing links are not inferred as connections.',
  },
  'network-history': {
    steps: [
      'Select a workspace and inspect its saved snapshots.',
      'Compare observations or preview an offline Nmap XML import before saving.',
    ],
    boundary: 'Imported XML is evidence only; the importer does not run Nmap.',
  },
  'this-pc': {
    steps: [
      'Refresh the local device view.',
      'Inspect interfaces, sockets, processes and available counters.',
      'Open a related tool when you need a separate active check.',
    ],
    boundary:
      'Observations describe the host or container running ProtoPeek, not Internet reachability.',
  },
  tailnet: {
    steps: [
      'Check the installed Tailscale client and its local status.',
      'Review peers or available diagnostics; confirm actions before changing state.',
    ],
    boundary:
      'Tailscale or a compatible coordination service and an account are separately managed.',
  },
  extensions: {
    steps: [
      'Search or filter the library and choose a tool.',
      'Review its integration level and setup before opening the workspace or external guide.',
    ],
    boundary: 'Browsing and pinning do not install tools or connect accounts.',
  },
  tunnels: {
    steps: [
      'Inspect the local cloudflared installation and configuration.',
      'Review a route or an available service action before applying it.',
    ],
    boundary:
      'Local configuration and account-managed tunnels have different authorities; cloudflared is separate.',
  },
  publishing: {
    steps: [
      'Choose an audience and local origin.',
      'Review the temporary session and explicitly confirm its audience before starting.',
      'Check the session and stop the owned process when finished.',
    ],
    boundary:
      'A public audience can expose your service to the Internet; a session continues if you leave the page.',
  },
  downloader: {
    steps: [
      'Enter a download URL and choose the destination and options.',
      'Start the job, then inspect progress, pause or resume when available.',
    ],
    boundary:
      'Transfers use aria2. Standard Windows x64 builds include a fallback; lightweight builds need their local companion or an installed engine. Other platforms need an available engine.',
  },
  'local-transfer': {
    steps: [
      'Start sharing and connect the other device using the shown connection details.',
      'Select files, review the request on the receiver, and approve the transfer.',
      'Check the result and stop sharing when finished.',
    ],
    boundary:
      'Receiver approval is required. Network reachability and firewall rules depend on your devices.',
  },
  security: {
    steps: [
      'Enter a public website and choose the evidence to collect.',
      'Run the selected checks and inspect DNS, TLS and HTTP observations.',
    ],
    boundary:
      'Observed responses are evidence for the selected target, not a certification of overall security.',
  },
  settings: {
    steps: [
      'Choose your appearance and interface preferences.',
      'Use the relevant section to manage local settings or data.',
    ],
    boundary: 'Some browser-stored preferences may be session-only if storage is unavailable.',
  },
  agents: {
    steps: [
      'Choose an agent client and review its connection instructions.',
      'Enable pairing only when needed, then inspect available tools and activity.',
    ],
    boundary: 'Agent access is local and opt-in; a client must be configured separately.',
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
      'Open a related tool or guide to explore what is available now.',
    ],
    boundary: 'Planned items are not claims of shipped functionality.',
  },
};
