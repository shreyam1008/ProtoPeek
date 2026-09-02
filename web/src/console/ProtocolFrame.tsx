import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import {
  CircleHelp,
  Cloud,
  Download,
  Home,
  ListTodo,
  Menu,
  Monitor,
  Moon,
  Network,
  Radar,
  Search,
  Server,
  Settings as SettingsIcon,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appStorageKeys, loadStoredValue, modifierKeyLabel, storeValue } from '@/shared/runtime';
import {
  type AppearancePreference,
  applyAppearance,
  persistAppearancePreference,
  readAppearancePreference,
  resolveAppearance,
} from '@/shared/theme';

import type { ScanResult } from './api';
import {
  commandDestinationFeatures,
  currentPrimaryNavigation,
  currentSecondaryNavigation,
} from './app/feature-registry';
import { CommandPalette, type PaletteAction } from './CommandPalette';
import { scanResultHTTPURL } from './discovery-url';
import {
  applyInterfacePreferences,
  type InterfacePreferences,
  persistInterfacePreferences,
  readInterfacePreferences,
} from './interface-preferences';
import {
  ProtocolShellContext,
  protocolShellEvents,
  type RecentDiscovery,
  type ScanDialogRequest,
} from './ProtocolShellContext';
import { ProtoPeekMark } from './ProtoPeekMark';
import { normalizeRecentDiscoveries } from './recent-discovery';
import { useDialogFocus } from './use-dialog-focus';
import './unified-shell.css';

const ScanTargetDialog = lazy(async () => {
  const module = await import('./ScanTargetDialog');
  return { default: module.ScanTargetDialog };
});

const primaryNavigationIcons = {
  overview: Home,
  protocols: Server,
  network: Network,
  'this-pc': Monitor,
  tunnels: Cloud,
  downloader: Download,
  security: ShieldCheck,
  settings: SettingsIcon,
} as const;

const secondaryNavigationIcons = { roadmap: ListTodo } as const;

