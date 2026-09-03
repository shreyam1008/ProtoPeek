import { useLocation, useNavigate, useRouterState } from '@tanstack/react-router';
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';

import type { DestinationDefinition, FeatureRoute } from '../app/feature-registry';
import { destinationForPath } from '../app/feature-registry';
import { AppBar } from './AppBar';
import { SessionTabs } from './SessionTabs';
import { StatusRail } from './StatusRail';
import {
  closeSession,
  emptySessionState,
  sessionReferenceForPath,
  visitSession,
} from './shell-state';

export type DesktopShellProps = {
  children: ReactNode;
  destinations: readonly DestinationDefinition[];
  modifier: string;
  resolvedTheme: 'light' | 'dark';
  navigationOpen: boolean;
  skipRouteFocusRef: RefObject<FeatureRoute | null>;
  onInspect: () => void;
  onOpenNavigation: () => void;
  onCloseNavigation: () => void;
  onOpenCommand: () => void;
  onToggleTheme: () => void;
};

export function DesktopShell({
  children,
  destinations,
  modifier,
  resolvedTheme,
  navigationOpen,
  skipRouteFocusRef,
  onInspect,
  onOpenNavigation,
  onCloseNavigation,
  onOpenCommand,
  onToggleTheme,
}: DesktopShellProps) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const routeLoading = useRouterState({ select: (state) => state.isLoading });
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLElement | null>(null);
  const previousPathRef = useRef(pathname);
  const sessionPathRef = useRef(pathname);
  const [sessions, setSessions] = useState(() =>
    visitSession(emptySessionState, sessionReferenceForPath(pathname))
  );
  const currentReference = sessionReferenceForPath(pathname);
  const activeDestination = destinationForPath(pathname);
  const currentLabel = currentReference?.label ?? activeDestination?.label ?? 'Home';

  useEffect(() => {
    if (sessionPathRef.current === pathname) return;
    sessionPathRef.current = pathname;
    setSessions((current) => visitSession(current, sessionReferenceForPath(pathname)));
  }, [pathname]);

  // Route focus is intentionally one frame and one query only. It catches the resolved lazy route
  // without waiting on network-backed content or taking focus later in a user's interaction.
  useEffect(() => {
    if (routeLoading) return;
    if (previousPathRef.current === pathname) return;
    previousPathRef.current = pathname;
    if (skipRouteFocusRef.current === pathname) {
      skipRouteFocusRef.current = null;
      return;
    }
    skipRouteFocusRef.current = null;
    const frame = requestAnimationFrame(() => {
      const heading = canvasRef.current?.querySelector<HTMLElement>('h1');
      const focusTarget = heading ?? canvasRef.current;
      if (!focusTarget) return;
      focusTarget.tabIndex = -1;
      focusTarget.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, routeLoading, skipRouteFocusRef]);

  return (
    <div className="pp-workbench-shell">
      <AppBar
        destinations={destinations}
        activeDestinationId={activeDestination?.id}
        activeLabel={currentLabel}
        modifier={modifier}
        resolvedTheme={resolvedTheme}
        navigationOpen={navigationOpen}
        onOpenNavigation={onOpenNavigation}
        onCloseNavigation={onCloseNavigation}
        onInspect={onInspect}
        onOpenCommand={onOpenCommand}
        onToggleTheme={onToggleTheme}
      />
      <SessionTabs
        references={sessions.references}
        activeId={sessions.activeId}
        onActivate={(reference) => void navigate({ to: reference.route })}
        onClose={(reference) => {
          const result = closeSession(sessions, reference.id);
          setSessions(result.state);
          if (result.nextRoute) void navigate({ to: result.nextRoute });
        }}
      />
      <main
        id="pp-workbench-canvas"
        ref={canvasRef}
        className="pp-protocol-surface pp-workbench-canvas"
        tabIndex={-1}
        aria-label={`${currentLabel} workspace`}
      >
        {children}
      </main>
      <StatusRail currentLabel={currentLabel} />
      <span className="pp-shell-announcement" aria-live="polite">
        {sessions.announcement}
      </span>
    </div>
  );
}
