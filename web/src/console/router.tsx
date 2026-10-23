import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
  useLocation,
} from '@tanstack/react-router';
import { type AgentClient, agentClient } from './agent-client-kind';
import type { DiagnosticMode } from './network-diagnostics';
import { ProtocolFrame } from './ProtocolFrame';
import { RouteError, RouteNotFound, RoutePending } from './shell/RouteState';

declare module '@tanstack/history' {
  interface HistoryState {
    diagnosticInvocation?: number;
  }
}

const LazyDiagnostics = lazyRouteComponent(
  () => import('./NetworkDiagnostics'),
  'NetworkDiagnostics'
);

function DiagnosticsRoute() {
  const invocation = useLocation({
    select: ({ state }) =>
      Number.isSafeInteger(state.diagnosticInvocation) && (state.diagnosticInvocation ?? -1) >= 0
        ? state.diagnosticInvocation
        : 0,
  });
  return <LazyDiagnostics key={invocation} />;
}

const rootRoute = createRootRoute({ component: ProtocolFrame, notFoundComponent: RouteNotFound });
const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: lazyRouteComponent(() => import('./Dashboard'), 'Dashboard'),
});
const protocolsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/protocols',
  component: lazyRouteComponent(() => import('./Protocols'), 'Protocols'),
});
const grpcRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/protocols/grpc',
  component: lazyRouteComponent(() => import('./App'), 'App'),
});
const httpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/protocols/http',
  component: lazyRouteComponent(() => import('./HTTPRoute'), 'HTTPRoute'),
});
const eventsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/protocols/events',
  component: lazyRouteComponent(() => import('./EventStreamWorkbench'), 'EventStreamWorkbench'),
});
const capnpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/protocols/capnp',
  component: lazyRouteComponent(() => import('./CapnpWorkbench'), 'CapnpWorkbench'),
});
const downloaderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/downloader',
  component: lazyRouteComponent(() => import('./Downloader'), 'Downloader'),
});
const localTransferRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/files/local',
  component: lazyRouteComponent(() => import('./LocalTransfer'), 'LocalTransfer'),
});
const portScannerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/network/ports',
  validateSearch: (search: Record<string, unknown>): { host?: string } => ({
    host: typeof search.host === 'string' && search.host.length <= 253 ? search.host : undefined,
  }),
  remountDeps: ({ search }) => search.host,
  component: lazyRouteComponent(() => import('./PortScanner'), 'PortScanner'),
});
const nmapScannerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/network/nmap',
  component: lazyRouteComponent(() => import('./NmapScanner'), 'NmapScanner'),
});
const diagnosticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/network/diagnostics',
  validateSearch: (
    search: Record<string, unknown>
  ): { mode?: DiagnosticMode; target?: string } => ({
    mode:
      typeof search.mode === 'string' &&
      /^(diagnose|dns|dns-compare|tls|ip-compare|availability|tcp-exchange|udp-exchange|http-proxy|socks5-proxy|http2|http3|subnet)$/.test(
        search.mode
      )
        ? (search.mode as DiagnosticMode)
        : undefined,
    target:
      typeof search.target === 'string' &&
      search.target.length <= 1024 &&
      !Array.from(search.target).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      )
        ? search.target
        : undefined,
  }),
  remountDeps: ({ search }) => [search.mode, search.target],
  component: DiagnosticsRoute,
});
const tailnetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/network/tailnet',
  component: lazyRouteComponent(() => import('./TailnetWorkbench'), 'TailnetWorkbench'),
});
const packetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/network/packets',
  validateSearch: (
    search: Record<string, unknown>
  ): { host?: string; port?: string; mode?: 'live' | 'file' } => ({
    host: typeof search.host === 'string' && search.host.length <= 64 ? search.host : undefined,
    port:
      (typeof search.port === 'string' || typeof search.port === 'number') &&
      /^\d{1,5}$/.test(String(search.port)) &&
      Number(search.port) >= 1 &&
      Number(search.port) <= 65535
        ? String(search.port)
        : undefined,
    mode: search.mode === 'live' || search.mode === 'file' ? search.mode : undefined,
  }),
  remountDeps: ({ search }) => [search.host, search.port, search.mode],
  component: lazyRouteComponent(() => import('./PacketWorkbench'), 'PacketWorkbench'),
});
const thisPCRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/this-pc',
  component: lazyRouteComponent(() => import('./ThisPC'), 'ThisPC'),
});
const tunnelsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tunnels',
  component: lazyRouteComponent(() => import('./Tunnels'), 'Tunnels'),
});
const extensionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/extensions',
  validateSearch: (search: Record<string, unknown>): { extension?: string } => ({
    extension:
      typeof search.extension === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(search.extension)
        ? search.extension
        : undefined,
  }),
  component: lazyRouteComponent(() => import('./Extensions'), 'Extensions'),
});
const routesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/network/route',
  component: lazyRouteComponent(() => import('./RoutesWorkbench'), 'RoutesWorkbench'),
});
const securityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/security',
  component: lazyRouteComponent(() => import('./Security'), 'Security'),
});
const netBirdRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/extensions/netbird',
  component: lazyRouteComponent(() => import('./NetBirdWorkbench'), 'NetBirdWorkbench'),
});
const publishingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/extensions/publish',
  component: lazyRouteComponent(() => import('./PublishingWorkbench'), 'PublishingWorkbench'),
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: lazyRouteComponent(() => import('./Settings'), 'Settings'),
});
const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents',
  validateSearch: (search: Record<string, unknown>): { client?: AgentClient } => ({
    client: agentClient(search.client),
  }),
  remountDeps: ({ search }) => search.client,
  component: lazyRouteComponent(() => import('./AgentWorkbench'), 'AgentWorkbenchRoute'),
});
const updatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/updates',
  component: lazyRouteComponent(() => import('./Updates'), 'Updates'),
});
const networkComponent = lazyRouteComponent(() => import('./NetworkWorkbench'), 'NetworkWorkbench');
const networkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/network',
  component: networkComponent,
});
const networkPathRoute = createRoute({
  getParentRoute: () => networkRoute,
  path: '/path',
});
const networkIndexRoute = createRoute({
  getParentRoute: () => networkRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/network/local' });
  },
});
const networkLocalRoute = createRoute({
  getParentRoute: () => networkRoute,
  path: '/local',
  validateSearch: (search: Record<string, unknown>): { draftSubnet?: string } => ({
    draftSubnet:
      typeof search.draftSubnet === 'string' &&
      search.draftSubnet.length <= 64 &&
      /^[0-9a-fA-F.:/]+$/.test(search.draftSubnet)
        ? search.draftSubnet
        : undefined,
  }),
});
const networkMapRoute = createRoute({
  getParentRoute: () => networkRoute,
  path: '/map',
});
const networkHistoryRoute = createRoute({
  getParentRoute: () => networkRoute,
  path: '/history',
});
const roadmapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/roadmap',
  component: lazyRouteComponent(() => import('./Roadmap'), 'Roadmap'),
});

const grpcCompatibilityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/grpc',
  beforeLoad: () => {
    throw redirect({ to: '/protocols/grpc' });
  },
});
const httpCompatibilityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/http',
  beforeLoad: () => {
    throw redirect({ to: '/protocols/http' });
  },
});
const routesCompatibilityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/routes',
  beforeLoad: () => {
    throw redirect({ to: '/network/route' });
  },
});
const downloadsCompatibilityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/downloads',
  beforeLoad: () => {
    throw redirect({ to: '/downloader' });
  },
});

const networkRouteTree = networkRoute.addChildren([
  networkIndexRoute,
  networkPathRoute,
  networkLocalRoute,
  networkMapRoute,
  networkHistoryRoute,
]);

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  protocolsRoute,
  grpcRoute,
  httpRoute,
  eventsRoute,
  capnpRoute,
  packetsRoute,
  portScannerRoute,
  nmapScannerRoute,
  diagnosticsRoute,
  tailnetRoute,
  thisPCRoute,
  tunnelsRoute,
  extensionsRoute,
  netBirdRoute,
  publishingRoute,
  downloaderRoute,
  localTransferRoute,
  routesRoute,
  securityRoute,
  settingsRoute,
  agentsRoute,
  updatesRoute,
  networkRouteTree,
  roadmapRoute,
  grpcCompatibilityRoute,
  httpCompatibilityRoute,
  routesCompatibilityRoute,
  downloadsCompatibilityRoute,
]);

export function createProtoPeekRouter(history = createHashHistory()) {
  return createRouter({
    routeTree,
    history,
    defaultPreload: 'intent',
    defaultPendingMs: 120,
    defaultPendingMinMs: 160,
    defaultPendingComponent: RoutePending,
    defaultErrorComponent: RouteError,
  });
}

export const router = createProtoPeekRouter();

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
