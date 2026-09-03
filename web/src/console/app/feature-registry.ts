export type DestinationDefinition = {
  id: 'home' | 'inspect' | 'network' | 'publish' | 'files' | 'settings';
  label: string;
  route: string;
  icon: 'home' | 'search' | 'network' | 'cloud' | 'download' | 'settings';
  order: number;
};

export const destinations = [
  { id: 'home', label: 'Home', route: '/', icon: 'home', order: 10 },
  { id: 'inspect', label: 'Inspect', route: '/protocols', icon: 'search', order: 20 },
  { id: 'network', label: 'Network', route: '/network', icon: 'network', order: 30 },
  { id: 'publish', label: 'Publish', route: '/tunnels', icon: 'cloud', order: 40 },
  { id: 'files', label: 'Files', route: '/downloader', icon: 'download', order: 50 },
  { id: 'settings', label: 'Settings', route: '/settings', icon: 'settings', order: 60 },
] as const satisfies readonly DestinationDefinition[];

export type DestinationId = (typeof destinations)[number]['id'];

export type FeatureDefinition = {
  id: string;
  destination: DestinationId;
  label: string;
  route: string;
  order: number;
  compatibilityRoutes?: readonly string[];
  command?: { label: string; keywords: string };
  homeEntry?: { label: string; detail: string };
  inspectEntry?: { detail: string };
};

export const featureRegistry = [
  {
    id: 'overview',
    destination: 'home',
    label: 'Home',
    route: '/',
    order: 10,
    command: { label: 'Open Home', keywords: 'home overview dashboard suite' },
  },
  {
    id: 'protocols',
    destination: 'inspect',
    label: 'Inspect',
    route: '/protocols',
    order: 20,
    command: {
      label: 'Open Inspect',
      keywords: 'inspect api protocol grpc http rest openapi workbench',
    },
    homeEntry: {
      label: 'Send an API request',
      detail: 'Open an HTTP request or a gRPC method.',
    },
  },
  {
    id: 'grpc',
    destination: 'inspect',
    label: 'gRPC',
    route: '/protocols/grpc',
    order: 30,
    compatibilityRoutes: ['/grpc'],
    command: {
      label: 'Open gRPC workbench',
      keywords: 'reflection proto protoset streams trailers',
    },
    inspectEntry: {
      detail:
        'Reflection, proto folders and protosets, unary and streaming calls, metadata, trailers.',
    },
  },
  {
    id: 'http',
    destination: 'inspect',
    label: 'HTTP',
    route: '/protocols/http',
    order: 40,
    compatibilityRoutes: ['/http'],
    command: {
      label: 'Open HTTP workbench',
      keywords: 'rest request response headers tls',
    },
    inspectEntry: {
      detail:
        'Methods, URLs, auth, request bodies, redirects, TLS, timing, headers, and response data.',
    },
  },
  {
    id: 'network',
    destination: 'network',
    label: 'Network',
    route: '/network',
    order: 50,
  },
  {
    id: 'network-route',
    destination: 'network',
    label: 'Next hop',
    route: '/network/route',
    order: 60,
    compatibilityRoutes: ['/routes'],
    command: {
      label: 'Open next-hop route evidence',
      keywords: 'route kernel next hop interface source',
    },
  },
  {
    id: 'network-path',
    destination: 'network',
    label: 'Network path',
    route: '/network/path',
    order: 70,
    command: {
      label: 'Trace a measured network path',
      keywords: 'network hops latency dns route traceroute udp',
    },
    homeEntry: {
      label: 'Trace a network path',
      detail: 'See the DNS answer, selected route, and measured hops.',
    },
  },
  {
    id: 'network-local',
    destination: 'network',
    label: 'Local discovery',
    route: '/network/local',
    order: 80,
    command: {
      label: 'Discover an authorized local network',
      keywords: 'network local cidr ports inventory private scan',
    },
  },
  {
    id: 'network-map',
    destination: 'network',
    label: 'Network evidence map',
    route: '/network/map',
    order: 90,
    command: {
      label: 'Open the network evidence map',
      keywords: 'network map topology graph inventory history',
    },
  },
  {
    id: 'network-history',
    destination: 'network',
    label: 'Network history',
    route: '/network/history',
    order: 100,
  },
  {
    id: 'this-pc',
    destination: 'network',
    label: 'This Device',
    route: '/this-pc',
    order: 110,
    command: {
      label: 'Open This Device',
      keywords: 'machine device interfaces listeners connections traffic benchmark public ip',
    },
    homeEntry: {
      label: 'Check this device',
      detail: 'Review interfaces, connections, public IP, and browser-path speed.',
    },
  },
  {
    id: 'tunnels',
    destination: 'publish',
    label: 'Tunnels',
    route: '/tunnels',
    order: 130,
    command: {
      label: 'Open Cloudflare tunnel operations',
      keywords: 'cloudflare cloudflared tunnel ingress config service connector route',
    },
    homeEntry: {
      label: 'Inspect Cloudflare tunnels',
      detail: 'See local service, config authority, ingress routes, and safe change drafts.',
    },
  },
  {
    id: 'downloader',
    destination: 'files',
    label: 'Downloader',
    route: '/downloader',
    order: 120,
    compatibilityRoutes: ['/downloads'],
    command: {
      label: 'Open Downloader',
      keywords: 'download transfer queue artifact aria2',
    },
    homeEntry: {
      label: 'Download a file',
      detail: 'Start, pause, resume, and verify transfers.',
    },
  },
  {
    id: 'security',
    destination: 'inspect',
    label: 'Security',
    route: '/security',
    order: 140,
    command: {
      label: 'Open Security evidence',
      keywords: 'domain certificate tls dns authorized checks',
    },
    homeEntry: {
      label: 'Check a public website',
      detail: 'Inspect its DNS, HTTP, and TLS evidence when you ask.',
    },
    inspectEntry: {
      detail: 'DNS, HTTP, TLS, and certificate evidence for one public website.',
    },
  },
  {
    id: 'settings',
    destination: 'settings',
    label: 'Settings',
    route: '/settings',
    order: 150,
    command: {
      label: 'Open Settings',
      keywords: 'appearance density keyboard browser local preferences',
    },
  },
  {
    id: 'roadmap',
    destination: 'settings',
    label: 'Roadmap',
    route: '/roadmap',
    order: 160,
    command: {
      label: 'Open product roadmap',
      keywords: 'available next exploring gated',
    },
  },
] as const satisfies readonly FeatureDefinition[];

