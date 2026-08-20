import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';

import { App as GRPCWorkbench } from './App';
import { HTTPWorkbench } from './HTTPWorkbench';
import { ProtocolFrame } from './ProtocolFrame';

const rootRoute = createRootRoute({ component: ProtocolFrame });
const grpcRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: GRPCWorkbench,
});
const httpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/http',
  component: HTTPWorkbench,
});

const routeTree = rootRoute.addChildren([grpcRoute, httpRoute]);

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
