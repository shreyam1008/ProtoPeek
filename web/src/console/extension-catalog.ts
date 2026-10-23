import type { FeatureRoute } from './app/feature-registry';
import manifest from './extension-manifest.json';

/** The legacy bulk API retains its original six integrations and version. */
export const extensionIds = [
  'tailscale',
  'cloudflared',
  'netbird',
  'wireshark',
  'nmap',
  'aria2',
] as const;
export const catalogIds = [
  ...extensionIds,
  'caddy',
  'ngrok',
  'openssh',
  'docker',
  'podman',
  'kubectl',
  'openssl',
  'codex',
  'claude-code',
  'gemini-cli',
  'opencode',
  'ollama',
  'lm-studio',
  'chatgpt',
] as const;
export type ExtensionId = (typeof catalogIds)[number];
export type SetupPlatform = 'windows' | 'darwin' | 'linux';
export type ExtensionCapability =
  | 'native-workbench'
  | 'command-guide'
  | 'mcp-setup'
  | 'endpoint-guide'
  | 'external-link';
export type ExtensionDefinition = {
  id: ExtensionId;
  name: string;
  group: string;
  summary: string;
  capability: ExtensionCapability;
  route?: FeatureRoute;
  openLabel?: string;
};
export const extensionCatalog = manifest as readonly ExtensionDefinition[];
export const capabilityLabels: Record<ExtensionCapability, string> = {
  'native-workbench': 'Native workbench',
  'command-guide': 'Command guide',
  'mcp-setup': 'MCP setup',
  'endpoint-guide': 'Endpoint guide',
  'external-link': 'External link',
};
export function isExtensionId(value: unknown): value is ExtensionId {
  return typeof value === 'string' && (catalogIds as readonly string[]).includes(value);
}
export type ExtensionObservation = {
  id: ExtensionId;
  status: 'detected' | 'included' | 'missing' | 'unavailable' | 'external';
  source: 'configured' | 'path' | 'standard-location' | 'bundled' | 'cached-bundle' | 'none';
  path: string;
  message: string;
  bundled: boolean;
  bundledBytes: number;
};
export type ExtensionSnapshot = {
  schemaVersion: 1;
  platform: string;
  architecture: string;
  observedAt: string;
  extensions: ExtensionObservation[];
};
export type SingleExtensionSnapshot = Omit<ExtensionSnapshot, 'schemaVersion'> & {
  schemaVersion: 2;
};
export function setupPlatform(value: string | undefined): SetupPlatform | undefined {
  return value === 'windows' || value === 'darwin' || value === 'linux' ? value : undefined;
}
function boundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length <= maximum &&
    ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  );
}
function parseSnapshot(
  value: unknown,
  version: 1 | 2,
  ids: readonly ExtensionId[]
): ExtensionSnapshot | SingleExtensionSnapshot {
  const invalid = () =>
    new Error('Could not read local tool status. Check this host to try again.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const data = value as Record<string, unknown>;
  if (
    data.schemaVersion !== version ||
    !boundedText(data.platform, 32) ||
    !boundedText(data.architecture, 32) ||
    !boundedText(data.observedAt, 64) ||
    !Number.isFinite(Date.parse(data.observedAt)) ||
    !Array.isArray(data.extensions) ||
    data.extensions.length !== ids.length
  )
    throw invalid();
  const found = new Set<ExtensionId>();
  for (const candidate of data.extensions) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw invalid();
    const item = candidate as ExtensionObservation;
    if (
      !ids.includes(item.id) ||
      found.has(item.id) ||
      ![
        'detected',
        'included',
        'missing',
        'unavailable',
        ...(version === 2 && item.id === 'chatgpt' ? ['external'] : []),
      ].includes(item.status) ||
      !['configured', 'path', 'standard-location', 'bundled', 'cached-bundle', 'none'].includes(
        item.source
      ) ||
      !boundedText(item.path, 4096) ||
      !boundedText(item.message, 2048) ||
      typeof item.bundled !== 'boolean' ||
      !Number.isSafeInteger(item.bundledBytes) ||
      item.bundledBytes < 0 ||
      item.bundledBytes > 64 * 1024 * 1024 ||
      (item.status === 'external' &&
        (item.source !== 'none' || item.path || item.bundled || item.bundledBytes))
    )
      throw invalid();
    found.add(item.id);
  }
  return data as ExtensionSnapshot | SingleExtensionSnapshot;
}
export function parseExtensionSnapshot(value: unknown): ExtensionSnapshot {
  return parseSnapshot(value, 1, extensionIds) as ExtensionSnapshot;
}
/** A detail response cannot be mistaken for another selected pack or the legacy bulk shape. */
export function parseExtensionObservation(
  value: unknown,
  requestedId: ExtensionId
): SingleExtensionSnapshot {
  if (!isExtensionId(requestedId))
    throw new Error('Unknown extension. Open the library and choose a supported tool.');
  return parseSnapshot(value, 2, [requestedId]) as SingleExtensionSnapshot;
}