export type RegisteredFeature = (typeof featureRegistry)[number];
export type FeatureId = RegisteredFeature['id'];
export type FeatureRoute = RegisteredFeature['route'];

type WithField<Field extends PropertyKey> = RegisteredFeature extends infer Feature
  ? Feature extends Record<Field, unknown>
    ? Feature
    : never
  : never;

export type CompatibilityRoute = WithField<'compatibilityRoutes'>['compatibilityRoutes'][number];
export type CommandDestinationFeature = WithField<'command'>;
export type HomeEntryFeature = WithField<'homeEntry'>;
export type InspectEntryFeature = WithField<'inspectEntry'>;

export const commandDestinationFeatures = featureRegistry
  .filter((feature): feature is CommandDestinationFeature => 'command' in feature)
  .sort((left, right) => left.order - right.order);

export const homeEntryFeatures = featureRegistry.filter(
  (feature): feature is HomeEntryFeature => 'homeEntry' in feature
);

export const inspectEntryFeatures = featureRegistry.filter(
  (feature): feature is InspectEntryFeature => 'inspectEntry' in feature
);

function normalizeFeaturePath(pathname: string) {
  if (pathname === '/') return pathname;
  return pathname.replace(/\/+$/, '') || '/';
}

export function featureForPath(pathname: string): RegisteredFeature | undefined {
  const normalized = normalizeFeaturePath(pathname);
  return featureRegistry.find(
    (feature) =>
      feature.route === normalized ||
      ('compatibilityRoutes' in feature &&
        feature.compatibilityRoutes.some((route) => route === normalized))
  );
}

export function destinationForPath(pathname: string) {
  const feature = featureForPath(pathname);
  if (!feature) return undefined;
  return destinations.find((destination) => destination.id === feature.destination);
}

export function getCompatibilityRouteTargets() {
  return featureRegistry.flatMap((feature) => {
    if (!('compatibilityRoutes' in feature)) return [];
    return feature.compatibilityRoutes.map((route) => ({ route, target: feature.route }));
  });
}
