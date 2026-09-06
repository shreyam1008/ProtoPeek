import { type DestinationId, type FeatureRoute, featureForPath } from '../app/feature-registry';

export const maximumSessionReferences = 8;

export type SessionReference = {
  id: string;
  destination: DestinationId;
  route: FeatureRoute;
  label: string;
  lastFocused: number;
  dirty: boolean;
  running: boolean;
};

export type SessionState = {
  references: readonly SessionReference[];
  activeId: string | null;
  focusSequence: number;
  announcement: string;
};

export const emptySessionState: SessionState = {
  references: [],
  activeId: null,
  focusSequence: 0,
  announcement: '',
};

export function sessionReferenceForPath(
  pathname: string
): Omit<SessionReference, 'lastFocused' | 'dirty' | 'running'> | null {
  // The Network index redirects to Path. Keep the transition from opening a
  // second, empty session reference before the router resolves that redirect.
  const feature = featureForPath(/^\/network\/?$/.test(pathname) ? '/network/path' : pathname);
  if (!feature || feature.route === '/') return null;
  return {
    id: `${feature.destination}:${feature.route}`,
    destination: feature.destination,
    route: feature.route,
    label: feature.label,
  };
}

export function visitSession(
  state: SessionState,
  next: ReturnType<typeof sessionReferenceForPath>
): SessionState {
  if (!next) {
    if (state.activeId === null && !state.announcement) return state;
    return { ...state, activeId: null, announcement: '' };
  }

  const focusSequence = state.focusSequence + 1;
  const existingIndex = state.references.findIndex((reference) => reference.id === next.id);
  if (existingIndex >= 0) {
    return {
      references: state.references.map((reference, index) =>
        index === existingIndex ? { ...reference, ...next, lastFocused: focusSequence } : reference
      ),
      activeId: next.id,
      focusSequence,
      announcement: '',
    };
  }

  const reference: SessionReference = {
    ...next,
    lastFocused: focusSequence,
    dirty: false,
    running: false,
  };
  if (state.references.length < maximumSessionReferences) {
    return {
      references: [...state.references, reference],
      activeId: reference.id,
      focusSequence,
      announcement: '',
    };
  }

  const replaceable = state.references
    .map((candidate, index) => ({ candidate, index }))
    .filter(
      ({ candidate }) => candidate.id !== state.activeId && !candidate.dirty && !candidate.running
    )
    .sort(
      (left, right) =>
        left.candidate.lastFocused - right.candidate.lastFocused || left.index - right.index
    )[0];
  if (!replaceable) {
    return {
      ...state,
      activeId: null,
      focusSequence,
      announcement:
        'The route opened, but its session was not added because every inactive reference is guarded.',
    };
  }

  return {
    references: state.references.map((candidate, index) =>
      index === replaceable.index ? reference : candidate
    ),
    activeId: reference.id,
    focusSequence,
    announcement: '',
  };
}

export function setSessionProtection(
  state: SessionState,
  id: string,
  protection: { dirty?: boolean; running?: boolean }
): SessionState {
  if (!state.references.some((reference) => reference.id === id)) return state;
  return {
    ...state,
    references: state.references.map((reference) =>
      reference.id === id ? { ...reference, ...protection } : reference
    ),
  };
}

export type CloseSessionResult = {
  state: SessionState;
  nextRoute: FeatureRoute | null;
  closed: boolean;
};

export function closeSession(state: SessionState, id: string): CloseSessionResult {
  const index = state.references.findIndex((reference) => reference.id === id);
  if (index < 0) return { state, nextRoute: null, closed: false };
  const reference = state.references[index];
  if (reference.dirty || reference.running) {
    const reason = reference.dirty ? 'unsaved changes' : 'a running operation';
    return {
      state: {
        ...state,
        announcement: `${reference.label} stays open because it has ${reason}.`,
      },
      nextRoute: null,
      closed: false,
    };
  }

  const references = state.references.filter((candidate) => candidate.id !== id);
  if (state.activeId !== id) {
    return {
      state: { ...state, references, announcement: '' },
      nextRoute: null,
      closed: true,
    };
  }

  const next = state.references[index - 1] ?? state.references[index + 1] ?? null;
  return {
    state: {
      ...state,
      references,
      activeId: next?.id ?? null,
      announcement: '',
    },
    nextRoute: next?.route ?? '/',
    closed: true,
  };
}
