import {
  type DestinationId,
  type FeatureId,
  type FeatureRoute,
  featureForPath,
  featureRegistry,
} from '../app/feature-registry';

export const toolGroups: Record<
  DestinationId,
  readonly { label: string; ids: readonly FeatureId[] }[]
> = {
  home: [{ label: 'Workspace', ids: ['overview'] }],
  inspect: [
    { label: 'Requests', ids: ['protocols', 'http', 'grpc', 'events', 'capnp'] },
    { label: 'Website', ids: ['security'] },
  ],
  network: [
    { label: 'Device & services', ids: ['this-pc', 'network-ports', 'tailnet'] },
    {
      label: 'Routes & discovery',
      ids: ['network-route', 'network-path', 'network-local', 'network-nmap', 'network-packets'],
    },
    { label: 'Saved evidence', ids: ['network-map', 'network-history'] },
  ],
  publish: [{ label: 'Local publishing', ids: ['tunnels'] }],
  files: [{ label: 'Transfers', ids: ['downloader'] }],
  settings: [
    { label: 'Preferences', ids: ['settings', 'updates'] },
    { label: 'Integrations & help', ids: ['agents', 'roadmap'] },
  ],
};

export function toolsForGroup(ids: readonly FeatureId[]) {
  return ids.map((id) => featureRegistry.find((feature) => feature.id === id)!);
}

export type DestinationRoutes = Partial<Record<DestinationId, FeatureRoute>>;
const key = 'protopeek.navigation.destinations.v1';

export function readDestinationRoutes(): DestinationRoutes {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw || raw.length > 2048) return {};
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result: DestinationRoutes = {};
    for (const [destination, path] of Object.entries(value)) {
      if (typeof path !== 'string') continue;
      const feature = featureForPath(path);
      if (feature?.destination === destination) result[feature.destination] = feature.route;
    }
    return result;
  } catch {
    return {};
  }
}

export function saveDestinationRoutes(routes: DestinationRoutes) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(routes));
  } catch {
    /* Navigation still works without storage. */
  }
}
