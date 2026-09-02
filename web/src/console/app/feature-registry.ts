export const destinations = [
  { id: 'home', label: 'Home', route: '/', icon: 'home', order: 10 },
  { id: 'inspect', label: 'Inspect', route: '/protocols', icon: 'search', order: 20 },
  { id: 'network', label: 'Network', route: '/network', icon: 'network', order: 30 },
  { id: 'publish', label: 'Publish', route: '/tunnels', icon: 'cloud', order: 40 },
  { id: 'files', label: 'Files', route: '/downloader', icon: 'download', order: 50 },
  { id: 'settings', label: 'Settings', route: '/settings', icon: 'settings', order: 60 },
] as const;

export type DestinationId = (typeof destinations)[number]['id'];

export type FeatureDefinition = {
  id: string;
  destination: DestinationId;
  label: string;
  route: string;
  order: number;
  compatibilityRoutes?: readonly string[];
  navigation?: 'primary' | 'secondary';
  command?: { label: string; keywords: string };
  homeEntry?: { label: string; detail: string };
  protocolChoice?: { detail: string };
};

export const featureRegistry = [
  {
    id: 'overview',
    destination: 'home',
    label: 'Overview',
    route: '/',
    order: 10,
    navigation: 'primary',
    command: { label: 'Open ProtoPeek overview', keywords: 'home dashboard suite' },
  },
  {
    id: 'protocols',
    destination: 'inspect',
    label: 'APIs',
    route: '/protocols',
    order: 20,
    navigation: 'primary',
    command: {
      label: 'Open API workbenches',
      keywords: 'api protocol grpc http rest openapi workbench',
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
    protocolChoice: {
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
    protocolChoice: {
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
    navigation: 'primary',
  },
  {
    id: 'network-route',
    destination: 'network',
    label: 'Next-hop route evidence',
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
    label: 'This PC',
    route: '/this-pc',
    order: 110,
    navigation: 'primary',
    command: {
      label: 'Open This PC',
      keywords: 'machine device interfaces listeners connections traffic benchmark public ip',
    },
    homeEntry: {
      label: 'Check this computer',
      detail: 'Review interfaces, connections, public IP, and browser-path speed.',
    },
  },
  {
    id: 'tunnels',
    destination: 'publish',
    label: 'Tunnels',
    route: '/tunnels',
    order: 130,
    navigation: 'primary',
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
    navigation: 'primary',
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
    navigation: 'primary',
    command: {
      label: 'Open Security evidence',
      keywords: 'domain certificate tls dns authorized checks',
    },
    homeEntry: {
      label: 'Check a public website',
      detail: 'Inspect its DNS, HTTP, and TLS evidence when you ask.',
    },
  },
  {
    id: 'settings',
    destination: 'settings',
    label: 'Settings',
    route: '/settings',
    order: 150,
    navigation: 'primary',
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
    navigation: 'secondary',
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
export type PrimaryNavigationFeature = Extract<WithField<'navigation'>, { navigation: 'primary' }>;
export type SecondaryNavigationFeature = Extract<
  WithField<'navigation'>,
  { navigation: 'secondary' }
>;
export type CommandDestinationFeature = WithField<'command'>;
export type HomeEntryFeature = WithField<'homeEntry'>;
export type ProtocolChoiceFeature = WithField<'protocolChoice'>;

export const currentPrimaryNavigation = featureRegistry.filter(
  (feature): feature is PrimaryNavigationFeature =>
    'navigation' in feature && feature.navigation === 'primary'
);

export const currentSecondaryNavigation = featureRegistry.filter(
  (feature): feature is SecondaryNavigationFeature =>
    'navigation' in feature && feature.navigation === 'secondary'
);

export const commandDestinationFeatures = featureRegistry
  .filter((feature): feature is CommandDestinationFeature => 'command' in feature)
  .sort((left, right) => left.order - right.order);

export const homeEntryFeatures = featureRegistry.filter(
  (feature): feature is HomeEntryFeature => 'homeEntry' in feature
);

export const protocolChoiceFeatures = featureRegistry.filter(
  (feature): feature is ProtocolChoiceFeature => 'protocolChoice' in feature
);

export function getCompatibilityRouteTargets() {
  return featureRegistry.flatMap((feature) => {
    if (!('compatibilityRoutes' in feature)) return [];
    return feature.compatibilityRoutes.map((route) => ({ route, target: feature.route }));
  });
}
