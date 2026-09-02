import { describe, expect, it } from 'vitest';

import {
  closeSession,
  emptySessionState,
  maximumSessionReferences,
  type SessionState,
  sessionReferenceForPath,
  setSessionProtection,
  visitSession,
} from './shell-state';

function visit(state: SessionState, route: string) {
  return visitSession(state, sessionReferenceForPath(route));
}

describe('workbench session state', () => {
  it('keeps Home out of the session strip and canonicalizes compatibility routes', () => {
    expect(sessionReferenceForPath('/')).toBeNull();
    expect(sessionReferenceForPath('/grpc')).toMatchObject({
      id: 'inspect:/protocols/grpc',
      route: '/protocols/grpc',
      label: 'gRPC',
    });
    expect(sessionReferenceForPath('/downloads/')).toMatchObject({
      id: 'files:/downloader',
      route: '/downloader',
    });
    expect(sessionReferenceForPath('/not-a-route')).toBeNull();
  });

  it('deduplicates a route reference and updates deterministic focus recency', () => {
    let state = visit(emptySessionState, '/protocols/grpc');
    state = visit(state, '/protocols/http');
    state = visit(state, '/protocols/grpc');

    expect(state.references).toHaveLength(2);
    expect(state.activeId).toBe('inspect:/protocols/grpc');
    expect(state.focusSequence).toBe(3);
    expect(state.references.find(({ id }) => id === state.activeId)?.lastFocused).toBe(3);
  });

  it('keeps references but clears the selected session when Home is visited', () => {
    const routeState = visit(emptySessionState, '/protocols/http');
    const homeState = visit(routeState, '/');

    expect(homeState.references).toEqual(routeState.references);
    expect(homeState.activeId).toBeNull();
  });

  it('keeps at most eight references and replaces the least recently focused safe one', () => {
    const routes = [
      '/protocols',
      '/protocols/grpc',
      '/protocols/http',
      '/network/route',
      '/network/path',
      '/network/local',
      '/network/map',
      '/network/history',
    ];
    let state = routes.reduce(visit, emptySessionState);
    state = visit(state, '/protocols');
    state = visit(state, '/this-pc');

    expect(state.references).toHaveLength(maximumSessionReferences);
    expect(state.references.some(({ route }) => route === '/protocols/grpc')).toBe(false);
    expect(state.references.some(({ route }) => route === '/protocols')).toBe(true);
    expect(state.references.some(({ route }) => route === '/this-pc')).toBe(true);
  });

  it('never replaces the active reference even when its recency is the oldest', () => {
    const routes = [
      '/protocols',
      '/protocols/grpc',
      '/protocols/http',
      '/network/route',
      '/network/path',
      '/network/local',
      '/network/map',
      '/network/history',
    ];
    const full = routes.reduce(visit, emptySessionState);
    const oldestActive = { ...full, activeId: full.references[0].id };
    const overflow = visit(oldestActive, '/this-pc');

    expect(overflow.references.some(({ route }) => route === '/protocols')).toBe(true);
    expect(overflow.references.some(({ route }) => route === '/protocols/grpc')).toBe(false);
  });

  it('does not replace or close guarded references', () => {
    const routes = [
      '/protocols',
      '/protocols/grpc',
      '/protocols/http',
      '/network/route',
      '/network/path',
      '/network/local',
      '/network/map',
      '/network/history',
    ];
    let state = routes.reduce(visit, emptySessionState);
    for (const [index, reference] of state.references.entries()) {
      if (reference.id === state.activeId) continue;
      state = setSessionProtection(state, reference.id, {
        dirty: index % 2 === 0,
        running: index % 2 === 1,
      });
    }

    const guarded = state.references[0];
    const refusedClose = closeSession(state, guarded.id);
    expect(refusedClose.closed).toBe(false);
    expect(refusedClose.state.announcement).toContain('unsaved changes');

    const overflow = visit(state, '/this-pc');
    expect(overflow.references).toEqual(state.references);
    expect(overflow.activeId).toBeNull();
    expect(overflow.announcement).toContain('every inactive reference is guarded');
  });

  it('closes inactive references without navigation and selects left, right, then Home', () => {
    let state = visit(emptySessionState, '/protocols/grpc');
    state = visit(state, '/protocols/http');
    state = visit(state, '/network/path');

    const inactive = closeSession(state, 'inspect:/protocols/http');
    expect(inactive.closed).toBe(true);
    expect(inactive.nextRoute).toBeNull();
    expect(inactive.state.activeId).toBe('network:/network/path');

    const left = closeSession(inactive.state, 'network:/network/path');
    expect(left.nextRoute).toBe('/protocols/grpc');
    expect(left.state.activeId).toBe('inspect:/protocols/grpc');

    const home = closeSession(left.state, 'inspect:/protocols/grpc');
    expect(home.nextRoute).toBe('/');
    expect(home.state.references).toEqual([]);
    expect(home.state.activeId).toBeNull();

    let first = visit(emptySessionState, '/protocols/grpc');
    first = visit(first, '/protocols/http');
    first = visit(first, '/protocols/grpc');
    const right = closeSession(first, 'inspect:/protocols/grpc');
    expect(right.nextRoute).toBe('/protocols/http');
  });
});
