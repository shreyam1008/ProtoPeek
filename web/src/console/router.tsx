import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router';

import { Dashboard } from './Dashboard';
import { ProtocolFrame } from './ProtocolFrame';

const rootRoute = createRootRoute({ component: ProtocolFrame });
const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Dashboard,
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
const downloaderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/downloader',
  component: lazyRouteComponent(() => import('./Downloader'), 'Downloader'),
});
const thisPCRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/this-pc',
  component: lazyRouteComponent(() => import('./ThisPC'), 'ThisPC'),
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
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: lazyRouteComponent(() => import('./Settings'), 'Settings'),
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
    throw redirect({ to: '/network/path' });
  },
});
const networkLocalRoute = createRoute({
  getParentRoute: () => networkRoute,
  path: '/local',
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
  thisPCRoute,
  downloaderRoute,
  routesRoute,
  securityRoute,
  settingsRoute,
  networkRouteTree,
  roadmapRoute,
  grpcCompatibilityRoute,
  httpCompatibilityRoute,
  routesCompatibilityRoute,
  downloadsCompatibilityRoute,
]);

export function createProtoPeekRouter(history = createHashHistory()) {
  return createRouter({ routeTree, history, defaultPreload: 'intent' });
}

export const router = createProtoPeekRouter();

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
