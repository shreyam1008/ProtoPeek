import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Cloud,
  Gauge,
  History,
  Plus,
  RefreshCw,
  Route as RouteIcon,
  Search,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';
import {
  type KeyboardEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';

import { handoffEvidence } from '@/console/app/handoff-display';
import {
  type ConsumedHandoffFor,
  consumePendingHandoff,
  formatHostPort,
} from '@/console/app/handoff-store';
import type { LocalServiceRef } from '@/console/app/handoff-types';
import { protocolShellEvents, useProtocolShell } from '@/console/ProtocolShellContext';
import { type PlannedTunnelRoute, scanResultFromTunnelRoute } from '@/console/tunnels/route-plan';
import {
  fetchTunnelRelease,
  performTunnelServiceAction,
  type TunnelCapabilities,
  type TunnelDeployment,
  type TunnelRelease,
  type TunnelServiceAction,
  type TunnelServiceActionResult,
  type TunnelSnapshot,
} from '@/console/tunnels-api';
import { DiagnosticsEvidence, EmptyHostSummary, HostSummary, RuntimeEvidence } from './HostSummary';
import { IngressEvidence, IngressHandoffs } from './IngressEvidence';
import { ServiceActionDialog, ServiceActionFeedback, ServiceControls } from './ServiceActions';
import { useCloudflareObservation } from './useCloudflareObservation';
import {
  deploymentServiceScope,
  driverLabel,
  formatObserved,
  formatTimestamp,
  managementLabel,
  routeCountLabel,
  statusLabel,
} from './view-helpers';

type TunnelTab = 'overview' | 'routes' | 'runtime' | 'diagnostics';
type DeploymentFilter = 'all' | 'running' | 'stopped';
type MobilePane = 'deployments' | 'details';
type PlannedRoute = PlannedTunnelRoute;
type PlanEvent = { id: string; deployment: string; summary: string; createdAt: string };
type PublishOriginHandoff = ConsumedHandoffFor<'publish-origin-draft'>;

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
const RoutePlanner = lazy(() => import('@/console/tunnels/RoutePlanner'));

function localOriginURL(origin: LocalServiceRef) {
  const scheme =
    origin.protocol === 'grpc' || origin.protocol === 'grpcs' ? 'tcp' : origin.protocol;
  return `${scheme}://${formatHostPort(origin.host, origin.port)}`;
}

function localOriginContext(handoff: PublishOriginHandoff) {
  const origin = handoff.draft.origin;
  const bind = origin.bind.wildcard ? `${origin.bind.address} (wildcard)` : origin.bind.address;
  const inferred = origin.bind.wildcard
    ? ` The local draft uses ${origin.host}; wildcard reachability was not assumed.`
    : '';
  return `${handoffEvidence(handoff.provenance, handoff.storage === 'memory')}. TCP bind ${bind}, ${origin.exposure}.${inferred} The public hostname remains empty and nothing has been applied.`;
}

export function CloudflareRoute() {
  const shell = useProtocolShell();
  const [selectedRouteID, setSelectedRouteID] = useState('');
  const [filter, setFilter] = useState<DeploymentFilter>('all');
  const [activeTab, setActiveTab] = useState<TunnelTab>('routes');
  const [mobilePane, setMobilePane] = useState<MobilePane>('details');
  const [notice, setNotice] = useState('');
  const [pendingOrigin, setPendingOrigin] = useState<PublishOriginHandoff | null>(null);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [plannerOrigin, setPlannerOrigin] = useState<PublishOriginHandoff | null>(null);
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
  const releaseRequestRef = useRef<AbortController | null>(null);
  const actionRequestRef = useRef<AbortController | null>(null);
  const actionGenerationRef = useRef(0);
  const plannerReturnFocusRef = useRef<HTMLElement | null>(null);
  const plannerDeploymentRef = useRef('');

  const handleSelectionReconciled = useCallback(() => {
    actionGenerationRef.current++;
    setServiceActionResult(null);
    setPendingServiceAction(null);
  }, []);
  const {
    capabilities,
    error,
    getSelectedID,
    load,
    loading,
    refreshing,
    selectedID,
    selectDeployment: selectObservedDeployment,
    snapshot,
  } = useCloudflareObservation(handleSelectionReconciled);

  const openPlanner = useCallback(
    (origin: PublishOriginHandoff | null = null) => {
      const active = document.activeElement;
      plannerReturnFocusRef.current =
        active instanceof HTMLElement && active !== document.body
          ? active
          : document.getElementById('tunnels-title');
      plannerDeploymentRef.current = selectedID;
      setPlannerOrigin(origin);
      setPlannerOpen(true);
    },
    [selectedID]
  );

  const closePlanner = useCallback(() => {
    setPlannerOpen(false);
    setPlannerOrigin(null);
    plannerDeploymentRef.current = '';
  }, []);

  useEffect(() => {
    const previous = plannerReturnFocusRef.current;
    if (plannerOpen || !previous) return;
    plannerReturnFocusRef.current = null;
    (previous.isConnected ? previous : document.getElementById('tunnels-title'))?.focus();
  }, [plannerOpen]);

  const applyPendingOrigin = useEffectEvent(() => {
    const handoff = consumePendingHandoff('publish-origin-draft');
    if (!handoff) return;
    setPlannerOpen(false);
    setPlannerOrigin(null);
    setPendingOrigin(handoff);
  });

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
      const generation = actionGenerationRef.current + 1;
      actionGenerationRef.current = generation;
      const deploymentID = getSelectedID();
      setServiceActionLoading(true);
      try {
        const result = await performTunnelServiceAction(
          action,
          snapshot.service.state,
          controller.signal
        );
        if (
          !mountedRef.current ||
          controller.signal.aborted ||
          actionRequestRef.current !== controller
        )
          return;
        if (actionGenerationRef.current === generation && getSelectedID() === deploymentID) {
          setServiceActionResult(result);
          setPendingServiceAction(null);
        }
        if (result.status === 'completed' || result.status === 'unchanged') await load();
      } catch (cause) {
        if (
          !mountedRef.current ||
          controller.signal.aborted ||
          actionRequestRef.current !== controller ||
          actionGenerationRef.current !== generation ||
          getSelectedID() !== deploymentID
        )
          return;
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
    [getSelectedID, load, serviceActionLoading, snapshot]
  );

  useEffect(() => {
    mountedRef.current = true;
    applyPendingOrigin();
    window.addEventListener(protocolShellEvents.pendingHandoff, applyPendingOrigin);
    return () => {
      mountedRef.current = false;
      releaseRequestRef.current?.abort();
      actionRequestRef.current?.abort();
      window.removeEventListener(protocolShellEvents.pendingHandoff, applyPendingOrigin);
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
    if (plannerOpen && (!selected || selected.id !== plannerDeploymentRef.current)) closePlanner();
  }, [closePlanner, plannerOpen, selected]);

  useEffect(() => {
    if (selectedRoute && selectedRoute.id !== selectedRouteID) setSelectedRouteID(selectedRoute.id);
    if (!selectedRoute && selectedRouteID) setSelectedRouteID('');
  }, [selectedRoute, selectedRouteID]);

  function selectDeployment(id: string) {
    if (id !== getSelectedID()) actionGenerationRef.current++;
    selectObservedDeployment(id);
    setSelectedRouteID('');
    setMobilePane('details');
    setNotice('');
    setServiceActionResult(null);
    setPendingServiceAction(null);
  }

  function addPlannedRoute(route: PlannedRoute) {
    if (!selected) return;
    if (plannerOrigin) setPendingOrigin(null);
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
    const result = scanResultFromTunnelRoute(selectedRoute, kind, snapshot?.observedAt);
    if (!result) {
      setNotice(
        `This ${selectedRoute.protocol || 'unknown'} origin cannot be opened in the ${kind.toUpperCase()} workbench.`
      );
      return;
    }
    const handoff =
      kind === 'http' ? shell.openHTTPDiscovery(result) : shell.openGRPCDiscovery(result);
    if (handoff && !handoff.ok) setNotice(handoff.error);
  }

  const observedLabel = snapshot ? formatObserved(snapshot.observedAt) : 'Not observed';

  return (
    <section className="pp-tunnels" aria-labelledby="tunnels-title">
      <header className="pp-tunnel-page-heading">
        <div>
          <span className="pp-tunnel-kicker">Tunnels / local host</span>
          <div className="pp-tunnel-title-row">
            <h1 id="tunnels-title" tabIndex={-1}>
              Tunnel operations
            </h1>
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

      {pendingOrigin ? (
        <aside className="pp-tunnel-origin-handoff" role="status">
          <RouteIcon aria-hidden="true" />
          <div>
            <strong>Local origin draft ready</strong>
            <p>{localOriginContext(pendingOrigin)}</p>
          </div>
          <div className="pp-tunnel-origin-handoff-actions">
            <button
              type="button"
              className="pp-tunnel-button pp-tunnel-button-primary"
              disabled={refreshing || !selected || !capabilities?.routePlanPreview.supported}
              onClick={() => openPlanner(pendingOrigin)}
            >
              {selected ? 'Continue draft' : 'Inspect host first'}
            </button>
            <button
              type="button"
              className="pp-tunnel-button pp-tunnel-button-secondary"
              onClick={() => {
                document.getElementById('tunnels-title')?.focus();
                setPendingOrigin(null);
              }}
            >
              Dismiss
            </button>
          </div>
        </aside>
      ) : null}

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
              disabled={refreshing || !selected || !capabilities?.routePlanPreview.supported}
              onClick={() => openPlanner()}
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
                      <HostSummary
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
                      <IngressEvidence
                        deployment={selected}
                        routes={visibleRoutes}
                        selectedRouteID={selectedRoute?.id ?? ''}
                        configSources={snapshot?.configSources ?? []}
                        onSelectRoute={setSelectedRouteID}
                        onAdd={() => openPlanner()}
                        addDisabled={refreshing}
                        onRemoveDraft={removePlannedRoute}
                        onNotice={setNotice}
                      />
                    ) : null}
                    {activeTab === 'runtime' ? (
                      <RuntimeEvidence
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
                      <DiagnosticsEvidence
                        deployment={selected}
                        snapshot={snapshot}
                        onNotice={setNotice}
                      />
                    ) : null}
                  </div>
                  <IngressHandoffs
                    route={selectedRoute}
                    onHandoff={handoffRoute}
                    onViewHistory={() => setHistoryOpen(true)}
                  />
                </>
              ) : null}
            </article>
          </div>
        </>
      ) : (
        <EmptyHostSummary
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
        <Suspense
          fallback={
            <p className="pp-tunnel-inline-empty" role="status">
              Opening route planner...
            </p>
          }
        >
          <RoutePlanner
            key={plannerOrigin?.id ?? 'manual'}
            deployment={selected}
            initialService={plannerOrigin ? localOriginURL(plannerOrigin.draft.origin) : undefined}
            initialContext={plannerOrigin ? localOriginContext(plannerOrigin) : undefined}
            onClose={closePlanner}
            onSave={addPlannedRoute}
          />
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

function StatusDot({ status }: { status: string }) {
  return (
    <span className={`pp-tunnel-status-dot is-${status}`} aria-hidden="true">
      <Circle />
    </span>
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
