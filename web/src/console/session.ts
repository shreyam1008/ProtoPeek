import type { BootstrapResponse } from '@/shared/types';

export type ConsoleMode = 'booting' | 'launcher' | 'direct' | 'connected';

export type ConsoleSessionState = {
  mode: ConsoleMode;
  rootBootstrap: BootstrapResponse | null;
  bootstrap: BootstrapResponse | null;
  connectStatus: 'idle' | 'connecting';
  requestId: number;
  pendingTargetId: string;
  activeTargetId: string;
  sessionId: string;
  error: string | null;
};

export type ConsoleSessionAction =
  | { type: 'bootstrap.loaded'; bootstrap: BootstrapResponse }
  | { type: 'connect.started'; requestId: number; targetId: string }
  | {
      type: 'connect.succeeded';
      requestId: number;
      targetId: string;
      sessionId: string;
      bootstrap: BootstrapResponse;
    }
  | { type: 'connect.failed'; requestId: number; message: string }
  | { type: 'connect.cancelled'; requestId: number }
  | { type: 'connection.cleared' }
  | { type: 'error.cleared' };

export const initialConsoleSession: ConsoleSessionState = {
  mode: 'booting',
  rootBootstrap: null,
  bootstrap: null,
  connectStatus: 'idle',
  requestId: 0,
  pendingTargetId: '',
  activeTargetId: '',
  sessionId: '',
  error: null,
};

export function sessionReducer(
  state: ConsoleSessionState,
  action: ConsoleSessionAction
): ConsoleSessionState {
  switch (action.type) {
    case 'bootstrap.loaded':
      if (state.rootBootstrap) return state;
      return {
        ...state,
        mode: action.bootstrap.launcherMode ? 'launcher' : 'direct',
        rootBootstrap: action.bootstrap,
        bootstrap: action.bootstrap,
      };
    case 'connect.started':
      return {
        ...state,
        connectStatus: 'connecting',
        requestId: action.requestId,
        pendingTargetId: action.targetId,
        error: null,
      };
    case 'connect.succeeded':
      if (action.requestId !== state.requestId) return state;
      return {
        ...state,
        mode: 'connected',
        bootstrap: action.bootstrap,
        connectStatus: 'idle',
        pendingTargetId: '',
        activeTargetId: action.targetId,
        sessionId: action.sessionId,
        error: null,
      };
    case 'connect.failed':
      if (action.requestId !== state.requestId) return state;
      return {
        ...state,
        mode: state.sessionId ? 'connected' : 'launcher',
        connectStatus: 'idle',
        pendingTargetId: '',
        error: action.message,
      };
    case 'connect.cancelled':
      if (action.requestId !== state.requestId) return state;
      return {
        ...state,
        connectStatus: 'idle',
        pendingTargetId: '',
      };
    case 'connection.cleared':
      return {
        ...state,
        mode: state.rootBootstrap?.launcherMode ? 'launcher' : state.mode,
        bootstrap: state.rootBootstrap,
        connectStatus: 'idle',
        pendingTargetId: '',
        activeTargetId: '',
        sessionId: '',
        error: null,
      };
    case 'error.cleared':
      return { ...state, error: null };
  }
}
