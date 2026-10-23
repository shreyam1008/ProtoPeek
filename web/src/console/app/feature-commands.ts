import { type FeatureId, featureRegistry } from './feature-registry';

const commands = [
  {
    id: 'overview',
    label: 'Open Home',
    keywords: 'home overview dashboard suite',
  },
  {
    id: 'protocols',
    label: 'Open Inspect',
    keywords: 'inspect api protocol grpc http rest openapi workbench',
  },
  {
    id: 'grpc',
    label: 'Open gRPC workbench',
    keywords: 'reflection proto protoset streams trailers',
  },
  {
    id: 'http',
    label: 'Open HTTP workbench',
    keywords: 'rest request response headers tls',
  },
  {
    id: 'events',
    label: 'Open WebSocket and SSE',
    keywords: 'websocket ws wss sse server sent events streaming messages binary',
  },
  {
    id: 'capnp',
    label: 'Open Cap’n Proto',
    keywords: 'capnp schema capability rpc binary tcp tls',
  },
  {
    id: 'network-ports',
    label: 'Scan host ports',
    keywords: 'tcp port scanner ranges open closed local remote services',
  },
  {
    id: 'network-diagnostics',
    label: 'Diagnose a connection',
    keywords:
      'dns resolver compare tls certificates ipv4 ipv6 tcp udp exchange proxy socks5 http2 h2c subnet cidr availability samples preflight',
  },
  {
    id: 'netbird',
    label: 'Open NetBird',
    keywords: 'private access vpn ice relay dns peers installed client',
  },
  {
    id: 'network-route',
    label: 'Open next-hop route evidence',
    keywords: 'route kernel next hop interface source',
  },
  {
    id: 'network-nmap',
    label: 'Open Nmap scanner',
    keywords: 'nmap subnet service version tcp scan ports network',
  },
  {
    id: 'network-packets',
    label: 'Inspect captured packets',
    keywords: 'pcap pcapng wireshark dumpcap capture traffic packets dns tcp udp',
  },
  {
    id: 'network-path',
    label: 'Trace a measured network path',
    keywords: 'network hops latency dns route traceroute udp',
  },
  {
    id: 'network-local',
    label: 'See nearby devices',
    keywords: 'network local lan wifi ethernet devices discovery cidr ports inventory private scan',
  },
  {
    id: 'network-map',
    label: 'Open the network evidence map',
    keywords: 'network map topology graph inventory history',
  },
  {
    id: 'this-pc',
    label: 'Open This Device',
    keywords: 'machine device interfaces listeners connections traffic benchmark public ip',
  },
  {
    id: 'tailnet',
    label: 'Open Tailscale workbench',
    keywords: 'tailscout tailnet wireguard tailscale peers accounts exit node taildrop netcheck',
  },
  {
    id: 'extensions',
    label: 'Open Extensions',
    keywords: 'optional tools install setup integrations tailscale cloudflare wireshark nmap aria2',
  },
  {
    id: 'tunnels',
    label: 'Open Cloudflare tunnel operations',
    keywords: 'cloudflare cloudflared tunnel ingress config service connector route',
  },
  {
    id: 'publishing',
    label: 'Share a local service',
    keywords:
      'publish private tailscale serve public funnel cloudflare quick tunnel temporary stop',
  },
  {
    id: 'downloader',
    label: 'Open Downloader',
    keywords: 'download transfer queue artifact aria2',
  },
  {
    id: 'local-transfer',
    label: 'Send files to a nearby device',
    keywords: 'local transfer lan send receive peer wireguard files',
  },
  {
    id: 'security',
    label: 'Open Security evidence',
    keywords: 'domain certificate tls dns authorized checks',
  },
  {
    id: 'settings',
    label: 'Open Settings',
    keywords: 'appearance density keyboard browser local preferences',
  },
  {
    id: 'agents',
    label: 'Connect an AI agent',
    keywords: 'mcp ai agent assistant automation cli tools activity',
  },
  {
    id: 'updates',
    label: 'Check for ProtoPeek updates',
    keywords: 'update upgrade version release stable edge install restart',
  },
  {
    id: 'roadmap',
    label: 'Open product roadmap',
    keywords: 'available next exploring gated',
  },
] as const satisfies readonly { id: FeatureId; label: string; keywords: string }[];
export const commandDestinationFeatures = commands
  .map(({ id, ...command }) => {
    const feature = featureRegistry.find((feature) => feature.id === id);
    if (!feature) throw new Error('Command has no registered feature');
    return { ...feature, command };
  })
  .sort((left, right) => left.order - right.order);
