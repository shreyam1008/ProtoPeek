export type TunnelCapability = {
  supported: boolean;
  reason: string;
};

export type TunnelInstallCommand = {
  id: string;
  label: string;
  command: string;
  requiresElevation: boolean;
};

export type TunnelInstall = {
  platform: string;
  architecture: string;
  processElevated: boolean;
  elevationMechanism: string;
  downloadsUrl: string;
  releasesUrl: string;
  serviceDocsUrl: string;
  elevationNotice: string;
  commands: TunnelInstallCommand[];
};

export type TunnelCapabilities = {
  schemaVersion: number;
  scope: string;
  scopeNotice: string;
  platform: string;
  serviceManager: string;
  install: TunnelInstall;
  manualRefresh: TunnelCapability;
  serviceObservation: TunnelCapability;
  configInspection: TunnelCapability;
  routePlanPreview: TunnelCapability;
  serviceControl: TunnelCapability;
  configMutation: TunnelCapability;
  accountConnection: TunnelCapability;
  backgroundPolling: TunnelCapability;
};

export type TunnelReleaseStatus =
  | 'not-installed'
  | 'current'
  | 'update-available'
  | 'newer'
  | 'unknown';

export type TunnelRelease = {
  schemaVersion: number;
  checkedAt: string;
  installedVersion: string;
  latestVersion: string;
  status: TunnelReleaseStatus;
  supportStatus: 'supported' | 'out-of-support' | 'unknown' | 'not-installed';
  publishedAt: string;
  releaseUrl: string;
  downloadsUrl: string;
  note: string;
};

export type TunnelServiceAction = 'start' | 'stop' | 'restart';
export type TunnelServiceActionStatus =
  | 'completed'
  | 'unchanged'
  | 'elevation-required'
  | 'not-installed'
  | 'stale'
  | 'failed';

export type TunnelServiceActionResult = {
  schemaVersion: number;
  action: TunnelServiceAction;
  status: TunnelServiceActionStatus;
  message: string;
  elevationRequired: boolean;
  elevationMechanism: string;
  manualCommand: string;
  service: TunnelRuntime;
  observedAt: string;
};

export type TunnelTool = {
  found: boolean;
  path: string;
  version: string;
  note: string;
};

export type TunnelRuntime = {
  manager: string;
  label: string;
  present: boolean;
  state: string;
  detail: string;
  pid: number;
  executablePath: string;
};

export type TunnelRoute = {
  id: string;
  hostname: string;
  path: string;
  service: string;
  protocol: string;
  catchAll: boolean;
};

export type TunnelConfigSource = {
  id: string;
  path: string;
  source: string;
  exists: boolean;
  readable: boolean;
  regular: boolean;
  symlink: boolean;
  valid: boolean;
  effective: boolean;
  boundToCanonicalService: boolean;
  serviceBinding: string;
  managementMode: string;
  tunnel: string;
  credentialsPath: string;
  revision: string;
  catchAllPresent: boolean;
  routeCount: number;
  warnings: string[];
};

export type TunnelDeployment = {
  id: string;
  name: string;
  driver: string;
  managementMode: string;
  configurationAuthority: string;
  status: string;
  statusDetail: string;
  configPath: string;
  configRevision: string;
  credentialSource: string;
  configSourceId: string;
  boundToCanonicalService: boolean;
  serviceBinding: string;
  routes: TunnelRoute[];
  runtime: TunnelRuntime;
  warnings: string[];
};

export type TunnelSnapshot = {
  schemaVersion: number;
  scope: string;
  scopeNotice: string;
  observedAt: string;
  status: string;
  cloudflared: TunnelTool;
  wrangler: TunnelTool;
  docker: TunnelTool;
  service: TunnelRuntime;
  configSources: TunnelConfigSource[];
  deployments: TunnelDeployment[];
  notes: string[];
};

export class TunnelAPIError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'TunnelAPIError';
    this.status = status;
  }
}

