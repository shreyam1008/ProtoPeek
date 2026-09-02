import {
  Activity,
  AlertTriangle,
  Box,
  Cloud,
  Code2,
  Copy,
  FileText,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Wrench,
} from 'lucide-react';
import { StatusFact } from '@/console/evidence/StatusFact';
import type {
  TunnelCapabilities,
  TunnelDeployment,
  TunnelRelease,
  TunnelServiceAction,
  TunnelServiceActionResult,
  TunnelSnapshot,
} from '@/console/tunnels-api';
import { ConfigCandidates } from './ConfigEvidence';
import { ServiceActionFeedback, ServiceActions } from './ServiceActions';
import { InstallPanel, VersionCheck } from './VersionCheck';
import { copyText, hostnameRouteLabel, managementLabel, statusLabel } from './view-helpers';

export function HostSummary({
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
      <VersionCheck
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

export function RuntimeEvidence({
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
          <StatusFact key={label} label={label} value={value} />
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

export function DiagnosticsEvidence({
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

export function EmptyHostSummary({
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
            <ServiceActions
              service={snapshot.service}
              capability={capabilities?.serviceControl ?? null}
              loading={serviceActionLoading}
              onRequestAction={onRequestAction}
            />
            <VersionCheck
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
