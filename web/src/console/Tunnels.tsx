import {
  Activity,
  AlertTriangle,
  Box,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Cloud,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Gauge,
  History,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Route as RouteIcon,
  Search,
  ShieldCheck,
  Square,
  Terminal,
  Wrench,
  X,
} from 'lucide-react';
import {
  type KeyboardEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useProtocolShell } from './ProtocolShellContext';
import {
  type PlannedTunnelRoute,
  routeSupportsWorkbench,
  scanResultFromTunnelRoute,
} from './tunnels/route-plan';
import {
  fetchTunnelCapabilities,
  fetchTunnelRelease,
  fetchTunnelSnapshot,
  performTunnelServiceAction,
  TunnelAPIError,
  type TunnelCapabilities,
  type TunnelConfigSource,
  type TunnelDeployment,
  type TunnelRelease,
  type TunnelRoute,
  type TunnelServiceAction,
  type TunnelServiceActionResult,
  type TunnelSnapshot,
} from './tunnels-api';
import './tunnels.css';

type TunnelTab = 'overview' | 'routes' | 'runtime' | 'diagnostics';
type DeploymentFilter = 'all' | 'running' | 'stopped';
type MobilePane = 'deployments' | 'details';
type PlannedRoute = PlannedTunnelRoute;
type PlanEvent = { id: string; deployment: string; summary: string; createdAt: string };

const tunnelTabs = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'routes', label: 'Routes', icon: RouteIcon },
  { id: 'runtime', label: 'Runtime', icon: Terminal },
  { id: 'diagnostics', label: 'Diagnostics', icon: Activity },
] as const;

const filters = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'stopped', label: 'Not running' },
] as const;
const stableServiceStates = new Set(['running', 'stopped', 'paused']);
const RoutePlanner = lazy(() => import('./tunnels/RoutePlanner'));