const deploymentStatuses = new Set([
  'running',
  'stopped',
  'starting',
  'stopping',
  'paused',
  'observed',
  'unknown',
]);

const releaseStatuses = new Set<TunnelReleaseStatus>([
  'not-installed',
  'current',
  'update-available',
  'newer',
  'unknown',
]);
const supportStatuses = new Set<TunnelRelease['supportStatus']>([
  'supported',
  'out-of-support',
  'unknown',
  'not-installed',
]);

const serviceActions = new Set<TunnelServiceAction>(['start', 'stop', 'restart']);
const serviceActionStatuses = new Set<TunnelServiceActionStatus>([
  'completed',
  'unchanged',
  'elevation-required',
  'not-installed',
  'stale',
  'failed',
]);

function urlFor(path: string) {
  return new URL(path, window.location.href).toString();
}

function csrfToken() {
  return document.cookie.match(/(?:^|;\s*)_protopeek_csrf_token=([^;]+)/)?.[1] ?? '';
}

async function boundedError(response: Response, limit = 8 * 1024) {
  const fallback = `${response.status} ${response.statusText}`.trim() || 'Tunnel request failed.';
  if (!response.body) return (await response.text()).slice(0, limit).trim() || fallback;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let truncated = false;
  try {
    while (length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = limit - length;
      chunks.push(value.subarray(0, remaining));
      length += Math.min(value.length, remaining);
      if (value.length > remaining) {
        truncated = true;
        break;
      }
    }
  } finally {
    if (truncated) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  const decoded = new TextDecoder().decode(joined).trim();
  if (decoded) {
    try {
      const payload = JSON.parse(decoded) as unknown;
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const message = (payload as Record<string, unknown>).error;
        if (typeof message === 'string' && message.trim()) {
          return `${message.slice(0, limit).trim()}${truncated ? '…' : ''}`;
        }
      }
    } catch {
      // The bounded plain-text response is still useful below.
    }
  }
  return `${decoded || fallback}${truncated ? '…' : ''}`;
}

