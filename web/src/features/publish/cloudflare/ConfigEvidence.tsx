import { AlertTriangle, Check, Cloud, FileText } from 'lucide-react';
import type { TunnelConfigSource, TunnelDeployment } from '@/console/tunnels-api';

export function attributedConfigSource(
  deployment: TunnelDeployment,
  configSources: TunnelConfigSource[]
) {
  if (deployment.managementMode === 'remote') return undefined;
  return configSources.find((source) => {
    if (deployment.configSourceId) return source.id === deployment.configSourceId;
    return sameLocalPath(source.path, deployment.configPath);
  });
}

export function ConfigEvidence({
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

export function ConfigCandidates({
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

function sameLocalPath(left: string, right: string) {
  if (!left || !right) return false;
  return left.replaceAll('\\', '/') === right.replaceAll('\\', '/');
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
