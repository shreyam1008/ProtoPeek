export type DestinationDefinition = {
  id: 'home' | 'inspect' | 'network' | 'extensions' | 'files' | 'settings';
  label: string;
  route: string;
  icon: 'home' | 'search' | 'network' | 'puzzle' | 'download' | 'settings';
  order: number;
};

export const destinations = [
  { id: 'home', label: 'Home', route: '/', icon: 'home', order: 10 },
  { id: 'inspect', label: 'Inspect', route: '/protocols', icon: 'search', order: 20 },
  { id: 'network', label: 'Network', route: '/network', icon: 'network', order: 30 },
  { id: 'extensions', label: 'Extensions', route: '/extensions', icon: 'puzzle', order: 40 },
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
  homeEntry?: { label: string };
  inspectEntry?: true;
};

export const featureRegistry = [
  {
    id: 'overview',
    destination: 'home',
    label: 'Home',
    route: '/',
    order: 10,
  },
  {
    id: 'protocols',
    destination: 'inspect',
    label: 'Inspect',
    route: '/protocols',
    order: 20,
    homeEntry: {
      label: 'Send an API request',
    },
  },
  {
    id: 'grpc',
    destination: 'inspect',
    label: 'gRPC',
    route: '/protocols/grpc',
    order: 30,
    compatibilityRoutes: ['/grpc'],
    inspectEntry: true,
  },
  {
    id: 'http',
    destination: 'inspect',
    label: 'HTTP',
    route: '/protocols/http',
    order: 40,
    compatibilityRoutes: ['/http'],
    inspectEntry: true,
  },
  {
    id: 'events',
    destination: 'inspect',
    label: 'Event streams',
    route: '/protocols/events',
    order: 45,
    inspectEntry: true,
  },
  {
    id: 'capnp',
    destination: 'inspect',
    label: 'Cap’n Proto',
    route: '/protocols/capnp',
    order: 47,
    inspectEntry: true,
  },
  {
    id: 'network',
    destination: 'network',
    label: 'Network',
    route: '/network',
    order: 50,
  },
  {
    id: 'network-ports',
    destination: 'network',
    label: 'Port scanner',
    route: '/network/ports',
    order: 55,
  },
  {
    id: 'network-diagnostics',
    destination: 'network',
    label: 'Diagnostics',
    route: '/network/diagnostics',
    order: 54,
  },
  {
    id: 'netbird',
    destination: 'extensions',
    label: 'NetBird',
    route: '/extensions/netbird',
    order: 66,
  },
  {
    id: 'network-route',
    destination: 'network',
    label: 'Next hop',
    route: '/network/route',
    order: 60,
    compatibilityRoutes: ['/routes'],
  },
  {
    id: 'network-nmap',
    destination: 'extensions',
    label: 'Nmap',
    route: '/network/nmap',
    order: 65,
  },
  {
    id: 'network-packets',
    destination: 'network',
    label: 'Packets',
    route: '/network/packets',
    order: 67,
  },
  {
    id: 'network-path',
    destination: 'network',
    label: 'Network path',
    route: '/network/path',
    order: 70,
    homeEntry: {
      label: 'Trace a network path',
    },
  },
  {
    id: 'network-local',
    destination: 'network',
    label: 'Nearby devices',
    route: '/network/local',
    order: 80,
    homeEntry: {
      label: 'See nearby devices',
    },
  },
  {
    id: 'network-map',
    destination: 'network',
    label: 'Network evidence map',
    route: '/network/map',
    order: 90,
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
    homeEntry: {
      label: 'Check this device',
    },
  },
  {
    id: 'tailnet',
    destination: 'extensions',
    label: 'Tailscale',
    route: '/network/tailnet',
    order: 115,
  },
  {
    id: 'extensions',
    destination: 'extensions',
    label: 'Extensions',
    route: '/extensions',
    order: 125,
    homeEntry: {
      label: 'Add optional tools',
    },
  },
  {
    id: 'tunnels',
    destination: 'extensions',
    label: 'Cloudflare Tunnel',
    route: '/tunnels',
    order: 130,
  },
  {
    id: 'publishing',
    destination: 'extensions',
    label: 'Share a local service',
    route: '/extensions/publish',
    order: 128,
  },
  {
    id: 'downloader',
    destination: 'files',
    label: 'Downloader',
    route: '/downloader',
    order: 120,
    compatibilityRoutes: ['/downloads'],
    homeEntry: {
      label: 'Download a file',
    },
  },
  {
    id: 'local-transfer',
    destination: 'files',
    label: 'Local transfer',
    route: '/files/local',
    order: 122,
    homeEntry: {
      label: 'Send a local file',
    },
  },
  {
    id: 'security',
    destination: 'inspect',
    label: 'Security',
    route: '/security',
    order: 140,
    homeEntry: {
      label: 'Check a public website',
    },
    inspectEntry: true,
  },
  {
    id: 'settings',
    destination: 'settings',
    label: 'Settings',
    route: '/settings',
    order: 150,
  },
  {
    id: 'agents',
    destination: 'settings',
    label: 'AI agents',
    route: '/agents',
    order: 155,
  },
  {
    id: 'updates',
    destination: 'settings',
    label: 'Updates',
    route: '/updates',
    order: 156,
  },
  {
    id: 'roadmap',
    destination: 'settings',
    label: 'Roadmap',
    route: '/roadmap',
    order: 160,
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
export type HomeEntryFeature = WithField<'homeEntry'>;
export type InspectEntryFeature = WithField<'inspectEntry'>;

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
