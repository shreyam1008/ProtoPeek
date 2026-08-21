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
const grpcRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/grpc',
  component: lazyRouteComponent(() => import('./App'), 'App'),
});
const httpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/http',
  component: lazyRouteComponent(() => import('./HTTPRoute'), 'HTTPRoute'),
});
const routesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/routes',
  component: lazyRouteComponent(() => import('./RoutesWorkbench'), 'RoutesWorkbench'),
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

const networkRouteTree = networkRoute.addChildren([
  networkIndexRoute,
  networkPathRoute,
  networkLocalRoute,
  networkMapRoute,
  networkHistoryRoute,
]);

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  grpcRoute,
  httpRoute,
  routesRoute,
  networkRouteTree,
  roadmapRoute,
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
