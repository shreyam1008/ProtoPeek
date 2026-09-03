import { describe, expect, it } from 'vitest';

import {
  commandDestinationFeatures,
  destinationForPath,
  destinations,
  featureForPath,
  featureRegistry,
  getCompatibilityRouteTargets,
  homeEntryFeatures,
  inspectEntryFeatures,
} from './feature-registry';
import { handoffDraftKinds, handoffKinds } from './handoff-types';
import {
  currentSourceFeatures,
  handoffDestinationRoutes,
  releaseCapabilities,
  stableReleaseFeatures,
} from './release-capabilities';

const publicDocsSlugs = new Set([
  'cloudflare-tunnels',
  'downloader',
  'feature-roadmap',
  'grpc-workbench',
  'http-workbench',
  'network-workbench',
  'route-and-nmap-evidence',
  'security',
  'settings',
  'this-pc',
]);

describe('feature registry', () => {
  it('owns the six permanent destinations in deterministic product order', () => {
    expect(destinations.map((destination) => destination.id)).toEqual([
      'home',
      'inspect',
      'network',
      'publish',
      'files',
      'settings',
    ]);
    expect(destinations.map((destination) => destination.order)).toEqual([10, 20, 30, 40, 50, 60]);
    expect(destinations.map(({ route }) => route)).toEqual([
      '/',
      '/protocols',
      '/network',
      '/tunnels',
      '/downloader',
      '/settings',
    ]);
    expect(destinations.map(({ label }) => label)).toEqual([
      'Home',
      'Inspect',
      'Network',
      'Publish',
      'Files',
      'Settings',
    ]);
  });

  it('maps every canonical feature, alias, and trailing slash to exactly one owner', () => {
    for (const feature of featureRegistry) {
      for (const pathname of [feature.route, `${feature.route}/`]) {
        expect(featureForPath(pathname)?.id).toBe(feature.id);
        expect(destinationForPath(pathname)?.id).toBe(feature.destination);
      }
      if ('compatibilityRoutes' in feature) {
        for (const alias of feature.compatibilityRoutes) {
          for (const pathname of [alias, `${alias}/`]) {
            expect(featureForPath(pathname)?.id).toBe(feature.id);
            expect(destinationForPath(pathname)?.id).toBe(feature.destination);
          }
        }
      }
    }

    expect(featureForPath('/networking')).toBeUndefined();
    expect(featureForPath('/protocols-extra')).toBeUndefined();
    expect(featureForPath('/network/path/extra')).toBeUndefined();
    expect(destinationForPath('/not-a-route')).toBeUndefined();
  });

  it('keeps feature IDs, canonical paths, aliases, and ordering unique', () => {
    const compatibilityRouteTargets = getCompatibilityRouteTargets();
    const ids = featureRegistry.map((feature) => feature.id);
    const routes = featureRegistry.map((feature) => feature.route);
    const routeSet = new Set<string>(routes);
    const orders = featureRegistry.map((feature) => feature.order);
    const aliases = compatibilityRouteTargets.map(({ route }) => route);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(routes).size).toBe(routes.length);
    expect(new Set(orders).size).toBe(orders.length);
    expect(new Set(aliases).size).toBe(aliases.length);
    expect(commandDestinationFeatures.map((feature) => feature.order)).toEqual([
      10, 20, 30, 40, 60, 70, 80, 90, 110, 120, 130, 140, 150, 160,
    ]);
    expect(aliases.every((alias) => !routeSet.has(alias))).toBe(true);
  });

  it('maps every compatibility path to an existing canonical feature', () => {
    const compatibilityRouteTargets = getCompatibilityRouteTargets();
    expect(compatibilityRouteTargets).toEqual([
      { route: '/grpc', target: '/protocols/grpc' },
      { route: '/http', target: '/protocols/http' },
      { route: '/routes', target: '/network/route' },
      { route: '/downloads', target: '/downloader' },
    ]);
    expect(
      compatibilityRouteTargets.every(({ target }) =>
        featureRegistry.some((feature) => feature.route === target)
      )
    ).toBe(true);
  });

  it('uses only published, canonical documentation slugs', () => {
    for (const capability of releaseCapabilities) {
      expect(featureRegistry.some((feature) => feature.id === capability.featureId)).toBe(true);
      expect(capability.docsSlug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(publicDocsSlugs.has(capability.docsSlug)).toBe(true);
    }
  });

  it('derives commands, Home entries, and Inspect entries from registry entries', () => {
    for (const surface of [commandDestinationFeatures, homeEntryFeatures, inspectEntryFeatures]) {
      expect(surface.every((feature) => featureRegistry.includes(feature))).toBe(true);
    }

    expect(commandDestinationFeatures.map((feature) => feature.command.label)).toEqual([
      'Open Home',
      'Open Inspect',
      'Open gRPC workbench',
      'Open HTTP workbench',
      'Open next-hop route evidence',
      'Trace a measured network path',
      'Discover an authorized local network',
      'Open the network evidence map',
      'Open This Device',
      'Open Downloader',
      'Open Cloudflare tunnel operations',
      'Open Security evidence',
      'Open Settings',
      'Open product roadmap',
    ]);
    expect(homeEntryFeatures.map((feature) => feature.homeEntry.label)).toEqual([
      'Send an API request',
      'Trace a network path',
      'Check this device',
      'Inspect Cloudflare tunnels',
      'Download a file',
      'Check a public website',
    ]);
    expect(inspectEntryFeatures.map((feature) => feature.label)).toEqual([
      'gRPC',
      'HTTP',
      'Security',
    ]);
    expect(featureRegistry.every((feature) => !('navigation' in feature))).toBe(true);
  });

  it('cannot promote planned entries into stable or current-source capability claims', () => {
    const fixture = [
      { id: 'stable', releaseStatus: 'stable' as const },
      { id: 'source', releaseStatus: 'source' as const },
      { id: 'planned', releaseStatus: 'planned' as const },
    ];

    expect(stableReleaseFeatures(fixture).map(({ id }) => id)).toEqual(['stable']);
    expect(currentSourceFeatures(fixture).map(({ id }) => id)).toEqual(['stable', 'source']);
    expect(releaseCapabilities.map((capability) => capability.releaseStatus)).not.toContain(
      'planned'
    );
  });

  it('keeps the handoff vocabulary limited to current unsent protocol drafts', () => {
    expect(handoffKinds).toEqual(['grpc-target-draft', 'http-url-draft']);
  });

  it('routes every typed draft to an accepting owner and records current producers', () => {
    for (const kind of handoffDraftKinds) {
      const owner = featureForPath(handoffDestinationRoutes[kind]);
      const capability = releaseCapabilities.find(({ featureId }) => featureId === owner?.id);
      expect(owner).toBeDefined();
      expect(capability && 'accepts' in capability ? capability.accepts : []).toContain(kind);
    }

    const producedBy = (featureId: string) => {
      const capability = releaseCapabilities.find((entry) => entry.featureId === featureId);
      return capability && 'produces' in capability ? capability.produces : [];
    };
    expect(producedBy('grpc')).toEqual(['grpc-target-draft', 'http-url-draft']);
    expect(producedBy('network')).toEqual(['grpc-target-draft', 'http-url-draft']);
    expect(producedBy('this-pc')).toEqual(handoffDraftKinds);
    expect(producedBy('tunnels')).toEqual(['grpc-target-draft', 'http-url-draft']);
  });
});
