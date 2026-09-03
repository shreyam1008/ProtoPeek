import { Outlet, useNavigate } from '@tanstack/react-router';
import { X } from 'lucide-react';
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
import { commandDestinationFeatures, destinations } from './app/feature-registry';
import { storePendingHandoff } from './app/handoff-store';
import type { HandoffProvenance, PendingHandoffInput } from './app/handoff-types';
import { handoffDestinationRoutes } from './app/release-capabilities';
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
import { normalizeRecentDiscoveries } from './recent-discovery';
import { DesktopShell } from './shell/DesktopShell';
import { useDialogFocus } from './use-dialog-focus';
import './shell/shell.css';

const ScanTargetDialog = lazy(async () => {
  const module = await import('./ScanTargetDialog');
  return { default: module.ScanTargetDialog };
});

function systemPrefersDark() {
  if (typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function discoveryProvenance(result: ScanResult): HandoffProvenance {
  const cloudflareIngress = result.details?.some((detail) =>
    detail.toLowerCase().includes('cloudflared ingress route')
  );
  const discoveredAt =
    'discoveredAt' in result && typeof result.discoveredAt === 'string'
      ? Date.parse(result.discoveredAt)
      : Number.NaN;
  return {
    source: cloudflareIngress ? 'cloudflare-config' : 'bounded-discovery',
    quality: 'observed',
    observedAt: new Date(Number.isFinite(discoveredAt) ? discoveredAt : Date.now()).toISOString(),
  };
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
    setCommandOpen(false);
    setHelpOpen(false);
    setNavigationOpen(false);
    setScanRequest(request);
    setScanGeneration((generation) => generation + 1);
    setScanOpen(true);
  }, []);

  const openCommand = useCallback(() => {
    setHelpOpen(false);
    setNavigationOpen(false);
    setScanOpen(false);
    setCommandOpen(true);
  }, []);

  const openHelp = useCallback(() => {
    setCommandOpen(false);
    setNavigationOpen(false);
    setScanOpen(false);
    setHelpOpen(true);
  }, []);

  const openNavigation = useCallback(() => {
    setCommandOpen(false);
    setHelpOpen(false);
    setScanOpen(false);
    setNavigationOpen(true);
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

  const openHandoff = useCallback(
    (handoff: PendingHandoffInput) => {
      const stored = storePendingHandoff(handoff);
      if (!stored.ok) return stored;
      const route = handoffDestinationRoutes[stored.value.draft.kind];
      setScanOpen(false);
      window.dispatchEvent(new Event(protocolShellEvents.pendingHandoff));
      void navigate({ to: route });
      return stored;
    },
    [navigate]
  );

  const openGRPCDiscovery = useCallback(
    (result: ScanResult) => {
      return openHandoff({
        provenance: discoveryProvenance(result),
        draft: {
          kind: 'grpc-target-draft',
          target: {
            kind: 'grpc-target',
            address: result.address,
            plaintext: result.transport !== 'tls',
          },
        },
      });
    },
    [openHandoff]
  );

  const openHTTPDiscovery = useCallback(
    (result: ScanResult) => {
      const url = scanResultHTTPURL(result);
      return openHandoff({
        provenance: discoveryProvenance(result),
        draft: { kind: 'http-url-draft', target: { kind: 'http-url', url } },
      });
    },
    [openHandoff]
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
        run: openHelp,
      },
    ];
  }, [appearance, navigate, openHelp, openScan, resolvedAppearance.theme, setAppearance]);

  useEffect(() => {
    function handleGlobalShortcut(event: KeyboardEvent) {
      if ((!event.metaKey && !event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setHelpOpen(false);
      setNavigationOpen(false);
      setScanOpen(false);
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
      openHandoff,
      openGRPCDiscovery,
      openHTTPDiscovery,
    }),
    [
      discoveries,
      interfacePreferences,
      openGRPCDiscovery,
      openHandoff,
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
      <DesktopShell
        destinations={destinations}
        modifier={modifier}
        resolvedTheme={resolvedAppearance.theme}
        navigationOpen={navigationOpen}
        onInspect={() => openScan()}
        onOpenNavigation={openNavigation}
        onCloseNavigation={() => setNavigationOpen(false)}
        onOpenCommand={openCommand}
        onToggleTheme={() =>
          setAppearance({
            ...appearance,
            mode: resolvedAppearance.theme === 'light' ? 'dark' : 'light',
          })
        }
      >
        <Outlet />
      </DesktopShell>

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
      <CommandPalette open={commandOpen} actions={actions} onClose={() => setCommandOpen(false)} />
      <HelpDrawer open={helpOpen} onClose={closeHelp} />
    </ProtocolShellContext.Provider>
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
