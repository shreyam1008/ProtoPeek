import { Outlet, useNavigate } from '@tanstack/react-router';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { appStorageKeys, loadStoredValue, modifierKeyLabel, storeValue } from '@/shared/runtime';
import {
  type AppearancePreference,
  applyAppearance,
  persistAppearancePreference,
  readAppearancePreference,
  resolveAppearance,
} from '@/shared/theme';

import type { ScanResult } from './api';
import { destinations } from './app/feature-registry';
import { clearPendingHandoff, storePendingHandoff } from './app/handoff-store';
import type { HandoffProvenance, PendingHandoffInput } from './app/handoff-types';
import { handoffDestinationRoutes } from './app/release-capabilities';
import type { PaletteAction } from './CommandPalette';
import { scanResultHTTPURL } from './discovery-url';
import { httpRecipeLoadEvent, queueHTTPRecipe } from './http-library-handoff';
import {
  applyInterfacePreferences,
  type InterfacePreferences,
  persistInterfacePreferences,
  readInterfacePreferences,
} from './interface-preferences';
import {
  createInitialScanClaim,
  ProtocolShellContext,
  protocolShellEvents,
  type RecentDiscovery,
  type ScanDialogRequest,
} from './ProtocolShellContext';
import { normalizeRecentDiscoveries } from './recent-discovery';
import { DesktopShell } from './shell/DesktopShell';
import './shell/shell.css';
import './shell/workbench-ui.css';

const ScanTargetDialog = lazy(async () => {
  const module = await import('./ScanTargetDialog');
  return { default: module.ScanTargetDialog };
});
const CommandPalette = lazy(() =>
  import('./CommandPalette').then((module) => ({ default: module.CommandPalette }))
);
const HelpDrawer = lazy(() =>
  import('./HelpDrawer').then((module) => ({ default: module.HelpDrawer }))
);

function systemPrefersDark() {
  if (typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function discoveryProvenance(result: ScanResult): HandoffProvenance {
  const stored = (result as Partial<RecentDiscovery>).handoffProvenance;
  if (stored) return stored;
  const cloudflareIngress = result.details?.some((detail) =>
    detail.toLowerCase().includes('cloudflared ingress route')
  );
  const discoveredAt =
    'discoveredAt' in result && typeof result.discoveredAt === 'string'
      ? Date.parse(result.discoveredAt)
      : Number.NaN;
  return {
    source: cloudflareIngress ? 'cloudflare-config' : 'bounded-discovery',
    quality: cloudflareIngress ? 'inferred' : Number.isFinite(discoveredAt) ? 'manual' : 'observed',
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
  const [claimInitialScan] = useState(createInitialScanClaim);
  const [appearance, setAppearanceState] = useState<AppearancePreference>(() =>
    readAppearancePreference()
  );
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);
  const [appearanceSaved, setAppearanceSaved] = useState(true);
  const [interfaceSaved, setInterfaceSaved] = useState(true);
  const preferenceStorageError =
    appearanceSaved && interfaceSaved
      ? ''
      : 'Browser storage is unavailable. Some interface changes apply only to this session. Try the affected choice again to save it.';
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
      setAppearanceSaved(persistAppearancePreference(nextAppearance));
    },
    [prefersDark]
  );

  const setInterfacePreferences = useCallback((preferences: InterfacePreferences) => {
    setInterfacePreferencesState(preferences);
    applyInterfacePreferences(preferences);
    setInterfaceSaved(persistInterfacePreferences(preferences));
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

  const recordResults = useCallback((results: ScanResult[], provenance?: HandoffProvenance) => {
    const detected = results.filter((result) => result.alive);
    if (!detected.length) return;
    const discoveredAt = provenance?.observedAt ?? new Date().toISOString();
    setDiscoveries((current) => {
      const next = detected.map((result) => ({
        ...result,
        discoveredAt,
        handoffProvenance: provenance,
      }));
      const addresses = new Set(next.map((result) => result.address));
      return [...next, ...current.filter((result) => !addresses.has(result.address))].slice(0, 12);
    });
  }, []);

  const openHandoff = useCallback(
    (handoff: PendingHandoffInput, options?: { memoryOnly?: boolean }) => {
      const stored = storePendingHandoff(handoff, options);
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
    (result: ScanResult, provenance?: HandoffProvenance) => {
      return openHandoff({
        provenance: provenance ?? discoveryProvenance(result),
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
    (result: ScanResult, provenance?: HandoffProvenance) => {
      const url = scanResultHTTPURL(result);
      return openHandoff({
        provenance: provenance ?? discoveryProvenance(result),
        draft: { kind: 'http-url-draft', target: { kind: 'http-url', url } },
      });
    },
    [openHandoff]
  );

  const actions = useMemo<PaletteAction[]>(() => {
    return [
      {
        id: 'scan',
        label: 'Probe or import discovery evidence',
        keywords: 'discover grpc http tcp nmap xml',
        run: () => openScan(),
      },
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
        label: 'Open tool help',
        keywords: 'help evidence transport',
        run: openHelp,
      },
    ];
  }, [appearance, openHelp, openScan, resolvedAppearance.theme, setAppearance]);

  const loadSavedActions = useCallback(async () => {
    const { readHTTPLibrary } = await import('./http-library');
    const library = readHTTPLibrary();
    if (library.error) throw new Error(library.error);
    const action = (id: string, name: string, method: string, url: string): PaletteAction => ({
      id: `http-recipe-${id}`,
      label: `Load HTTP request: ${name}`,
      hint: method,
      keywords: `saved request ${url.slice(0, 1024)}`,
      run: () => {
        clearPendingHandoff();
        queueHTTPRecipe(id);
        void navigate({ to: '/protocols/http' });
        window.dispatchEvent(new Event(httpRecipeLoadEvent));
      },
    });
    return library.requests.map((recipe) =>
      action(recipe.id, recipe.name, recipe.draft.method, recipe.draft.url)
    );
  }, [navigate]);

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
      preferenceStorageError,
      discoveries,
      openScan,
      claimInitialScan,
      openHandoff,
      openGRPCDiscovery,
      openHTTPDiscovery,
    }),
    [
      discoveries,
      preferenceStorageError,
      interfacePreferences,
      openGRPCDiscovery,
      openHandoff,
      openHTTPDiscovery,
      openScan,
      claimInitialScan,
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
        onOpenHelp={openHelp}
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
      {commandOpen ? (
        <Suspense
          fallback={
            <span className="pp-shell-announcement" role="status">
              Loading commands…
            </span>
          }
        >
          <CommandPalette
            open
            actions={actions}
            onNavigate={(route, mode) => {
              void navigate({
                to: route,
                search: mode ? { mode } : undefined,
                ...(route === '/network/diagnostics'
                  ? {
                      state: (current) => ({
                        diagnosticInvocation:
                          Number.isSafeInteger(current.diagnosticInvocation) &&
                          (current.diagnosticInvocation ?? -1) >= 0 &&
                          (current.diagnosticInvocation ?? 0) < Number.MAX_SAFE_INTEGER
                            ? (current.diagnosticInvocation ?? 0) + 1
                            : 1,
                      }),
                    }
                  : {}),
              });
            }}
            loadExtraActions={loadSavedActions}
            onClose={() => setCommandOpen(false)}
          />
        </Suspense>
      ) : null}
      {helpOpen ? (
        <Suspense
          fallback={
            <span className="pp-shell-announcement" role="status">
              Opening help…
            </span>
          }
        >
          <HelpDrawer onClose={closeHelp} />
        </Suspense>
      ) : null}
    </ProtocolShellContext.Provider>
  );
}