function systemPrefersDark() {
  if (typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function ProtocolFrame() {
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanRequest, setScanRequest] = useState<ScanDialogRequest>({});
  const [scanGeneration, setScanGeneration] = useState(0);
  const [appearance, setAppearanceState] = useState<AppearancePreference>(() =>
    readAppearancePreference()
  );
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);
  const [interfacePreferences, setInterfacePreferencesState] = useState<InterfacePreferences>(() =>
    readInterfacePreferences()
  );
  const [discoveries, setDiscoveries] = useState<RecentDiscovery[]>(() =>
    normalizeRecentDiscoveries(loadStoredValue<unknown>(appStorageKeys.discoveries, []))
  );
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  const modifier = modifierKeyLabel();

  const resolvedAppearance = useMemo(
    () => resolveAppearance(appearance, prefersDark),
    [appearance, prefersDark]
  );

  const setAppearance = useCallback(
    (nextAppearance: AppearancePreference) => {
      setAppearanceState(nextAppearance);
      applyAppearance(nextAppearance, prefersDark, document.documentElement);
      persistAppearancePreference(nextAppearance);
    },
    [prefersDark]
  );

  const setInterfacePreferences = useCallback((preferences: InterfacePreferences) => {
    setInterfacePreferencesState(preferences);
    applyInterfacePreferences(preferences);
    persistInterfacePreferences(preferences);
  }, []);

  useEffect(() => {
    applyAppearance(appearance, prefersDark, document.documentElement);
  }, [appearance, prefersDark]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    let query: MediaQueryList;
    try {
      query = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const handleChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    setPrefersDark(query.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    applyInterfacePreferences(interfacePreferences);
  }, [interfacePreferences]);

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
      void navigate({ to: '/protocols/grpc' });
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
      void navigate({ to: '/protocols/http' });
    },
    [navigate]
  );

  const actions = useMemo<PaletteAction[]>(() => {
    const routeActions = commandDestinationFeatures.map((feature) => ({
      id: feature.id,
      label: feature.command.label,
      keywords: feature.command.keywords,
      run: () => void navigate({ to: feature.route }),
    }));
    return [
      ...routeActions.slice(0, 4),
      {
        id: 'scan',
        label: 'Probe or import discovery evidence',
        keywords: 'discover grpc http tcp nmap xml',
        run: () => openScan(),
      },
      ...routeActions.slice(4),
      {
        id: 'theme',
        label: `Switch to ${resolvedAppearance.theme === 'light' ? 'dark' : 'light'} mode`,
        keywords: 'appearance color mode',
        run: () =>
          setAppearance({
            ...appearance,
            mode: resolvedAppearance.theme === 'light' ? 'dark' : 'light',
          }),
      },
      {
        id: 'help',
        label: 'Open protocol checklist',
        keywords: 'help evidence transport',
        run: () => setHelpOpen(true),
      },
    ];
  }, [appearance, navigate, openScan, resolvedAppearance.theme, setAppearance]);

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
      appearance,
      resolvedAppearance,
      setAppearance,
      interfacePreferences,
      setInterfacePreferences,
      discoveries,
      openScan,
      openGRPCDiscovery,
      openHTTPDiscovery,
    }),
    [
      discoveries,
      interfacePreferences,
      openGRPCDiscovery,
      openHTTPDiscovery,
      openScan,
      setInterfacePreferences,
      appearance,
      resolvedAppearance,
      setAppearance,
    ]
  );

  return (
    <ProtocolShellContext.Provider value={contextValue}>
      <div className="pp-protocol-frame">
        <aside className="pp-suite-rail">
          <Link
            to="/"
            className="pp-suite-mark"
            aria-label="Open ProtoPeek overview"
            activeOptions={{ exact: true }}
          >
            <ProtoPeekMark />
          </Link>
          <nav className="pp-suite-primary" aria-label="Primary">
            {currentPrimaryNavigation.map((item) => {
              const Icon = primaryNavigationIcons[item.id];
              return (
                <Link
                  key={item.id}
                  to={item.route}
                  className="pp-suite-nav-link"
                  activeOptions={item.route === '/' ? { exact: true } : undefined}
                  activeProps={{ className: 'is-active' }}
                  aria-label={`Open ${item.label}`}
                >
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="pp-suite-secondary">
            {currentSecondaryNavigation.map((item) => {
              const Icon = secondaryNavigationIcons[item.id];
              return (
                <Link
                  key={item.id}
                  to={item.route}
                  className="pp-suite-nav-link"
                  activeProps={{ className: 'is-active' }}
                  aria-label={`Open ${item.label}`}
                >
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
            <button
              type="button"
              className="pp-suite-nav-link"
              aria-label="Open ProtoPeek help"
              aria-expanded={helpOpen}
              onClick={() => setHelpOpen(true)}
            >
              <CircleHelp aria-hidden="true" />
              <span>Help</span>
            </button>
          </div>
        </aside>

        <div className="pp-protocol-column pp-suite-column">
          <header className="pp-global-header pp-suite-header">
            <button
              type="button"
              className="pp-suite-mobile-menu"
              aria-label="Open navigation menu"
              aria-controls="protopeek-mobile-navigation"
              aria-expanded={navigationOpen}
              onClick={() => setNavigationOpen(true)}
            >
              <Menu aria-hidden="true" />
            </button>
            <Link to="/" className="pp-global-brand">
              <span>ProtoPeek</span>
              <small>local developer workbench</small>
            </Link>
            <span className="pp-suite-local-state">
              <Monitor aria-hidden="true" /> Runs locally
            </span>
            <button type="button" className="pp-suite-scan-action" onClick={() => openScan()}>
              <Radar aria-hidden="true" /> <span>Inspect target</span>
            </button>
            <button
              type="button"
              className="pp-global-command"
              aria-label="Open global command menu"
              onClick={() => setCommandOpen(true)}
            >
              <Search aria-hidden="true" />
              <span>Jump to a protocol or command</span>
              <kbd>{modifier} K</kbd>
            </button>
            <button
              type="button"
              className="pp-theme-toggle"
              aria-label={`Use ${resolvedAppearance.theme === 'light' ? 'dark' : 'light'} mode`}
              onClick={() =>
                setAppearance({
                  ...appearance,
                  mode: resolvedAppearance.theme === 'light' ? 'dark' : 'light',
                })
              }
            >
              {resolvedAppearance.theme === 'light' ? (
                <Moon aria-hidden="true" />
              ) : (
                <Sun aria-hidden="true" />
              )}
            </button>
          </header>
          <main className="pp-protocol-surface pp-suite-surface">
            <Outlet />
          </main>
        </div>

        <MobileNavigationDrawer
          open={navigationOpen}
          onClose={() => setNavigationOpen(false)}
          onInspect={() => openScan()}
          onHelp={() => setHelpOpen(true)}
        />

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

function MobileNavigationDrawer({
  open,
  onClose,
  onInspect,
  onHelp,
}: {
  open: boolean;
  onClose: () => void;
  onInspect: () => void;
  onHelp: () => void;
}) {
  const drawerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  useDialogFocus(open, onClose, drawerRef, closeButtonRef);

  if (!open) return null;

  function closeThen(action: () => void) {
    onClose();
    action();
  }

  return (
    <div className="pp-suite-mobile-layer">
      <button
        type="button"
        className="pp-suite-mobile-backdrop"
        aria-label="Close navigation menu"
        onClick={onClose}
      />
      <aside
        id="protopeek-mobile-navigation"
        ref={drawerRef}
        className="pp-suite-mobile-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="protopeek-mobile-navigation-title"
      >
        <header>
          <div>
            <ProtoPeekMark />
            <span className="pp-suite-mobile-brand-copy">
              <strong id="protopeek-mobile-navigation-title">ProtoPeek</strong>
              <small>Local developer workbench</small>
            </span>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="pp-suite-mobile-close"
            aria-label="Close navigation menu"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>
        <nav aria-label="Mobile primary">
          {currentPrimaryNavigation.map((item) => {
            const Icon = primaryNavigationIcons[item.id];
            return (
              <Link
                key={item.id}
                to={item.route}
                className="pp-suite-mobile-link pp-suite-mobile-primary-link"
                activeOptions={item.route === '/' ? { exact: true } : undefined}
                activeProps={{ className: 'is-active' }}
                onClick={onClose}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="pp-suite-mobile-actions">
          <button
            type="button"
            className="pp-suite-mobile-link"
            onClick={() => closeThen(onInspect)}
          >
            <Radar aria-hidden="true" /> Inspect target
          </button>
          {currentSecondaryNavigation.map((item) => {
            const Icon = secondaryNavigationIcons[item.id];
            return (
              <Link
                key={item.id}
                to={item.route}
                className="pp-suite-mobile-link"
                onClick={onClose}
              >
                <Icon aria-hidden="true" /> {item.label}
              </Link>
            );
          })}
          <button type="button" className="pp-suite-mobile-link" onClick={() => closeThen(onHelp)}>
            <CircleHelp aria-hidden="true" /> Help
          </button>
        </div>
        <footer>
          <Monitor aria-hidden="true" /> Local app · no account or cloud sync
        </footer>
      </aside>
    </div>
  );
}

function HelpDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const drawerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  useDialogFocus(open, onClose, drawerRef, closeButtonRef);

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
        <section>
          <h3>Network · available with explicit boundaries</h3>
          <ul>
            <li>
              Linux Network Path separates DNS, kernel route, and active per-hop RTT evidence.
            </li>
            <li>Local discovery scans only an authorized private IPv4 /24-or-smaller plan.</li>
            <li>
              Maps and immutable snapshots stay browser-local and export as JSON, GraphML, or CSV.
            </li>
            <li>
              ProtoPeek imports selected Nmap XML offline; it never installs or executes Nmap.
            </li>
          </ul>
        </section>
      </aside>
    </div>
  );
}
