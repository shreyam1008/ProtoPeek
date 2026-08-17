import { describe, expect, it } from 'vitest';

import type { BootstrapResponse } from '@/shared/types';
import { initialConsoleSession, sessionReducer } from './session';

function bootstrap(
  launcherMode: boolean,
  services = launcherMode ? [] : [{ name: 'test.Service', description: '', methods: [] }]
): BootstrapResponse {
  return {
    appName: 'ProtoPeek',
    version: 'test',
    target: launcherMode ? 'Choose a gRPC target' : '127.0.0.1:50051',
    launcherMode,
    basePath: '/',
    docsURL: '',
    repoURL: '',
    learnURL: '',
    grpcWebURL: '',
    debuggingURL: '',
    authorName: '',
    authorURL: '',
    defaultMetadata: [],
    targetDefaults: {
      address: '',
      plaintext: true,
      insecure: false,
      authority: '',
      cacertPath: '',
      certPath: '',
      keyPath: '',
      schemaSource: 'reflection',
      protoFiles: [],
      importPaths: [],
      protosets: [],
    },
    grpcurlOptions: '-plaintext',
    services,
  };
}

describe('sessionReducer', () => {
  it('boots direct mode without creating a workspace session', () => {
    const direct = bootstrap(false);
    const state = sessionReducer(initialConsoleSession, {
      type: 'bootstrap.loaded',
      bootstrap: direct,
    });
    expect(state.mode).toBe('direct');
    expect(state.bootstrap).toBe(direct);
    expect(state.sessionId).toBe('');
  });

  it('marks a target active only after the latest connection succeeds', () => {
    const root = bootstrap(true);
    let state = sessionReducer(initialConsoleSession, {
      type: 'bootstrap.loaded',
      bootstrap: root,
    });
    state = sessionReducer(state, { type: 'connect.started', requestId: 1, targetId: 'first' });
    state = sessionReducer(state, { type: 'connect.started', requestId: 2, targetId: 'second' });
    state = sessionReducer(state, {
      type: 'connect.succeeded',
      requestId: 1,
      targetId: 'first',
      sessionId: 'stale-session',
      bootstrap: bootstrap(true, [{ name: 'stale.Service', description: '', methods: [] }]),
    });
    expect(state.activeTargetId).toBe('');
    state = sessionReducer(state, {
      type: 'connect.succeeded',
      requestId: 2,
      targetId: 'second',
      sessionId: 'current-session',
      bootstrap: bootstrap(true, [{ name: 'current.Service', description: '', methods: [] }]),
    });
    expect(state.mode).toBe('connected');
    expect(state.activeTargetId).toBe('second');
    expect(state.sessionId).toBe('current-session');
  });

  it('keeps a failed target inactive and returns to the launcher', () => {
    const root = bootstrap(true);
    let state = sessionReducer(initialConsoleSession, {
      type: 'bootstrap.loaded',
      bootstrap: root,
    });
    state = sessionReducer(state, { type: 'connect.started', requestId: 4, targetId: 'broken' });
    state = sessionReducer(state, {
      type: 'connect.failed',
      requestId: 4,
      message: 'connection refused',
    });
    expect(state.mode).toBe('launcher');
    expect(state.activeTargetId).toBe('');
    expect(state.error).toBe('connection refused');
  });

  it('ignores a second root bootstrap after startup', () => {
    const root = bootstrap(true);
    const direct = bootstrap(false);
    let state = sessionReducer(initialConsoleSession, {
      type: 'bootstrap.loaded',
      bootstrap: root,
    });
    state = sessionReducer(state, { type: 'bootstrap.loaded', bootstrap: direct });
    expect(state.rootBootstrap).toBe(root);
    expect(state.mode).toBe('launcher');
  });
});
