import type { PlannedTunnelRoute } from '@/console/tunnels/route-plan';
import type { TunnelDeployment, TunnelRoute } from '@/console/tunnels-api';

export function statusLabel(status: string) {
  const labels: Record<string, string> = {
    running: 'Connected',
    stopped: 'Stopped',
    starting: 'Starting',
    stopping: 'Stopping',
    paused: 'Paused',
    observed: 'Observed',
    'not-applicable': 'Not applicable',
    unavailable: 'Unavailable',
    unknown: 'Unknown',
  };
  return labels[status] ?? 'Unknown';
}

export function managementLabel(mode: string) {
  if (mode === 'remote') return 'Remote managed';
  if (mode === 'local') return 'Local YAML';
  return 'Authority unknown';
}

export function driverLabel(driver: string) {
  if (driver === 'system-service') return 'System service';
  if (driver === 'config-only') return 'Unmanaged config';
  if (driver === 'owned-child') return 'ProtoPeek process';
  if (driver === 'compose-profile') return 'Compose profile';
  return 'Observed deployment';
}

export function deploymentServiceScope(deployment: TunnelDeployment) {
  if (deployment.driver === 'config-only')
    return 'Configuration-only deployment; it is not bound to the canonical host service.';
  if (deployment.driver === 'compose-profile')
    return 'Compose-managed deployment; manage its process through Docker Compose.';
  if (deployment.driver === 'owned-child')
    return 'ProtoPeek-owned child process; canonical host service controls do not apply.';
  if (deployment.managementMode === 'remote')
    return 'Remote-managed deployment; no canonical host service binding was reported.';
  return 'This deployment is not bound to the canonical host service.';
}

export function hostnameRouteLabel(routes: Array<TunnelRoute | PlannedTunnelRoute>) {
  const count = routes.filter((route) => !route.catchAll).length;
  return `${count} hostname route${count === 1 ? '' : 's'}`;
}

export function routeCountLabel(routes: Array<TunnelRoute | PlannedTunnelRoute>) {
  const catchAll = routes.some((route) => route.catchAll);
  const drafts = routes.filter((route) => 'planned' in route && route.planned).length;
  const parts = [hostnameRouteLabel(routes), catchAll ? '+ catch-all' : '· no catch-all'];
  if (drafts) parts.push(`· ${drafts} draft${drafts === 1 ? '' : 's'}`);
  return parts.join(' ');
}

export function formatObserved(value: string) {
  const age = Date.now() - Date.parse(value);
  if (Number.isFinite(age) && age >= 0 && age < 60_000) return 'just now';
  return formatTimestamp(value);
}

export function formatTimestamp(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'time unavailable';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    date
  );
}

export async function copyText(value: string, onNotice: (value: string) => void) {
  try {
    await navigator.clipboard.writeText(value);
    onNotice('Copied to the clipboard.');
  } catch {
    onNotice('Clipboard access was unavailable.');
  }
}
