import type { FeatureId, FeatureRoute } from './feature-registry';
import type { HandoffKind } from './handoff-types';

export type ReleaseStatus = 'stable' | 'source' | 'planned';

export type ReleaseCapability = {
  featureId: FeatureId;
  releaseStatus: ReleaseStatus;
  docsSlug?: string;
  accepts?: readonly HandoffKind[];
  produces?: readonly HandoffKind[];
};

export const handoffDestinationRoutes = {
  'grpc-target-draft': '/protocols/grpc',
  'http-url-draft': '/protocols/http',
  'next-hop-target-draft': '/network/route',
  'publish-origin-draft': '/tunnels',
} as const satisfies Record<HandoffKind, FeatureRoute>;

export const releaseCapabilities = [
  {
    featureId: 'grpc',
    releaseStatus: 'stable',
    docsSlug: 'grpc-workbench',
    accepts: ['grpc-target-draft'],
    produces: ['grpc-target-draft', 'http-url-draft'],
  },
  {
    featureId: 'http',
    releaseStatus: 'stable',
    docsSlug: 'http-workbench',
    accepts: ['http-url-draft'],
  },
  {
    featureId: 'events',
    releaseStatus: 'stable',
    docsSlug: 'http-workbench',
  },
  { featureId: 'capnp', releaseStatus: 'stable', docsSlug: 'capnp-workbench' },
  {
    featureId: 'network',
    releaseStatus: 'stable',
    docsSlug: 'network-workbench',
    produces: ['grpc-target-draft', 'http-url-draft'],
  },
  {
    featureId: 'network-route',
    releaseStatus: 'stable',
    docsSlug: 'route-and-nmap-evidence',
    accepts: ['next-hop-target-draft'],
  },
  {
    featureId: 'this-pc',
    releaseStatus: 'stable',
    docsSlug: 'this-pc',
    produces: [
      'grpc-target-draft',
      'http-url-draft',
      'next-hop-target-draft',
      'publish-origin-draft',
    ],
  },
  {
    featureId: 'tunnels',
    releaseStatus: 'stable',
    docsSlug: 'cloudflare-tunnels',
    accepts: ['publish-origin-draft'],
    produces: ['grpc-target-draft', 'http-url-draft'],
  },
  { featureId: 'tailnet', releaseStatus: 'stable', docsSlug: 'network-workbench' },
  { featureId: 'downloader', releaseStatus: 'stable', docsSlug: 'downloader' },
  { featureId: 'network-ports', releaseStatus: 'stable', docsSlug: 'network-workbench' },
  { featureId: 'network-nmap', releaseStatus: 'stable', docsSlug: 'network-workbench' },
  { featureId: 'network-packets', releaseStatus: 'stable', docsSlug: 'network-workbench' },
  { featureId: 'security', releaseStatus: 'stable', docsSlug: 'security' },
  { featureId: 'settings', releaseStatus: 'stable', docsSlug: 'settings' },
  { featureId: 'roadmap', releaseStatus: 'stable', docsSlug: 'feature-roadmap' },
] as const satisfies readonly ReleaseCapability[];

export function stableReleaseFeatures<Capability extends Pick<ReleaseCapability, 'releaseStatus'>>(
  capabilities: readonly Capability[]
) {
  return capabilities.filter((capability) => capability.releaseStatus === 'stable');
}

export function currentSourceFeatures<Capability extends Pick<ReleaseCapability, 'releaseStatus'>>(
  capabilities: readonly Capability[]
) {
  return capabilities.filter((capability) => capability.releaseStatus !== 'planned');
}

export const stableReleaseCapabilityIndex = stableReleaseFeatures(releaseCapabilities);
export const currentSourceCapabilityIndex = currentSourceFeatures(releaseCapabilities);
