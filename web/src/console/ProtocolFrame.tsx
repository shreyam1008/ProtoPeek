import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { CircleHelp, Home, ListTodo, Moon, Radar, Route, Server, Sun, X } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appStorageKeys, loadStoredValue, modifierKeyLabel, storeValue } from '@/shared/runtime';
import {
  applyTheme,
  type ProtoPeekTheme,
  persistThemePreference,
  readThemePreference,
} from '@/shared/theme';

import type { ScanResult } from './api';
import { CommandPalette, type PaletteAction } from './CommandPalette';
import { scanResultHTTPURL } from './discovery-url';
import {
  ProtocolShellContext,
  protocolShellEvents,
  type RecentDiscovery,
  type ScanDialogRequest,
} from './ProtocolShellContext';
import { ProtoPeekMark } from './ProtoPeekMark';

const ScanTargetDialog = lazy(async () => {
  const module = await import('./ScanTargetDialog');
  return { default: module.ScanTargetDialog };
});

export function ProtocolFrame() {
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanRequest, setScanRequest] = useState<ScanDialogRequest>({});
  const [scanGeneration, setScanGeneration] = useState(0);
  const [theme, setThemeState] = useState<ProtoPeekTheme>(() => readThemePreference());
  const [discoveries, setDiscoveries] = useState<RecentDiscovery[]>(() =>
    loadStoredValue<RecentDiscovery[]>(appStorageKeys.discoveries, []).slice(0, 12)
  );
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  const modifier = modifierKeyLabel();

  const setTheme = useCallback((nextTheme: ProtoPeekTheme) => {
    setThemeState(nextTheme);
    applyTheme(nextTheme, document.documentElement);
    persistThemePreference(nextTheme);
  }, []);

  useEffect(() => {
    applyTheme(theme, document.documentElement);
  }, [theme]);

  useEffect(() => {
    storeValue(appStorageKeys.discoveries, discoveries);
  }, [discoveries]);

  const openScan = useCallback((request: ScanDialogRequest = {}) => {
    setScanRequest(request);
    setScanGeneration((generation) => generation + 1);
    setScanOpen(true);
  }, []);

  const recordResults = useCallback((results: ScanResult[]) => {
    const detected = results.filter((result) => result.alive);
    if (!detected.length) return;
    const discoveredAt = new Date().toISOString();
    setDiscoveries((current) => {
      const next = detected.map((result) => ({ ...result, discoveredAt }));
      const addresses = new Set(next.map((result) => result.address));
      return [...next, ...current.filter((result) => !addresses.has(result.address))].slice(0, 12);
    });
  }, []);

  const openGRPCDiscovery = useCallback(
    (result: ScanResult) => {
      storeValue(appStorageKeys.pendingGRPCTarget, {
        address: result.address,
        plaintext: result.transport !== 'tls',
      });
      window.dispatchEvent(
        new CustomEvent<ScanResult>(protocolShellEvents.openGRPCDiscovery, { detail: result })
      );
      setScanOpen(false);
      void navigate({ to: '/grpc' });
    },
    [navigate]
  );

  const openHTTPDiscovery = useCallback(
    (result: ScanResult) => {
      const url = scanResultHTTPURL(result);
      storeValue(appStorageKeys.pendingHTTPURL, url);
      window.dispatchEvent(
        new CustomEvent<string>(protocolShellEvents.openHTTPDiscovery, { detail: url })
      );
      setScanOpen(false);
      void navigate({ to: '/http' });
    },
    [navigate]
  );

  const actions = useMemo<PaletteAction[]>(
    () => [
      {
        id: 'home',
        label: 'Open Protocol Peek dashboard',
        keywords: 'home protocols',
        run: () => void navigate({ to: '/' }),
      },
      {
        id: 'grpc',
        label: 'Open gRPC workbench',
        keywords: 'reflection proto protoset streams trailers',
        run: () => void navigate({ to: '/grpc' }),
      },
      {
        id: 'http',
        label: 'Open HTTP workbench',
        keywords: 'rest request response headers tls',
        run: () => void navigate({ to: '/http' }),
      },
      {
        id: 'scan',
        label: 'Probe or import discovery evidence',
        keywords: 'discover grpc http tcp nmap xml',
        run: () => openScan(),
      },
      {
        id: 'routes',
        label: 'Open next-hop route evidence',
        keywords: 'route kernel next hop interface source',
        run: () => void navigate({ to: '/routes' }),
      },
      {
        id: 'roadmap',
        label: 'Open product roadmap',
        keywords: 'available next exploring gated',
        run: () => void navigate({ to: '/roadmap' }),
      },
      {
        id: 'theme',
        label: `Switch to ${theme === 'light' ? 'dark' : 'light'} theme`,
        keywords: 'appearance color mode',
        run: () => setTheme(theme === 'light' ? 'dark' : 'light'),
      },
      {
        id: 'help',
        label: 'Open protocol checklist',
        keywords: 'help evidence transport',
        run: () => setHelpOpen(true),
      },
    ],
    [navigate, openScan, setTheme, theme]
  );

  useEffect(() => {
    function handleGlobalShortcut(event: KeyboardEvent) {
      if ((!event.metaKey && !event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setCommandOpen((open) => !open);
    }
    window.addEventListener('keydown', handleGlobalShortcut, true);
    return () => window.removeEventListener('keydown', handleGlobalShortcut, true);
  }, []);

  const contextValue = useMemo(
    () => ({
      theme,
      setTheme,
      discoveries,
      openScan,
      openGRPCDiscovery,
      openHTTPDiscovery,
    }),
    [discoveries, openGRPCDiscovery, openHTTPDiscovery, openScan, setTheme, theme]
  );

  return (
    <ProtocolShellContext.Provider value={contextValue}>
      <div className="pp-protocol-frame">
        <nav className="pp-protocol-rail" aria-label="Protocol activity">
          <Link
            to="/"
            className="pp-protocol-mark"
            aria-label="Open Protocol Peek dashboard"
            activeOptions={{ exact: true }}
          >
            <ProtoPeekMark />
          </Link>
          <span className="pp-rail-label">Protocol</span>
          <Link
            to="/"
            activeOptions={{ exact: true }}
            activeProps={{ className: 'is-active' }}
            aria-label="Open dashboard"
          >
            <Home aria-hidden="true" />
            <span>Home</span>
          </Link>
          <Link
            to="/grpc"
            activeProps={{ className: 'is-active' }}
            aria-label="Open the gRPC workbench"
          >
            <Server aria-hidden="true" />
            <span>gRPC</span>
          </Link>
          <Link
            to="/http"
            activeProps={{ className: 'is-active' }}
            aria-label="Open the HTTP workbench"
          >
            <i className="pp-protocol-glyph" aria-hidden="true">
              H
            </i>
            <span>HTTP</span>
          </Link>
          <button type="button" className="pp-rail-scan" onClick={() => openScan()}>
            <Radar aria-hidden="true" />
            <span>Scan</span>
          </button>
          <span className="pp-rail-divider" aria-hidden="true" />
          <Link
            to="/routes"
            activeProps={{ className: 'is-active' }}
            aria-label="Open next-hop route evidence"
          >
            <Route aria-hidden="true" />
            <span>Routes</span>
          </Link>
          <Link
            to="/roadmap"
            activeProps={{ className: 'is-active' }}
            aria-label="Open product roadmap"
          >
            <ListTodo aria-hidden="true" />
            <span>Roadmap</span>
          </Link>
          <button
            type="button"
            className="pp-rail-help"
            aria-label="Open ProtoPeek help"
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen(true)}
          >
            <CircleHelp aria-hidden="true" />
            <span>Help</span>
          </button>
        </nav>

        <div className="pp-protocol-column">
          <header className="pp-global-header">
            <Link to="/" className="pp-global-brand">
              <span>ProtoPeek</span>
              <small>local protocol console</small>
            </Link>
            <span className="pp-global-local">
              <i aria-hidden="true" /> Local session
            </span>
            <button
              type="button"
              className="pp-global-command"
              aria-label="Open global command menu"
              onClick={() => setCommandOpen(true)}
            >
              <span>Jump to a protocol or command</span>
              <kbd>{modifier} K</kbd>
            </button>
            <button
              type="button"
              className="pp-theme-toggle"
              aria-label={`Use ${theme === 'light' ? 'dark' : 'light'} theme`}
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            >
              {theme === 'light' ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
            </button>
          </header>
          <main className="pp-protocol-surface">
            <Outlet />
          </main>
        </div>

        {scanOpen ? (
          <Suspense
            fallback={
              <div className="pp-scan-dialog-layer">
                <div className="pp-scan-dialog-backdrop" aria-hidden="true" />
                <div className="pp-scan-dialog pp-scan-dialog-loading" role="status">
                  Opening scan tools…
                </div>
              </div>
            }
          >
            <ScanTargetDialog
              key={scanGeneration}
              open
              initialTarget={scanRequest.initialTarget}
              autoStart={scanRequest.autoStart}
              onClose={() => setScanOpen(false)}
              onResults={recordResults}
              onOpenGRPC={openGRPCDiscovery}
              onOpenHTTP={openHTTPDiscovery}
            />
          </Suspense>
        ) : null}
        <CommandPalette
          open={commandOpen}
          actions={actions}
          onClose={() => setCommandOpen(false)}
        />
        <HelpDrawer open={helpOpen} onClose={closeHelp} />
      </div>
    </ProtocolShellContext.Provider>
  );
}

function HelpDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const drawerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => closeButtonRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="pp-help-layer">
      <button
        type="button"
        className="pp-help-backdrop"
        aria-label="Close help"
        onClick={onClose}
      />
      <aside
        ref={drawerRef}
        className="pp-help-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="protopeek-help-title"
      >
        <header>
          <div>
            <span>Protocol checklist</span>
            <h2 id="protopeek-help-title">Debug what is actually on the wire.</h2>
          </div>
          <button ref={closeButtonRef} type="button" aria-label="Close help" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <section>
          <h3>gRPC · available</h3>
          <ul>
            <li>Confirm plaintext versus verified TLS before invoking.</li>
            <li>Use reflection, a browser folder, or host proto/protoset paths for the schema.</li>
            <li>Inspect response headers, messages, trailers, and final status separately.</li>
          </ul>
        </section>
        <section>
          <h3>HTTP · available</h3>
          <ul>
            <li>Redirects are off and certificate verification is on by default.</li>
            <li>Inspect negotiated protocol, remote peer, timing phases, and truncation.</li>
            <li>Auth values remain in the live editor and are redacted from local history.</li>
          </ul>
        </section>
        <section className="pp-help-planned">
          <h3>Routes + external evidence</h3>
          <p>
            Next-hop lookup reads one kernel-selected route and is not traceroute. Nmap XML import
            is offline and treats service names as hints; ProtoPeek never installs or executes Nmap.
            Bundled Nmap execution is not planned for the core binary. Traceroute, LAN expansion,
            and live capture remain gated.
          </p>
        </section>
      </aside>
    </div>
  );
}