export function Tunnels() {
  const shell = useProtocolShell();
  const [capabilities, setCapabilities] = useState<TunnelCapabilities | null>(null);
  const [snapshot, setSnapshot] = useState<TunnelSnapshot | null>(null);
  const [selectedID, setSelectedID] = useState('');
  const [selectedRouteID, setSelectedRouteID] = useState('');
  const [filter, setFilter] = useState<DeploymentFilter>('all');
  const [activeTab, setActiveTab] = useState<TunnelTab>('routes');
  const [mobilePane, setMobilePane] = useState<MobilePane>('details');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [release, setRelease] = useState<TunnelRelease | null>(null);
  const [releaseLoading, setReleaseLoading] = useState(false);
  const [releaseError, setReleaseError] = useState('');
  const [pendingServiceAction, setPendingServiceAction] = useState<TunnelServiceAction | null>(
    null
  );
  const [serviceActionLoading, setServiceActionLoading] = useState(false);
  const [serviceActionResult, setServiceActionResult] = useState<TunnelServiceActionResult | null>(
    null
  );
  const [plannedRoutes, setPlannedRoutes] = useState<Record<string, PlannedRoute[]>>({});
  const [planEvents, setPlanEvents] = useState<PlanEvent[]>([]);
  const mountedRef = useRef(true);
  const requestRef = useRef<AbortController | null>(null);
  const releaseRequestRef = useRef<AbortController | null>(null);
  const actionRequestRef = useRef<AbortController | null>(null);
  const plannerReturnFocusRef = useRef<HTMLElement | null>(null);
  const selectedIDRef = useRef('');

  const openPlanner = useCallback(() => {
    plannerReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPlannerOpen(true);
  }, []);

  const closePlanner = useCallback(() => {
    setPlannerOpen(false);
    requestAnimationFrame(() => plannerReturnFocusRef.current?.focus());
  }, []);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setRefreshing(true);
    try {
      const [nextCapabilities, nextSnapshot] = await Promise.all([
        fetchTunnelCapabilities(controller.signal),
        fetchTunnelSnapshot(controller.signal),
      ]);
      if (!mountedRef.current || controller.signal.aborted) return;
      setCapabilities(nextCapabilities);
      setSnapshot(nextSnapshot);
      setError('');
      const nextSelectedID =
        selectedIDRef.current &&
        nextSnapshot.deployments.some((deployment) => deployment.id === selectedIDRef.current)
          ? selectedIDRef.current
          : (nextSnapshot.deployments[0]?.id ?? '');
      if (nextSelectedID !== selectedIDRef.current) {
        setServiceActionResult(null);
        setPendingServiceAction(null);
      }
      selectedIDRef.current = nextSelectedID;
      setSelectedID(nextSelectedID);
    } catch (cause) {
      if (!mountedRef.current || controller.signal.aborted) return;
      if (cause instanceof TunnelAPIError && (cause.status === 403 || cause.status === 404)) {
        setError(
          'Tunnel inspection is unavailable in this runtime. Start ProtoPeek in local browser mode to use it.'
        );
      } else {
        setError(
          cause instanceof Error && cause.message
            ? cause.message.slice(0, 2 * 1024)
            : 'Tunnel evidence could not be loaded.'
        );
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (mountedRef.current && !controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const checkRelease = useCallback(async () => {
    releaseRequestRef.current?.abort();
    const controller = new AbortController();
    releaseRequestRef.current = controller;
    setReleaseLoading(true);
    setReleaseError('');
    try {
      const nextRelease = await fetchTunnelRelease(controller.signal);
      if (!mountedRef.current || controller.signal.aborted) return;
      setRelease(nextRelease);
    } catch (cause) {
      if (!mountedRef.current || controller.signal.aborted) return;
      setReleaseError(
        cause instanceof Error && cause.message
          ? cause.message.slice(0, 2 * 1024)
          : 'The latest cloudflared release could not be checked.'
      );
    } finally {
      if (releaseRequestRef.current === controller) releaseRequestRef.current = null;
      if (mountedRef.current && !controller.signal.aborted) setReleaseLoading(false);
    }
  }, []);

  const runServiceAction = useCallback(
    async (action: TunnelServiceAction) => {
      if (!snapshot?.service.present || serviceActionLoading) return;
      actionRequestRef.current?.abort();
      const controller = new AbortController();
      actionRequestRef.current = controller;
      setServiceActionLoading(true);
      try {
        const result = await performTunnelServiceAction(
          action,
          snapshot.service.state,
          controller.signal
        );
        if (!mountedRef.current || controller.signal.aborted) return;
        setServiceActionResult(result);
        setPendingServiceAction(null);
        if (result.status === 'completed' || result.status === 'unchanged') await load();
      } catch (cause) {
        if (!mountedRef.current || controller.signal.aborted) return;
        setServiceActionResult({
          schemaVersion: 1,
          action,
          status: 'failed',
          message:
            cause instanceof Error && cause.message
              ? cause.message.slice(0, 2 * 1024)
              : `The ${action} request failed.`,
          elevationRequired: false,
          elevationMechanism: '',
          manualCommand: '',
          service: snapshot.service,
          observedAt: new Date().toISOString(),
        });
        setPendingServiceAction(null);
      } finally {
        if (actionRequestRef.current === controller) actionRequestRef.current = null;
        if (mountedRef.current && !controller.signal.aborted) setServiceActionLoading(false);
      }
    },
    [load, serviceActionLoading, snapshot]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current?.abort();
      releaseRequestRef.current?.abort();
      actionRequestRef.current?.abort();
    };
  }, []);

  const deployments = snapshot?.deployments ?? [];
  const selected = deployments.find((deployment) => deployment.id === selectedID) ?? null;
  const counts = useMemo(
    () => ({
      all: deployments.length,
      running: deployments.filter((deployment) => deployment.status === 'running').length,
      stopped: deployments.filter((deployment) => deployment.status !== 'running').length,
    }),
    [deployments]
  );
  const filteredDeployments = useMemo(() => {
    if (filter === 'running')
      return deployments.filter((deployment) => deployment.status === 'running');
    if (filter === 'stopped')
      return deployments.filter((deployment) => deployment.status !== 'running');
    return deployments;
  }, [deployments, filter]);
  const visibleRoutes = useMemo(
    () => (selected ? [...(plannedRoutes[selected.id] ?? []), ...selected.routes] : []),
    [plannedRoutes, selected]
  );
  const selectedRoute =
    visibleRoutes.find((route) => route.id === selectedRouteID) ?? visibleRoutes[0] ?? null;
  const selectedRouteIsDraft = Boolean(
    selectedRoute && 'planned' in selectedRoute && selectedRoute.planned
  );
  const selectedUsesCanonicalService = Boolean(selected?.boundToCanonicalService);
  const selectedService = selectedUsesCanonicalService
    ? (snapshot?.service ?? selected?.runtime)
    : selected?.runtime;
  const selectedServiceCapability = selectedUsesCanonicalService
    ? (capabilities?.serviceControl ?? null)
    : selected
      ? {
          supported: false,
          reason: deploymentServiceScope(selected),
        }
      : null;

  useEffect(() => {
    if (selectedRoute && selectedRoute.id !== selectedRouteID) setSelectedRouteID(selectedRoute.id);
    if (!selectedRoute && selectedRouteID) setSelectedRouteID('');
  }, [selectedRoute, selectedRouteID]);

  function selectDeployment(id: string) {
    selectedIDRef.current = id;
    setSelectedID(id);
    setSelectedRouteID('');
    setMobilePane('details');
    setNotice('');
    setServiceActionResult(null);
    setPendingServiceAction(null);
  }

  function addPlannedRoute(route: PlannedRoute) {
    if (!selected) return;
    setPlannedRoutes((current) => ({
      ...current,
      [selected.id]: [...(current[selected.id] ?? []), route],
    }));
    setPlanEvents((current) => [
      {
        id: route.id,
        deployment: selected.name,
        summary: `Drafted ${route.hostname} → ${route.service}`,
        createdAt: new Date().toISOString(),
      },
      ...current,
    ]);
    setSelectedRouteID(route.id);
    setActiveTab('routes');
    setMobilePane('details');
    setNotice(
      'Route draft added to this view. No file, service, or Cloudflare account was changed.'
    );
  }

  function removePlannedRoute(routeID: string) {
    if (!selected) return;
    setPlannedRoutes((current) => ({
      ...current,
      [selected.id]: (current[selected.id] ?? []).filter((route) => route.id !== routeID),
    }));
    setSelectedRouteID('');
    setNotice('Draft removed. The host was never changed.');
  }

  function handoffRoute(kind: 'http' | 'grpc') {
    if (!selectedRoute || selectedRoute.catchAll) return;
    const result = scanResultFromTunnelRoute(selectedRoute, kind);
    if (!result) {
      setNotice(
        `This ${selectedRoute.protocol || 'unknown'} origin cannot be opened in the ${kind.toUpperCase()} workbench.`
      );
      return;
    }
    if (kind === 'http') shell.openHTTPDiscovery(result);
    else shell.openGRPCDiscovery(result);
  }

  const observedLabel = snapshot ? formatObserved(snapshot.observedAt) : 'Not observed';

  return (
    <section className="pp-tunnels" aria-labelledby="tunnels-title">
      <header className="pp-tunnel-page-heading">
        <div>
          <span className="pp-tunnel-kicker">Tunnels / local host</span>
          <div className="pp-tunnel-title-row">
            <h1 id="tunnels-title">Tunnel operations</h1>
            <span className="pp-tunnel-scope">
              <ShieldCheck aria-hidden="true" /> Local-only control
            </span>
          </div>
          <p>
            Inspect cloudflared, understand configuration authority, and stage safe route changes.
          </p>
        </div>
        <div className="pp-tunnel-page-state" data-state={snapshot?.status ?? 'idle'}>
          <Circle aria-hidden="true" />
          <span>
            {snapshot?.status === 'unavailable'
              ? 'Setup needed'
              : error
                ? 'Unavailable'
                : snapshot
                  ? 'Local boundary active'
                  : 'Awaiting inspection'}
          </span>
        </div>
      </header>

      {deployments.length ? (
        <>
          <div className="pp-tunnel-toolbar" role="toolbar" aria-label="Tunnel controls">
            <label className="pp-tunnel-deployment-select pp-tunnel-mobile-deployment-select">
              <span>Deployment</span>
              <select
                value={selectedID}
                disabled={!deployments.length}
                onChange={(event) => selectDeployment(event.currentTarget.value)}
              >
                {deployments.map((deployment) => (
                  <option key={deployment.id} value={deployment.id}>
                    {deployment.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="pp-tunnel-toolbar-state">
              <StatusDot status={selected?.status ?? snapshot?.status ?? 'unknown'} />
              <span>
                {selected
                  ? `${statusLabel(selected.status)} · ${managementLabel(selected.managementMode)}`
                  : snapshot?.cloudflared.found
                    ? 'cloudflared found · no deployment proven'
                    : snapshot
                      ? 'cloudflared not detected'
                      : 'Host evidence has not been requested'}
              </span>
            </div>
            <button
              type="button"
              className="pp-tunnel-button pp-tunnel-button-secondary"
              disabled={refreshing}
              onClick={() => void load()}
            >
              <RefreshCw aria-hidden="true" className={refreshing ? 'is-spinning' : ''} />
              {refreshing ? 'Observing…' : 'Refresh'}
            </button>
            <button
              type="button"
              className="pp-tunnel-button pp-tunnel-button-primary"
              disabled={!selected || !capabilities?.routePlanPreview.supported}
              onClick={openPlanner}
            >
              <Plus aria-hidden="true" /> Draft ingress route
            </button>
          </div>

          <fieldset className="pp-tunnel-mobile-switch">
            <legend className="pp-sr-only">Tunnel workspace pane</legend>
            <button
              type="button"
              className={mobilePane === 'deployments' ? 'is-active' : ''}
              aria-pressed={mobilePane === 'deployments'}
              onClick={() => setMobilePane('deployments')}
            >
              Deployments <span>{deployments.length}</span>
            </button>
            <button
              type="button"
              className={mobilePane === 'details' ? 'is-active' : ''}
              aria-pressed={mobilePane === 'details'}
              onClick={() => setMobilePane('details')}
              disabled={!selected}
            >
              Details
            </button>
          </fieldset>

          <div className="pp-tunnel-workbench">
            <aside
              className={`pp-tunnel-deployments ${mobilePane === 'details' ? 'is-mobile-hidden' : ''}`}
              aria-label="Tunnel deployments"
            >
              <header>
                <div className="pp-tunnel-deployments-heading">
                  <span className="pp-tunnel-section-label">Deployments</span>
                  <strong>{deployments.length} observed</strong>
                </div>
                <Search aria-hidden="true" />
              </header>
              <fieldset className="pp-tunnel-filters">
                <legend className="pp-sr-only">Filter deployments</legend>
                {filters.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={filter === item.id ? 'is-active' : ''}
                    aria-pressed={filter === item.id}
                    onClick={() => setFilter(item.id)}
                  >
                    {item.label} <span>{counts[item.id]}</span>
                  </button>
                ))}
              </fieldset>
              <div className="pp-tunnel-deployment-list">
                {loading ? <DeploymentSkeleton /> : null}
                {!loading && error ? (
                  <div className="pp-tunnel-list-message is-error">
                    <AlertTriangle aria-hidden="true" />
                    <strong>Local tunnel API unavailable</strong>
                    <p>{error}</p>
                  </div>
                ) : null}
                {!loading && !error && !filteredDeployments.length ? (
                  <div className="pp-tunnel-list-message">
                    <Cloud aria-hidden="true" />
                    <strong>No matches</strong>
                    <p>Choose another status filter.</p>
                  </div>
                ) : null}
                {filteredDeployments.map((deployment) => (
                  <button
                    key={deployment.id}
                    type="button"
                    className={`pp-tunnel-deployment-row ${deployment.id === selectedID ? 'is-selected' : ''}`}
                    onClick={() => selectDeployment(deployment.id)}
                  >
                    <StatusDot status={deployment.status} />
                    <span className="pp-tunnel-deployment-copy">
                      <strong>{deployment.name}</strong>
                      <small>
                        {driverLabel(deployment.driver)} · {routeCountLabel(deployment.routes)}
                      </small>
                    </span>
                    <span className="pp-tunnel-deployment-state">
                      {statusLabel(deployment.status)}
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                ))}
              </div>
              <footer>
                <ShieldCheck aria-hidden="true" />
                <p>
                  <strong>Bounded discovery</strong>
                  <span>No recursive disk search or background polling.</span>
                </p>
              </footer>
            </aside>

            <article
              className={`pp-tunnel-detail ${mobilePane === 'deployments' ? 'is-mobile-hidden' : ''}`}
            >
              {selected ? (
                <>
                  <TunnelDetailHeader
                    deployment={selected}
                    service={selectedService ?? selected.runtime}
                    serviceCapability={selectedServiceCapability}
                    serviceScope={
                      selectedUsesCanonicalService
                        ? 'Canonical host service'
                        : deploymentServiceScope(selected)
                    }
                    notice={notice}
                    onNotice={setNotice}
                    actionLoading={serviceActionLoading}
                    actionResult={serviceActionResult}
                    onRequestAction={setPendingServiceAction}
                  />
                  <div className="pp-tunnel-tabs" role="tablist" aria-label="Deployment evidence">
                    {tunnelTabs.map((tab) => (
                      <button
                        key={tab.id}
                        id={`tunnel-tab-${tab.id}`}
                        type="button"
                        role="tab"
                        aria-selected={activeTab === tab.id}
                        aria-controls={`tunnel-panel-${tab.id}`}
                        tabIndex={activeTab === tab.id ? 0 : -1}
                        className={activeTab === tab.id ? 'is-active' : ''}
                        onClick={() => setActiveTab(tab.id)}
                        onKeyDown={(event) => handleTabKey(event, tab.id, setActiveTab)}
                      >
                        <tab.icon aria-hidden="true" /> {tab.label}
                      </button>
                    ))}
                  </div>
                  <div
                    className="pp-tunnel-panel"
                    role="tabpanel"
                    id={`tunnel-panel-${activeTab}`}
                    aria-labelledby={`tunnel-tab-${activeTab}`}
                  >
                    {activeTab === 'overview' ? (
                      <OverviewPanel
                        deployment={selected}
                        snapshot={snapshot}
                        capabilities={capabilities}
                        release={release}
                        releaseLoading={releaseLoading}
                        releaseError={releaseError}
                        onCheckRelease={() => void checkRelease()}
                        onNotice={setNotice}
                      />
                    ) : null}
                    {activeTab === 'routes' ? (
                      <RoutesPanel
                        deployment={selected}
                        routes={visibleRoutes}
                        selectedRouteID={selectedRoute?.id ?? ''}
                        configSources={snapshot?.configSources ?? []}
                        onSelectRoute={setSelectedRouteID}
                        onAdd={openPlanner}
                        onRemoveDraft={removePlannedRoute}
                        onNotice={setNotice}
                      />
                    ) : null}
                    {activeTab === 'runtime' ? (
                      <RuntimePanel
                        deployment={selected}
                        service={selectedService ?? selected.runtime}
                        capabilities={capabilities}
                        serviceCapability={selectedServiceCapability}
                        serviceScope={
                          selectedUsesCanonicalService
                            ? 'Canonical host service'
                            : deploymentServiceScope(selected)
                        }
                      />
                    ) : null}
                    {activeTab === 'diagnostics' ? (
                      <DiagnosticsPanel
                        deployment={selected}
                        snapshot={snapshot}
                        onNotice={setNotice}
                      />
                    ) : null}
                  </div>
                  <section
                    className="pp-tunnel-handoffs"
                    aria-label="Open selected origin in a ProtoPeek workbench"
                  >
                    <div>
                      <span className="pp-tunnel-section-label">
                        {selectedRouteIsDraft ? 'Draft origin · not observed' : 'Observed origin'}
                      </span>
                      <strong>
                        {selectedRoute && !selectedRoute.catchAll
                          ? selectedRoute.service
                          : 'Select a routed origin'}
                      </strong>
                      <small>
                        {selectedRouteIsDraft
                          ? 'This browser-only draft has not been applied or inspected on the host.'
                          : 'Continue debugging in a ProtoPeek protocol workbench.'}
                      </small>
                    </div>
                    <button
                      type="button"
                      disabled={!routeSupportsWorkbench(selectedRoute, 'http')}
                      onClick={() => handoffRoute('http')}
                    >
                      <ExternalLink aria-hidden="true" /> Open in HTTP
                    </button>
                    <button
                      type="button"
                      disabled={!routeSupportsWorkbench(selectedRoute, 'grpc')}
                      onClick={() => handoffRoute('grpc')}
                    >
                      <ExternalLink aria-hidden="true" /> Open in gRPC
                    </button>
                    <button type="button" onClick={() => setHistoryOpen(true)}>
                      <History aria-hidden="true" /> View change history
                    </button>
                  </section>
                </>
              ) : null}
            </article>
          </div>
        </>
      ) : (
        <EmptyDetail
          snapshot={snapshot}
          capabilities={capabilities}
          loading={loading}
          error={error}
          onRefresh={() => void load()}
          release={release}
          releaseLoading={releaseLoading}
          releaseError={releaseError}
          onCheckRelease={() => void checkRelease()}
          onNotice={setNotice}
          serviceActionLoading={serviceActionLoading}
          serviceActionResult={serviceActionResult}
          onRequestAction={setPendingServiceAction}
        />
      )}

      <footer className="pp-tunnel-statusbar">
        <span>
          <CheckCircle2 aria-hidden="true" /> Observed {observedLabel}
        </span>
        <span>
          <Circle aria-hidden="true" /> No background polling
        </span>
        <span>
          <ShieldCheck aria-hidden="true" /> Secrets redacted before API output
        </span>
        <span className="pp-tunnel-statusbar-mode">
          {capabilities?.platform ?? 'local'} ·{' '}
          {capabilities?.serviceManager ?? 'detecting service manager'}
        </span>
      </footer>

      {plannerOpen && selected ? (
        <Suspense fallback={null}>
          <RoutePlanner deployment={selected} onClose={closePlanner} onSave={addPlannedRoute} />
        </Suspense>
      ) : null}
      {historyOpen ? (
        <HistoryDrawer events={planEvents} onClose={() => setHistoryOpen(false)} />
      ) : null}
      {pendingServiceAction && selectedUsesCanonicalService && snapshot?.service.present ? (
        <ServiceActionDialog
          action={pendingServiceAction}
          service={snapshot.service}
          loading={serviceActionLoading}
          onCancel={() => setPendingServiceAction(null)}
          onConfirm={() => void runServiceAction(pendingServiceAction)}
        />
      ) : null}
    </section>
  );
}

function TunnelDetailHeader({
  deployment,
  service,
  serviceCapability,
  serviceScope,
  notice,
  onNotice,
  actionLoading,
  actionResult,
  onRequestAction,
}: {
  deployment: TunnelDeployment;
  service: TunnelSnapshot['service'];
  serviceCapability: TunnelCapabilities['serviceControl'] | null;
  serviceScope: string;
  notice: string;
  onNotice: (value: string) => void;
  actionLoading: boolean;
  actionResult: TunnelServiceActionResult | null;
  onRequestAction: (action: TunnelServiceAction) => void;
}) {
  const runtime = service;
  return (
    <>
      <header className="pp-tunnel-detail-heading">
        <div>
          <span className="pp-tunnel-section-label">Selected deployment</span>
          <h2>{deployment.name}</h2>
          <p>
            {deployment.configurationAuthority} · {driverLabel(deployment.driver)}
          </p>
        </div>
        <span className={`pp-tunnel-mode-badge is-${deployment.managementMode}`}>
          {managementLabel(deployment.managementMode)}
        </span>
      </header>
      <div className="pp-tunnel-runtime-strip">
        <StatusDot status={deployment.status} />
        <div>
          <strong>{runtime.label || 'cloudflared'}</strong>
          <span>
            {runtime.present
              ? statusLabel(runtime.state)
              : deployment.boundToCanonicalService
                ? 'Canonical service not present'
                : 'Runtime not applicable'}
            {runtime.pid ? ` · PID ${runtime.pid}` : ''}
          </span>
        </div>
        <span className="pp-tunnel-runtime-manager">
          {runtime.manager || 'no service manager'} · {serviceScope}
        </span>
        <ServiceControls
          service={runtime}
          capability={serviceCapability}
          loading={actionLoading}
          onRequestAction={onRequestAction}
        />
      </div>
      {actionResult ? <ServiceActionFeedback result={actionResult} onNotice={onNotice} /> : null}
      {notice ? (
        <div className="pp-tunnel-notice" role="status">
          <ShieldCheck aria-hidden="true" /> <span>{notice}</span>
          <button type="button" aria-label="Dismiss tunnel notice" onClick={() => onNotice('')}>
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </>
  );
}

function RoutesPanel({
  deployment,
  routes,
  selectedRouteID,
  configSources,
  onSelectRoute,
  onAdd,
  onRemoveDraft,
  onNotice,
}: {
  deployment: TunnelDeployment;
  routes: Array<TunnelRoute | PlannedRoute>;
  selectedRouteID: string;
  configSources: TunnelConfigSource[];
  onSelectRoute: (value: string) => void;
  onAdd: () => void;
  onRemoveDraft: (value: string) => void;
  onNotice: (value: string) => void;
}) {
  const attributedSources =
    deployment.managementMode === 'remote'
      ? []
      : configSources.filter((source) => {
          if (deployment.configSourceId) return source.id === deployment.configSourceId;
          return sameLocalPath(source.path, deployment.configPath);
        });
  const activeConfig = attributedSources[0];
  return (
    <div className="pp-tunnel-route-panel">
      <div className="pp-tunnel-panel-heading">
        <div>
          <span className="pp-tunnel-section-label">Ingress</span>
          <h3>{routeCountLabel(routes)}</h3>
        </div>
        <button type="button" className="pp-tunnel-text-action" onClick={onAdd}>
          <Plus aria-hidden="true" /> Draft ingress route
        </button>
      </div>
      {routes.length ? (
        <table className="pp-tunnel-route-table">
          <caption className="pp-sr-only">Ingress routes</caption>
          <thead>
            <tr className="pp-tunnel-route-table-head">
              <th scope="col">Hostname</th>
              <th scope="col">Protocol</th>
              <th scope="col">Origin service</th>
              <th scope="col">
                <span className="pp-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {routes.map((route) => {
              const planned = 'planned' in route && route.planned;
              return (
                <tr
                  key={route.id}
                  data-origin={planned ? 'draft' : 'observed'}
                  className={`pp-tunnel-route-row ${selectedRouteID === route.id ? 'is-selected' : ''}`}
                >
                  <td className="pp-tunnel-route-host">
                    <button
                      type="button"
                      aria-current={selectedRouteID === route.id ? 'true' : undefined}
                      onClick={() => onSelectRoute(route.id)}
                    >
                      <strong>
                        {route.catchAll ? 'Catch-all' : route.hostname || 'Hostname not set'}
                      </strong>
                      <small>
                        {route.path || (route.catchAll ? 'Final fallback rule' : 'All paths')}
                      </small>
                    </button>
                  </td>
                  <td>
                    <span className={`pp-tunnel-protocol is-${route.protocol}`}>
                      {planned ? 'planned · ' : ''}
                      {route.protocol}
                    </span>
                  </td>
                  <td>
                    <code>{route.service || 'No service'}</code>
                  </td>
                  <td className="pp-tunnel-route-actions">
                    <details>
                      <summary aria-label={`Actions for ${route.hostname || 'catch-all route'}`}>
                        <MoreHorizontal aria-hidden="true" />
                      </summary>
                      <div className="pp-tunnel-route-menu">
                        <button type="button" onClick={() => onSelectRoute(route.id)}>
                          Select route
                        </button>
                        <button
                          type="button"
                          onClick={() => void copyText(route.service, onNotice)}
                        >
                          Copy origin
                        </button>
                        {planned ? (
                          <button
                            type="button"
                            className="is-danger"
                            onClick={() => onRemoveDraft(route.id)}
                          >
                            Remove draft
                          </button>
                        ) : null}
                      </div>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="pp-tunnel-inline-empty">
          <RouteIcon aria-hidden="true" />
          <div>
            <strong>No local ingress rules observed</strong>
            <p>
              {deployment.managementMode === 'remote'
                ? 'Routes are controlled by the Cloudflare account; account access is not connected.'
                : 'This deployment has no readable ingress list.'}
            </p>
          </div>
          <button type="button" onClick={onAdd}>
            Draft the first route
          </button>
        </div>
      )}
      <ConfigEvidence active={activeConfig} deployment={deployment} />
    </div>
  );
}

function ConfigEvidence({
  active,
  deployment,
}: {
  active?: TunnelConfigSource;
  deployment: TunnelDeployment;
}) {
  if (deployment.managementMode === 'remote') {
    return (
      <section className="pp-tunnel-config-evidence" aria-labelledby="tunnel-config-heading">
        <header>
          <div className="pp-tunnel-config-heading">
            <Cloud aria-hidden="true" />
            <span>
              <strong id="tunnel-config-heading">Configuration authority</strong>
              <small>Cloudflare account authority; local YAML is not assumed</small>
            </span>
          </div>
          <span className="pp-tunnel-proof is-ok">
            <Cloud aria-hidden="true" /> Remote
          </span>
        </header>
        <div className="pp-tunnel-config-primary">
          <span className="pp-tunnel-config-authority">
            <Cloud aria-hidden="true" /> Remote managed
          </span>
          <div>
            <strong>{deployment.configurationAuthority || 'Cloudflare account'}</strong>
            <small>No local YAML source is attributed to this remote-managed deployment.</small>
          </div>
          <span>Remote authority</span>
        </div>
      </section>
    );
  }
  return (
    <section className="pp-tunnel-config-evidence" aria-labelledby="tunnel-config-heading">
      <header>
        <div className="pp-tunnel-config-heading">
          <FileText aria-hidden="true" />
          <span>
            <strong id="tunnel-config-heading">Configuration source</strong>
            <small>Authority and precedence, not a file browser</small>
          </span>
        </div>
        <span className={`pp-tunnel-proof ${active?.valid ? 'is-ok' : 'is-warning'}`}>
          {active?.valid ? <Check aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
          {active?.valid ? 'Parsed' : 'Needs evidence'}
        </span>
      </header>
      <div className="pp-tunnel-config-primary">
        <span className="pp-tunnel-config-authority">
          <Cloud aria-hidden="true" /> {deployment.configurationAuthority}
        </span>
        <div>
          <strong>{active?.path || deployment.configPath || 'No local YAML path proven'}</strong>
          <small>
            {active
              ? `${sourceLabel(active.source)} · ${routeCountFromSource(active)}`
              : 'This deployment did not report an attributable config source'}
          </small>
        </div>
        <span className={active?.effective ? 'is-effective' : ''}>
          {active?.effective ? 'Effective' : active ? 'Deployment config' : 'Local YAML'}
        </span>
      </div>
      {active && !active.catchAllPresent && active.routeCount > 0 ? (
        <p className="pp-tunnel-config-warning">
          <AlertTriangle aria-hidden="true" /> Final catch-all rule was not observed.
        </p>
      ) : null}
    </section>
  );
}

function OverviewPanel({
  deployment,
  snapshot,
  capabilities,
  release,
  releaseLoading,
  releaseError,
  onCheckRelease,
  onNotice,
}: {
  deployment: TunnelDeployment;
  snapshot: TunnelSnapshot | null;
  capabilities: TunnelCapabilities | null;
  release: TunnelRelease | null;
  releaseLoading: boolean;
  releaseError: string;
  onCheckRelease: () => void;
  onNotice: (value: string) => void;
}) {
  return (
    <div className="pp-tunnel-overview-panel">
      <div className="pp-tunnel-stat-grid">
        <div>
          <span>Runtime</span>
          <strong>{statusLabel(deployment.status)}</strong>
          <small>{deployment.runtime.manager || 'Manager unknown'}</small>
        </div>
        <div>
          <span>Configuration</span>
          <strong>{managementLabel(deployment.managementMode)}</strong>
          <small>{deployment.configurationAuthority}</small>
        </div>
        <div>
          <span>Ingress</span>
          <strong>{hostnameRouteLabel(deployment.routes)}</strong>
          <small>
            {deployment.routes.some((route) => route.catchAll)
              ? '+ catch-all'
              : 'No catch-all proven'}
          </small>
        </div>
      </div>
      <HostToolEvidence snapshot={snapshot} />
      <ConfigCandidates sources={snapshot?.configSources ?? []} />
      <ReleasePanel
        release={release}
        loading={releaseLoading}
        error={releaseError}
        installedVersion={snapshot?.cloudflared.version ?? ''}
        onCheck={onCheckRelease}
      />
      <InstallPanel
        capabilities={capabilities}
        cloudflaredFound={snapshot?.cloudflared.found ?? false}
        onNotice={onNotice}
      />
      {deployment.warnings.length ? <EvidenceWarnings warnings={deployment.warnings} /> : null}
    </div>
  );
}

function RuntimePanel({
  deployment,
  service,
  capabilities,
  serviceCapability,
  serviceScope,
}: {
  deployment: TunnelDeployment;
  service: TunnelSnapshot['service'];
  capabilities: TunnelCapabilities | null;
  serviceCapability: TunnelCapabilities['serviceControl'] | null;
  serviceScope: string;
}) {
  const canonical = deployment.boundToCanonicalService;
  const facts = [
    ['Runtime scope', serviceScope],
    ['Service manager', service.manager || (canonical ? 'Unknown' : 'Not applicable')],
    ['Service label', service.label || (canonical ? 'Not observed' : 'Not applicable')],
    ['Installed', canonical ? (service.present ? 'Yes' : 'No') : 'Not applicable'],
    ['State', statusLabel(service.state)],
    [
      'Process ID',
      service.pid ? String(service.pid) : canonical ? 'Not observed' : 'Not applicable',
    ],
    ['Executable', service.executablePath || (canonical ? 'Not proven' : 'Not applicable')],
    ['Credential source', deployment.credentialSource],
  ];
  return (
    <div className="pp-tunnel-runtime-panel">
      <div className="pp-tunnel-panel-heading">
        <div>
          <span className="pp-tunnel-section-label">
            {canonical ? 'Canonical runtime' : 'Deployment runtime'}
          </span>
          <h3>{canonical ? 'Service evidence' : 'No canonical service binding'}</h3>
        </div>
        <span className="pp-tunnel-readonly">
          <ShieldCheck aria-hidden="true" />{' '}
          {serviceCapability?.supported ? 'Controls available' : 'Observation only'}
        </span>
      </div>
      <dl>
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="pp-tunnel-boundary-card">
        <ShieldCheck aria-hidden="true" />
        <div>
          <strong>Control boundary</strong>
          <p>
            {serviceCapability?.supported
              ? `Every service action requires confirmation. ProtoPeek is ${capabilities?.install.processElevated ? 'currently elevated' : 'not currently elevated'}.`
              : serviceCapability?.reason || 'Service actions are unavailable.'}{' '}
            The OS may show UAC or request sudo/admin authorization; ProtoPeek never asks for,
            receives, or stores your password.
          </p>
          <small>{serviceScope}</small>
        </div>
      </div>
    </div>
  );
}

function DiagnosticsPanel({
  deployment,
  snapshot,
  onNotice,
}: {
  deployment: TunnelDeployment;
  snapshot: TunnelSnapshot | null;
  onNotice: (value: string) => void;
}) {
  const checklist = [
    `${snapshot?.cloudflared.found ? 'PASS' : 'CHECK'} cloudflared executable`,
    deployment.boundToCanonicalService
      ? `${deployment.runtime.present ? 'PASS' : 'CHECK'} canonical service binding`
      : 'NOT APPLICABLE canonical service binding for this deployment',
    deployment.managementMode === 'remote'
      ? 'REMOTE Cloudflare account configuration authority'
      : `${deployment.configPath ? 'PASS' : 'CHECK'} attributed local config`,
    `${deployment.routes.length ? 'PASS' : 'CHECK'} ingress rules`,
    'NOT RUN metrics endpoint — no address assumed',
    'NOT RUN logs — no live tail started',
  ].join('\n');
  return (
    <div className="pp-tunnel-diagnostics-panel">
      <div className="pp-tunnel-diagnostic-card">
        <Activity aria-hidden="true" />
        <div>
          <span className="pp-tunnel-section-label">Metrics snapshot</span>
          <strong>Not queried</strong>
          <p>
            No effective local metrics address was proven, so ProtoPeek made no metrics request.
          </p>
        </div>
        <span>Not run</span>
      </div>
      <div className="pp-tunnel-diagnostic-card">
        <Terminal aria-hidden="true" />
        <div>
          <span className="pp-tunnel-section-label">Log snapshot</span>
          <strong>Not queried</strong>
          <p>ProtoPeek did not start a live tail or collect service logs during this inspection.</p>
        </div>
        <span>Not run</span>
      </div>
      <button
        type="button"
        className="pp-tunnel-copy-checklist"
        onClick={() => void copyText(checklist, onNotice)}
      >
        <Copy aria-hidden="true" /> Copy doctor checklist
      </button>
    </div>
  );
}

function HostToolEvidence({ snapshot }: { snapshot: TunnelSnapshot | null }) {
  const tools = [
    { label: 'cloudflared', tool: snapshot?.cloudflared, icon: Cloud },
    { label: 'Wrangler', tool: snapshot?.wrangler, icon: Code2 },
    { label: 'Docker CLI', tool: snapshot?.docker, icon: Box },
  ];
  return (
    <section className="pp-tunnel-tool-grid" aria-labelledby="tunnel-tools-heading">
      <header>
        <Wrench aria-hidden="true" />
        <div>
          <h3 id="tunnel-tools-heading">Local tool checks</h3>
          <p>Real PATH and version probes from this host; no bundled substitutes.</p>
        </div>
      </header>
      {tools.map(({ label, tool: observed, icon: Icon }) => (
        <article key={label}>
          <Icon aria-hidden="true" />
          <div>
            <strong>{label}</strong>
            <small>
              {observed?.version ||
                observed?.path ||
                observed?.note ||
                `${label} was not found on PATH.`}
            </small>
          </div>
          <span className={observed?.found ? 'is-found' : ''}>
            {observed?.found ? 'Found' : 'Not found'}
          </span>
        </article>
      ))}
    </section>
  );
}

function CanonicalServiceEvidence({
  service,
  capability,
  loading,
  onRequestAction,
}: {
  service: TunnelSnapshot['service'];
  capability: TunnelCapabilities['serviceControl'] | null;
  loading: boolean;
  onRequestAction: (action: TunnelServiceAction) => void;
}) {
  return (
    <section className="pp-tunnel-service-evidence" aria-labelledby="tunnel-service-heading">
      <header>
        <div>
          <span className="pp-tunnel-section-label">Canonical OS service</span>
          <h3 id="tunnel-service-heading">{service.label || 'cloudflared service'}</h3>
          <p>
            {service.detail ||
              (service.present
                ? `${service.manager || 'OS service manager'} reports ${statusLabel(service.state).toLowerCase()}.`
                : `${service.manager || 'The OS service manager'} did not find the canonical cloudflared service.`)}
          </p>
        </div>
        <span className={`pp-tunnel-proof ${service.present ? 'is-ok' : 'is-warning'}`}>
          {service.present ? <Check aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
          {service.present ? 'Installed' : 'Not installed'}
        </span>
      </header>
      <ServiceControls
        service={service}
        capability={capability}
        loading={loading}
        onRequestAction={onRequestAction}
      />
      {!service.present || !capability?.supported ? (
        <p className="pp-tunnel-control-reason">
          {service.present
            ? capability?.reason || 'Service control is unavailable in this runtime.'
            : 'Start, stop, and restart become available after the canonical service is installed and observed.'}
        </p>
      ) : null}
    </section>
  );
}

function ServiceControls({
  service,
  capability,
  loading,
  onRequestAction,
}: {
  service: TunnelSnapshot['service'];
  capability: TunnelCapabilities['serviceControl'] | null;
  loading: boolean;
  onRequestAction: (action: TunnelServiceAction) => void;
}) {
  const unavailable = !service.present || !capability?.supported || loading;
  const disabledReason = loading
    ? 'A service action is already in progress.'
    : !capability?.supported
      ? capability?.reason || 'Service control is unavailable.'
      : !service.present
        ? 'The canonical cloudflared service is not installed.'
        : 'Service control is unavailable.';
  const stable = stableServiceStates.has(service.state);
  const startEnabled = !unavailable && service.state === 'stopped';
  const stopEnabled = !unavailable && (service.state === 'running' || service.state === 'paused');
  const restartEnabled = !unavailable && stable;
  const stateReason = stable
    ? `This action is not valid while the service is ${service.state}.`
    : `Inspect again after the service reaches a stable state; it is currently ${service.state || 'unknown'}.`;
  return (
    <div className="pp-tunnel-service-actions" role="toolbar" aria-label="Service actions">
      <button
        type="button"
        disabled={!startEnabled}
        title={
          startEnabled
            ? 'Start the canonical cloudflared service'
            : unavailable
              ? disabledReason
              : stateReason
        }
        onClick={() => onRequestAction('start')}
      >
        <Play aria-hidden="true" /> Start
      </button>
      <button
        type="button"
        disabled={!stopEnabled}
        title={
          stopEnabled
            ? 'Stop the canonical cloudflared service'
            : unavailable
              ? disabledReason
              : stateReason
        }
        onClick={() => onRequestAction('stop')}
      >
        <Square aria-hidden="true" /> Stop
      </button>
      <button
        type="button"
        disabled={!restartEnabled}
        title={
          restartEnabled
            ? 'Restart the canonical cloudflared service'
            : unavailable
              ? disabledReason
              : stateReason
        }
        onClick={() => onRequestAction('restart')}
      >
        <RotateCw aria-hidden="true" /> Restart
      </button>
    </div>
  );
}

function ConfigCandidates({
  sources,
  hideHeader = false,
}: {
  sources: TunnelConfigSource[];
  hideHeader?: boolean;
}) {
  return (
    <section
      className={`pp-tunnel-config-candidates ${hideHeader ? 'is-embedded' : ''}`}
      aria-labelledby={hideHeader ? undefined : 'tunnel-config-candidates-heading'}
      aria-label={hideHeader ? 'Checked configuration candidates' : undefined}
    >
      {hideHeader ? null : (
        <header>
          <FileText aria-hidden="true" />
          <div>
            <h3 id="tunnel-config-candidates-heading">Documented configuration locations</h3>
            <p>Only these bounded candidates were checked; ProtoPeek did not crawl the disk.</p>
          </div>
          <span>{sources.length} checked</span>
        </header>
      )}
      {sources.length ? (
        <ul>
          {sources.map((source) => (
            <li key={source.id || `${source.source}:${source.path}`}>
              <div>
                <code>{source.path}</code>
                <small>{sourceLabel(source.source)}</small>
              </div>
              <span className={source.exists && source.readable ? 'is-found' : ''}>
                {configCandidateStatus(source)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pp-tunnel-control-reason">No configuration candidates were reported.</p>
      )}
    </section>
  );
}

function ReleasePanel({
  release,
  loading,
  error,
  installedVersion,
  onCheck,
}: {
  release: TunnelRelease | null;
  loading: boolean;
  error: string;
  installedVersion: string;
  onCheck: () => void;
}) {
  return (
    <section className="pp-tunnel-release" aria-labelledby="tunnel-release-heading">
      <header>
        <div>
          <span className="pp-tunnel-section-label">Release freshness</span>
          <h3 id="tunnel-release-heading">cloudflared version</h3>
          <p>Contacts GitHub Releases only when you click the check button.</p>
        </div>
        <button type="button" disabled={loading} onClick={onCheck}>
          <RefreshCw aria-hidden="true" className={loading ? 'is-spinning' : ''} />
          {loading ? 'Checking…' : 'Check latest version'}
        </button>
      </header>
      <dl>
        <div>
          <dt>Installed</dt>
          <dd>{release?.installedVersion || installedVersion || 'Not installed'}</dd>
        </div>
        <div>
          <dt>Latest</dt>
          <dd>{release?.latestVersion || 'Not checked'}</dd>
        </div>
        <div>
          <dt>Published</dt>
          <dd>{release?.publishedAt ? formatTimestamp(release.publishedAt) : 'Not checked'}</dd>
        </div>
        <div>
          <dt>Freshness</dt>
          <dd>{release ? releaseStatusLabel(release.status) : 'Not checked'}</dd>
        </div>
        <div>
          <dt>Support</dt>
          <dd>{release ? supportStatusLabel(release.supportStatus) : 'Not checked'}</dd>
        </div>
        <div>
          <dt>Checked</dt>
          <dd>{release?.checkedAt ? formatTimestamp(release.checkedAt) : 'Never'}</dd>
        </div>
      </dl>
      {release?.note || error ? (
        <p
          className={`pp-tunnel-release-note ${error ? 'is-error' : ''}`}
          role={error ? 'alert' : 'status'}
        >
          {error || release?.note}
        </p>
      ) : null}
      {release?.releaseUrl || release?.downloadsUrl ? (
        <div className="pp-tunnel-external-links">
          {release.releaseUrl ? (
            <a href={release.releaseUrl} target="_blank" rel="noreferrer noopener">
              Release details <ExternalLink aria-hidden="true" />
            </a>
          ) : null}
          {release.downloadsUrl ? (
            <a href={release.downloadsUrl} target="_blank" rel="noreferrer noopener">
              Official downloads <ExternalLink aria-hidden="true" />
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function InstallPanel({
  capabilities,
  cloudflaredFound,
  onNotice,
}: {
  capabilities: TunnelCapabilities | null;
  cloudflaredFound: boolean;
  onNotice: (value: string) => void;
}) {
  const install = capabilities?.install;
  if (!install) return null;
  return (
    <section className="pp-tunnel-install" aria-labelledby="tunnel-install-heading">
      <header>
        <Download aria-hidden="true" />
        <div>
          <span className="pp-tunnel-section-label">Official setup</span>
          <h3 id="tunnel-install-heading">
            {cloudflaredFound ? 'Install or update cloudflared' : 'Install cloudflared'}
          </h3>
          <p>
            Suggested for {platformLabel(install.platform)} · {install.architecture}. ProtoPeek
            never runs these commands automatically.
          </p>
        </div>
      </header>
      <div className="pp-tunnel-external-links">
        {install.downloadsUrl ? (
          <a href={install.downloadsUrl} target="_blank" rel="noreferrer noopener">
            Cloudflare Downloads <ExternalLink aria-hidden="true" />
          </a>
        ) : null}
        {install.releasesUrl ? (
          <a href={install.releasesUrl} target="_blank" rel="noreferrer noopener">
            GitHub Releases <ExternalLink aria-hidden="true" />
          </a>
        ) : null}
        {install.serviceDocsUrl ? (
          <a href={install.serviceDocsUrl} target="_blank" rel="noreferrer noopener">
            Service documentation <ExternalLink aria-hidden="true" />
          </a>
        ) : null}
      </div>
      {install.commands.length ? (
        <div className="pp-tunnel-command-list">
          {install.commands.map((item) => (
            <div key={item.id}>
              <span>
                <strong>{item.label}</strong>
                {item.requiresElevation ? <small>May require OS authorization</small> : null}
              </span>
              <code>{item.command}</code>
              <button
                type="button"
                aria-label={`Copy ${item.label}`}
                onClick={() => void copyText(item.command, onNotice)}
              >
                <Copy aria-hidden="true" /> Copy
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="pp-tunnel-privilege-note">
        <ShieldCheck aria-hidden="true" />
        <div>
          <strong>
            ProtoPeek is {install.processElevated ? 'currently elevated' : 'not currently elevated'}
          </strong>
          <p>
            {displayElevationNotice(install.elevationNotice) ||
              'Your operating system may show UAC or request sudo/admin authorization.'}{' '}
            ProtoPeek never asks for, receives, or stores your password.
          </p>
        </div>
      </div>
    </section>
  );
}

function ServiceActionFeedback({
  result,
  onNotice,
}: {
  result: TunnelServiceActionResult;
  onNotice: (value: string) => void;
}) {
  const isFailure = result.status === 'failed' || result.status === 'stale';
  return (
    <section
      className={`pp-tunnel-action-result is-${result.status}`}
      role={isFailure ? 'alert' : 'status'}
      aria-label="Service action result"
    >
      {result.status === 'completed' || result.status === 'unchanged' ? (
        <CheckCircle2 aria-hidden="true" />
      ) : (
        <AlertTriangle aria-hidden="true" />
      )}
      <div>
        <strong>{serviceActionStatusLabel(result.status)}</strong>
        <p>{result.message || 'The service manager returned no additional detail.'}</p>
        {result.status === 'stale' ? (
          <small>Inspect the host again before retrying this action.</small>
        ) : null}
        {result.manualCommand ? (
          <div className="pp-tunnel-manual-command">
            <span>
              Run this command in your own terminal
              {result.elevationMechanism ? ` (${result.elevationMechanism})` : ''}:
            </span>
            <code>{result.manualCommand}</code>
            <button type="button" onClick={() => void copyText(result.manualCommand, onNotice)}>
              <Copy aria-hidden="true" /> Copy command
            </button>
          </div>
        ) : null}
        {result.elevationRequired ? (
          <small>
            The OS may request UAC, sudo, or administrator authorization. ProtoPeek never asks for,
            receives, or stores your password.
          </small>
        ) : null}
      </div>
    </section>
  );
}

function EmptyDetail({
  snapshot,
  capabilities,
  loading,
  error,
  onRefresh,
  release,
  releaseLoading,
  releaseError,
  onCheckRelease,
  onNotice,
  serviceActionLoading,
  serviceActionResult,
  onRequestAction,
}: {
  snapshot: TunnelSnapshot | null;
  capabilities: TunnelCapabilities | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  release: TunnelRelease | null;
  releaseLoading: boolean;
  releaseError: string;
  onCheckRelease: () => void;
  onNotice: (value: string) => void;
  serviceActionLoading: boolean;
  serviceActionResult: TunnelServiceActionResult | null;
  onRequestAction: (action: TunnelServiceAction) => void;
}) {
  if (loading)
    return (
      <div className="pp-tunnel-detail-loading">
        <RefreshCw aria-hidden="true" className="is-spinning" />
        <strong>Inspecting documented local sources…</strong>
        <p>No recursive disk search and no background process.</p>
      </div>
    );
  const inspected = Boolean(snapshot);
  return (
    <div className={`pp-tunnel-setup ${inspected ? 'is-inspected' : ''}`}>
      <header className="pp-tunnel-setup-heading">
        <span className="pp-tunnel-setup-icon">
          <Cloud aria-hidden="true" />
        </span>
        <div>
          <span className="pp-tunnel-kicker">Local host</span>
          <h2>
            {error
              ? 'Tunnel inspection is unavailable here'
              : inspected
                ? 'Host inspection complete'
                : 'Inspect this host for cloudflared'}
          </h2>
          <p>
            {error ||
              (inspected
                ? `Actual checks completed on this ${capabilities?.platform || 'local'} host. ProtoPeek changed nothing.`
                : 'Run a bounded, one-time check of the real host. No network release check, installation, file change, or service action runs automatically.')}
          </p>
        </div>
        <button
          type="button"
          className="pp-tunnel-button pp-tunnel-button-primary"
          onClick={onRefresh}
        >
          <RefreshCw aria-hidden="true" />{' '}
          {inspected || error ? 'Inspect again' : 'Inspect this host'}
        </button>
      </header>

      {!inspected ? (
        <section className="pp-tunnel-inspection-scope" aria-labelledby="inspection-scope-heading">
          <div>
            <span className="pp-tunnel-section-label">One bounded inspection</span>
            <h3 id="inspection-scope-heading">What ProtoPeek will check</h3>
            <p>All checks are local and read-only. GitHub is not contacted during inspection.</p>
          </div>
          <ul>
            <li>
              <Cloud aria-hidden="true" /> cloudflared binary, path, and installed version
            </li>
            <li>
              <Terminal aria-hidden="true" /> Canonical OS service registration and state
            </li>
            <li>
              <FileText aria-hidden="true" /> Documented system and user config locations
            </li>
            <li>
              <Wrench aria-hidden="true" /> Wrangler and Docker CLI availability
            </li>
          </ul>
        </section>
      ) : null}

      {snapshot ? (
        <div className="pp-tunnel-host-evidence">
          <section className="pp-tunnel-next-step" aria-labelledby="tunnel-next-step-heading">
            <header>
              <span className="pp-tunnel-section-label">Highest-priority next action</span>
              <h3 id="tunnel-next-step-heading">
                {snapshot.cloudflared.found
                  ? 'Finish the local tunnel setup'
                  : 'Install cloudflared first'}
              </h3>
              <p>
                {snapshot.cloudflared.found
                  ? 'The binary is available, but no manageable deployment was observed yet.'
                  : 'Use an official Cloudflare source, then inspect this host again.'}
              </p>
            </header>
            <InstallPanel
              capabilities={capabilities}
              cloudflaredFound={snapshot.cloudflared.found}
              onNotice={onNotice}
            />
          </section>
          {serviceActionResult ? (
            <ServiceActionFeedback result={serviceActionResult} onNotice={onNotice} />
          ) : null}
          <div className="pp-tunnel-readiness-grid">
            <CanonicalServiceEvidence
              service={snapshot.service}
              capability={capabilities?.serviceControl ?? null}
              loading={serviceActionLoading}
              onRequestAction={onRequestAction}
            />
            <ReleasePanel
              release={release}
              loading={releaseLoading}
              error={releaseError}
              installedVersion={snapshot.cloudflared.version}
              onCheck={onCheckRelease}
            />
          </div>
          <HostToolEvidence snapshot={snapshot} />
          <details className="pp-tunnel-progressive">
            <summary>
              <span>
                <FileText aria-hidden="true" /> Configuration evidence
              </span>
              <small>{snapshot.configSources.length} documented paths checked</small>
            </summary>
            <p>ProtoPeek checked only these bounded paths and did not crawl the disk.</p>
            <ConfigCandidates sources={snapshot.configSources} hideHeader />
          </details>
          {snapshot.notes.length ? (
            <details className="pp-tunnel-progressive is-notes">
              <summary>
                <span>
                  <AlertTriangle aria-hidden="true" /> Inspection notes
                </span>
                <small>{snapshot.notes.length}</small>
              </summary>
              <EvidenceWarnings warnings={snapshot.notes} />
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ServiceActionDialog({
  action,
  service,
  loading,
  onCancel,
  onConfirm,
}: {
  action: TunnelServiceAction;
  service: TunnelSnapshot['service'];
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const label = actionLabel(action);
  useEffect(() => {
    confirmRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [loading, onCancel]);

  return (
    <div className="pp-tunnel-dialog-layer" role="presentation">
      <button
        type="button"
        className="pp-tunnel-dialog-backdrop"
        aria-label="Cancel service action"
        disabled={loading}
        onClick={onCancel}
      />
      <section
        className="pp-tunnel-service-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tunnel-service-dialog-title"
      >
        <header>
          <span className="pp-tunnel-dialog-icon">
            <Terminal aria-hidden="true" />
          </span>
          <div>
            <span className="pp-tunnel-section-label">OS service action</span>
            <h2 id="tunnel-service-dialog-title">Confirm {label.toLowerCase()}</h2>
          </div>
        </header>
        <p>
          ProtoPeek will ask {service.manager || 'the operating system service manager'} to {action}{' '}
          <strong>{service.label || 'cloudflared'}</strong>. The last observed state was{' '}
          <strong>{statusLabel(service.state).toLowerCase()}</strong>.
        </p>
        <div className="pp-tunnel-dialog-warning">
          <AlertTriangle aria-hidden="true" />
          <p>
            <strong>This can interrupt active tunnel connections.</strong>
            <span>
              Your OS may show UAC or request sudo/admin authorization. ProtoPeek never asks for,
              receives, or stores your password.
            </span>
          </p>
        </div>
        <footer>
          <button type="button" disabled={loading} onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="is-primary"
            disabled={loading}
            onClick={onConfirm}
          >
            {loading ? <RefreshCw aria-hidden="true" className="is-spinning" /> : null}
            {loading ? `${label}…` : `Confirm ${label.toLowerCase()}`}
          </button>
        </footer>
      </section>
    </div>
  );
}

function HistoryDrawer({ events, onClose }: { events: PlanEvent[]; onClose: () => void }) {
  return (
    <div className="pp-tunnel-drawer-layer" role="presentation">
      <button
        type="button"
        className="pp-tunnel-drawer-backdrop"
        aria-label="Close change history"
        onClick={onClose}
      />
      <aside
        className="pp-tunnel-drawer is-history"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tunnel-history-title"
      >
        <header>
          <div>
            <span className="pp-tunnel-kicker">Local session</span>
            <h2 id="tunnel-history-title">Change history</h2>
            <p>Drafts only; no host mutation receipts.</p>
          </div>
          <button type="button" aria-label="Close change history" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="pp-tunnel-history-list">
          {events.length ? (
            events.map((event) => (
              <article key={event.id}>
                <span>
                  <Check aria-hidden="true" />
                </span>
                <div>
                  <strong>{event.summary}</strong>
                  <p>
                    {event.deployment} · {formatTimestamp(event.createdAt)}
                  </p>
                </div>
                <em>Draft</em>
              </article>
            ))
          ) : (
            <div className="pp-tunnel-inline-empty">
              <History aria-hidden="true" />
              <div>
                <strong>No draft activity yet</strong>
                <p>Reviewed apply receipts will appear here in a later security phase.</p>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function DeploymentSkeleton() {
  return (
    <div className="pp-tunnel-skeleton" role="status" aria-label="Loading tunnel deployments">
      <span />
      <span />
      <span />
    </div>
  );
}

function EvidenceWarnings({ warnings }: { warnings: string[] }) {
  return (
    <div className="pp-tunnel-evidence-warnings">
      <header>
        <AlertTriangle aria-hidden="true" />
        <strong>Evidence notes</strong>
      </header>
      {warnings.slice(0, 8).map((warning) => (
        <p key={warning}>{warning}</p>
      ))}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  return (
    <span className={`pp-tunnel-status-dot is-${status}`} aria-hidden="true">
      <Circle />
    </span>
  );
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    running: 'Connected',
    stopped: 'Stopped',
    starting: 'Starting',
    stopping: 'Stopping',
    paused: 'Paused',
    observed: 'Observed',
    'not-applicable': 'Not applicable',
    unavailable: 'Unavailable',
    unknown: 'Unknown',
  };
  return labels[status] ?? 'Unknown';
}

function managementLabel(mode: string) {
  if (mode === 'remote') return 'Remote managed';
  if (mode === 'local') return 'Local YAML';
  return 'Authority unknown';
}

function driverLabel(driver: string) {
  if (driver === 'system-service') return 'System service';
  if (driver === 'config-only') return 'Unmanaged config';
  if (driver === 'owned-child') return 'ProtoPeek process';
  if (driver === 'compose-profile') return 'Compose profile';
  return 'Observed deployment';
}

function deploymentServiceScope(deployment: TunnelDeployment) {
  if (deployment.driver === 'config-only')
    return 'Configuration-only deployment; it is not bound to the canonical host service.';
  if (deployment.driver === 'compose-profile')
    return 'Compose-managed deployment; manage its process through Docker Compose.';
  if (deployment.driver === 'owned-child')
    return 'ProtoPeek-owned child process; canonical host service controls do not apply.';
  if (deployment.managementMode === 'remote')
    return 'Remote-managed deployment; no canonical host service binding was reported.';
  return 'This deployment is not bound to the canonical host service.';
}

function sameLocalPath(left: string, right: string) {
  if (!left || !right) return false;
  return left.replaceAll('\\', '/') === right.replaceAll('\\', '/');
}

function hostnameRouteLabel(routes: Array<TunnelRoute | PlannedRoute>) {
  const count = routes.filter((route) => !route.catchAll).length;
  return `${count} hostname route${count === 1 ? '' : 's'}`;
}

function routeCountLabel(routes: Array<TunnelRoute | PlannedRoute>) {
  const catchAll = routes.some((route) => route.catchAll);
  const drafts = routes.filter((route) => 'planned' in route && route.planned).length;
  const parts = [hostnameRouteLabel(routes), catchAll ? '+ catch-all' : '· no catch-all'];
  if (drafts) parts.push(`· ${drafts} draft${drafts === 1 ? '' : 's'}`);
  return parts.join(' ');
}

function routeCountFromSource(source: TunnelConfigSource) {
  const hostnameRoutes = Math.max(0, source.routeCount - (source.catchAllPresent ? 1 : 0));
  return `${hostnameRoutes} hostname route${hostnameRoutes === 1 ? '' : 's'}${source.catchAllPresent ? ' + catch-all' : ' · no catch-all'}`;
}

function sourceLabel(source: string) {
  if (source === 'service-argument') return 'Explicit service argument';
  if (source === 'system-default') return 'System default';
  if (source === 'user-default') return 'User default';
  return source || 'Observed source';
}

function configCandidateStatus(source: TunnelConfigSource) {
  if (!source.exists) return 'Checked · not found';
  if (!source.readable) return 'Present · unreadable';
  if (!source.regular) return 'Present · not a regular file';
  if (!source.valid) return 'Present · invalid';
  if (source.effective) return 'Parsed · effective';
  return 'Parsed · not active';
}

function releaseStatusLabel(status: TunnelRelease['status']) {
  const labels: Record<TunnelRelease['status'], string> = {
    'not-installed': 'Not installed',
    current: 'Current',
    'update-available': 'Update available',
    newer: 'Newer than latest release',
    unknown: 'Unknown',
  };
  return labels[status];
}

function supportStatusLabel(status: TunnelRelease['supportStatus']) {
  const labels: Record<TunnelRelease['supportStatus'], string> = {
    supported: 'Supported',
    'out-of-support': 'Out of support',
    unknown: 'Unknown',
    'not-installed': 'Not installed',
  };
  return labels[status];
}

function serviceActionStatusLabel(status: TunnelServiceActionResult['status']) {
  const labels: Record<TunnelServiceActionResult['status'], string> = {
    completed: 'Service action completed',
    unchanged: 'Service state already matched',
    'elevation-required': 'OS authorization required',
    'not-installed': 'Canonical service not installed',
    stale: 'Service state changed',
    failed: 'Service action failed',
  };
  return labels[status];
}

function actionLabel(action: TunnelServiceAction) {
  if (action === 'start') return 'Start';
  if (action === 'stop') return 'Stop';
  return 'Restart';
}

function platformLabel(platform: string) {
  if (platform === 'windows') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  if (platform === 'linux') return 'Linux';
  return platform || 'this operating system';
}

function displayElevationNotice(notice: string) {
  const cleaned = notice.replace(/[;,]?\s*ProtoPeek never asks for a password\.?\s*$/i, '').trim();
  return cleaned && !/[.!?]$/.test(cleaned) ? `${cleaned}.` : cleaned;
}

function formatObserved(value: string) {
  const age = Date.now() - Date.parse(value);
  if (Number.isFinite(age) && age >= 0 && age < 60_000) return 'just now';
  return formatTimestamp(value);
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'time unavailable';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    date
  );
}

function handleTabKey(
  event: KeyboardEvent<HTMLButtonElement>,
  active: TunnelTab,
  setActive: (tab: TunnelTab) => void
) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  const index = tunnelTabs.findIndex((tab) => tab.id === active);
  const offset = event.key === 'ArrowRight' ? 1 : -1;
  const next = tunnelTabs[(index + offset + tunnelTabs.length) % tunnelTabs.length];
  setActive(next.id);
  requestAnimationFrame(() => document.getElementById(`tunnel-tab-${next.id}`)?.focus());
}

async function copyText(value: string, onNotice: (value: string) => void) {
  try {
    await navigator.clipboard.writeText(value);
    onNotice('Copied to the clipboard.');
  } catch {
    onNotice('Clipboard access was unavailable.');
  }
}