async function requestJSON(path: string, init: RequestInit) {
  const response = await fetch(urlFor(path), {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init.method && init.method !== 'GET' ? { 'x-protopeek-csrf-token': csrfToken() } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new TunnelAPIError(response.status, await boundedError(response));
  return response.json() as Promise<unknown>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, maximum = 2 * 1024) {
  return typeof value === 'string' ? value.slice(0, maximum) : '';
}

function timestamp(value: unknown) {
  const candidate = text(value, 128);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : '';
}

function httpsURL(value: unknown) {
  const candidate = text(value, 4 * 1024);
  if (!candidate) return '';
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function boolean(value: unknown) {
  return value === true;
}

function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? Math.min(value as number, maximum)
    : 0;
}

function strings(value: unknown, maximumItems = 64) {
  return Array.isArray(value)
    ? value
        .slice(0, maximumItems)
        .map((item) => text(item, 2 * 1024))
        .filter(Boolean)
    : [];
}

function capability(value: unknown): TunnelCapability {
  const item = record(value);
  return { supported: boolean(item.supported), reason: text(item.reason) };
}

function installCommand(value: unknown): TunnelInstallCommand | null {
  const item = record(value);
  const id = text(item.id, 64);
  const command = text(item.command, 4 * 1024);
  if (!id || !command) return null;
  return {
    id,
    label: text(item.label, 160) || id,
    command,
    requiresElevation: boolean(item.requiresElevation),
  };
}

function install(value: unknown): TunnelInstall {
  const item = record(value);
  return {
    platform: text(item.platform, 32) || 'unknown',
    architecture: text(item.architecture, 32) || 'unknown',
    processElevated: boolean(item.processElevated),
    elevationMechanism: text(item.elevationMechanism, 80),
    downloadsUrl: httpsURL(item.downloadsUrl),
    releasesUrl: httpsURL(item.releasesUrl),
    serviceDocsUrl: httpsURL(item.serviceDocsUrl),
    elevationNotice: text(item.elevationNotice),
    commands: Array.isArray(item.commands)
      ? item.commands
          .slice(0, 16)
          .map(installCommand)
          .filter((entry): entry is TunnelInstallCommand => entry !== null)
      : [],
  };
}

function tool(value: unknown): TunnelTool {
  const item = record(value);
  return {
    found: boolean(item.found),
    path: text(item.path, 4 * 1024),
    version: text(item.version, 160),
    note: text(item.note),
  };
}

function runtime(value: unknown): TunnelRuntime {
  const item = record(value);
  return {
    manager: text(item.manager, 80),
    label: text(item.label, 160),
    present: boolean(item.present),
    state: text(item.state, 32) || 'unknown',
    detail: text(item.detail),
    pid: integer(item.pid, 2 ** 31 - 1),
    executablePath: text(item.executablePath, 4 * 1024),
  };
}

function route(value: unknown): TunnelRoute | null {
  const item = record(value);
  const id = text(item.id, 64);
  if (!id) return null;
  return {
    id,
    hostname: text(item.hostname, 253),
    path: text(item.path, 1024),
    service: text(item.service, 2 * 1024),
    protocol: text(item.protocol, 24) || 'unknown',
    catchAll: boolean(item.catchAll),
  };
}

function configSource(value: unknown): TunnelConfigSource | null {
  const item = record(value);
  const path = text(item.path, 4 * 1024);
  if (!path) return null;
  return {
    id: text(item.id, 64),
    path,
    source: text(item.source, 64),
    exists: boolean(item.exists),
    readable: boolean(item.readable),
    regular: boolean(item.regular),
    symlink: boolean(item.symlink),
    valid: boolean(item.valid),
    effective: boolean(item.effective),
    boundToCanonicalService: boolean(item.boundToCanonicalService),
    serviceBinding: text(item.serviceBinding, 80),
    managementMode: text(item.managementMode, 32),
    tunnel: text(item.tunnel, 160),
    credentialsPath: text(item.credentialsPath, 4 * 1024),
    revision: text(item.revision, 64),
    catchAllPresent: boolean(item.catchAllPresent),
    routeCount: integer(item.routeCount, 256),
    warnings: strings(item.warnings),
  };
}

function deployment(value: unknown): TunnelDeployment | null {
  const item = record(value);
  const id = text(item.id, 64);
  if (!id) return null;
  const status = text(item.status, 32);
  return {
    id,
    name: text(item.name, 160) || 'Unnamed deployment',
    driver: text(item.driver, 64) || 'unknown',
    managementMode: text(item.managementMode, 32) || 'unknown',
    configurationAuthority: text(item.configurationAuthority, 160) || 'Unknown',
    status: deploymentStatuses.has(status) ? status : 'unknown',
    statusDetail: text(item.statusDetail),
    configPath: text(item.configPath, 4 * 1024),
    configRevision: text(item.configRevision, 64),
    credentialSource: text(item.credentialSource, 4 * 1024) || 'none observed',
    configSourceId: text(item.configSourceId, 64),
    boundToCanonicalService: boolean(item.boundToCanonicalService),
    serviceBinding: text(item.serviceBinding, 80),
    routes: Array.isArray(item.routes)
      ? item.routes
          .slice(0, 256)
          .map(route)
          .filter((entry): entry is TunnelRoute => entry !== null)
      : [],
    runtime: runtime(item.runtime),
    warnings: strings(item.warnings),
  };
}

export function normalizeTunnelCapabilities(value: unknown): TunnelCapabilities {
  const item = record(value);
  return {
    schemaVersion: integer(item.schemaVersion, 16),
    scope: text(item.scope, 64),
    scopeNotice: text(item.scopeNotice),
    platform: text(item.platform, 32) || 'unknown',
    serviceManager: text(item.serviceManager, 80) || 'unknown',
    install: install(item.install),
    manualRefresh: capability(item.manualRefresh),
    serviceObservation: capability(item.serviceObservation),
    configInspection: capability(item.configInspection),
    routePlanPreview: capability(item.routePlanPreview),
    serviceControl: capability(item.serviceControl),
    configMutation: capability(item.configMutation),
    accountConnection: capability(item.accountConnection),
    backgroundPolling: capability(item.backgroundPolling),
  };
}

export function normalizeTunnelRelease(value: unknown): TunnelRelease {
  const item = record(value);
  const status = text(item.status, 32) as TunnelReleaseStatus;
  const supportStatus = text(item.supportStatus, 32) as TunnelRelease['supportStatus'];
  return {
    schemaVersion: integer(item.schemaVersion, 16),
    checkedAt: timestamp(item.checkedAt),
    installedVersion: text(item.installedVersion, 160),
    latestVersion: text(item.latestVersion, 160),
    status: releaseStatuses.has(status) ? status : 'unknown',
    supportStatus: supportStatuses.has(supportStatus) ? supportStatus : 'unknown',
    publishedAt: timestamp(item.publishedAt),
    releaseUrl: httpsURL(item.releaseUrl),
    downloadsUrl: httpsURL(item.downloadsUrl),
    note: text(item.note),
  };
}

export function normalizeTunnelServiceAction(value: unknown): TunnelServiceActionResult {
  const item = record(value);
  const action = text(item.action, 16) as TunnelServiceAction;
  const status = text(item.status, 32) as TunnelServiceActionStatus;
  return {
    schemaVersion: integer(item.schemaVersion, 16),
    action: serviceActions.has(action) ? action : 'restart',
    status: serviceActionStatuses.has(status) ? status : 'failed',
    message: text(item.message),
    elevationRequired: boolean(item.elevationRequired),
    elevationMechanism: text(item.elevationMechanism, 80),
    manualCommand: text(item.manualCommand, 4 * 1024),
    service: runtime(item.service),
    observedAt: timestamp(item.observedAt),
  };
}

export function normalizeTunnelSnapshot(value: unknown): TunnelSnapshot {
  const item = record(value);
  const observedAt = text(item.observedAt, 128);
  return {
    schemaVersion: integer(item.schemaVersion, 16),
    scope: text(item.scope, 64),
    scopeNotice: text(item.scopeNotice),
    observedAt:
      observedAt && Number.isFinite(Date.parse(observedAt))
        ? observedAt
        : new Date(0).toISOString(),
    status: text(item.status, 32) || 'unknown',
    cloudflared: tool(item.cloudflared),
    wrangler: tool(item.wrangler),
    docker: tool(item.docker),
    service: runtime(item.service),
    configSources: Array.isArray(item.configSources)
      ? item.configSources
          .slice(0, 16)
          .map(configSource)
          .filter((entry): entry is TunnelConfigSource => entry !== null)
      : [],
    deployments: Array.isArray(item.deployments)
      ? item.deployments
          .slice(0, 64)
          .map(deployment)
          .filter((entry): entry is TunnelDeployment => entry !== null)
      : [],
    notes: strings(item.notes),
  };
}

export async function fetchTunnelCapabilities(signal?: AbortSignal) {
  return normalizeTunnelCapabilities(
    await requestJSON('api/tunnels/capabilities', { method: 'GET', signal })
  );
}

export async function fetchTunnelSnapshot(signal?: AbortSignal) {
  return normalizeTunnelSnapshot(
    await requestJSON('api/tunnels/snapshot', { method: 'POST', signal })
  );
}

export async function fetchTunnelRelease(signal?: AbortSignal) {
  return normalizeTunnelRelease(
    await requestJSON('api/tunnels/release', { method: 'POST', signal })
  );
}

export async function performTunnelServiceAction(
  action: TunnelServiceAction,
  expectedState: string,
  signal?: AbortSignal
) {
  return normalizeTunnelServiceAction(
    await requestJSON('api/tunnels/service-action', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, expectedState: expectedState.slice(0, 32), confirmed: true }),
    })
  );
}
