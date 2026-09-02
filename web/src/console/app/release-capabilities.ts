import type { FeatureId } from './feature-registry';
import type { HandoffKind } from './handoff-types';

export type ReleaseStatus = 'stable' | 'source' | 'planned';

export type ReleaseCapability = {
  featureId: FeatureId;
  releaseStatus: ReleaseStatus;
  docsSlug?: string;
  accepts?: readonly HandoffKind[];
  produces?: readonly HandoffKind[];
};

export const releaseCapabilities = [
  {
    featureId: 'grpc',
    releaseStatus: 'stable',
    docsSlug: 'grpc-workbench',
    accepts: ['grpc-target-draft'],
  },
  {
    featureId: 'http',
    releaseStatus: 'stable',
    docsSlug: 'http-workbench',
    accepts: ['http-url-draft'],
  },
  { featureId: 'network', releaseStatus: 'stable', docsSlug: 'network-workbench' },
  {
    featureId: 'network-route',
    releaseStatus: 'stable',
    docsSlug: 'route-and-nmap-evidence',
  },
  { featureId: 'this-pc', releaseStatus: 'source', docsSlug: 'this-pc' },
  {
    featureId: 'tunnels',
    releaseStatus: 'source',
    docsSlug: 'cloudflare-tunnels',
    produces: ['grpc-target-draft', 'http-url-draft'],
  },
  { featureId: 'downloader', releaseStatus: 'stable', docsSlug: 'downloader' },
  { featureId: 'security', releaseStatus: 'source', docsSlug: 'security' },
  { featureId: 'settings', releaseStatus: 'source', docsSlug: 'settings' },
  { featureId: 'roadmap', releaseStatus: 'source', docsSlug: 'feature-roadmap' },
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
