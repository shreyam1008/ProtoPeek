import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
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
  component: lazyRouteComponent(() => import('./HTTPWorkbench'), 'HTTPWorkbench'),
});
const routesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/routes',
  component: lazyRouteComponent(() => import('./RoutesWorkbench'), 'RoutesWorkbench'),
});
const roadmapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/roadmap',
  component: lazyRouteComponent(() => import('./Roadmap'), 'Roadmap'),
});

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  grpcRoute,
  httpRoute,
  routesRoute,
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
