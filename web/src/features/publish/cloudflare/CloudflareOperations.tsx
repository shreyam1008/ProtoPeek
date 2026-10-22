import { useEffect, useRef, useState } from 'react';
import type { TunnelDeployment } from '@/console/tunnels-api';
import { type CanonicalPlan, type CanonicalResult, canonicalOperation } from './canonical-api';
import {
  forgetCanonicalPlan,
  recoverCanonicalPlan,
  rememberCanonicalPlan,
} from './canonical-plan-store';
import './canonical-operations.css';

export function CloudflareOperations({
  deployment,
  writable,
  onRefresh,
}: {
  deployment: TunnelDeployment;
  writable: boolean;
  onRefresh: () => void;
}) {
  const [revision, setRevision] = useState(deployment.configRevision);
  const revisionRef = useRef(deployment.configRevision);
  const [result, setResult] = useState<CanonicalResult | null>(null);
  const [plan, setPlan] = useState<CanonicalPlan | null>(() =>
    recoverCanonicalPlan(deployment.configPath, deployment.configRevision)
  );
  const [retentionWarning, setRetentionWarning] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [url, setURL] = useState('');
  const [hostname, setHostname] = useState('');
  const [path, setPath] = useState('');
  const [service, setService] = useState('http://127.0.0.1:8080');
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    []
  );
  useEffect(() => {
    if (deployment.configRevision === revisionRef.current) return;
    active.current?.abort();
    active.current = null;
    setBusy('');
    revisionRef.current = deployment.configRevision;
    setRevision(deployment.configRevision);
    setPlan(recoverCanonicalPlan(deployment.configPath, deployment.configRevision));
    setResult(null);
    setConfirmed(false);
    setError('Config observation changed. Review before continuing.');
  }, [deployment.configPath, deployment.configRevision]);
  const eligible =
    deployment.boundToCanonicalService &&
    deployment.managementMode === 'local' &&
    Boolean(deployment.configPath && revision);
  const run = async (operation: string) => {
    if (active.current || !eligible) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(operation);
    setError('');
    setConfirmed(false);
    try {
      const response = await canonicalOperation(
        {
          operation,
          configPath: deployment.configPath,
          revision,
          url,
          route: { hostname, path, service },
          planId: plan?.id,
          confirmed,
        },
        controller.signal
      );
      if (active.current !== controller) return;
      setResult(response);
      if (response.plan) {
        setPlan(response.plan);
        setRetentionWarning(
          rememberCanonicalPlan(response.plan)
            ? ''
            : 'Session storage is unavailable. Keep this view open to retain the rollback reference.'
        );
      }
      if (response.receipt?.afterRevision) {
        revisionRef.current = response.receipt.afterRevision;
        setRevision(response.receipt.afterRevision);
      }
      if (response.receipt) onRefresh();
      if (['stale', 'rollback-required', 'rollback-unverified'].includes(response.status)) {
        if (plan) forgetCanonicalPlan(plan.id);
        setPlan(null);
      }
    } catch (failure) {
      if (active.current === controller) {
        setError(failure instanceof Error ? failure.message : 'Canonical operation failed.');
        setPlan(null);
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy('');
      }
    }
  };
  const cancel = () => {
    active.current?.abort();
    active.current = null;
    setBusy('');
    setPlan(null);
    setError(
      'Stopped waiting. A file change may already have completed. Refresh host and inspect the canonical file before another change.'
    );
  };
  const invalidate = () => {
    setPlan(null);
    setConfirmed(false);
  };
  const download = () => {
    if (result?.operation !== 'report' || result.status !== 'completed' || !result.data) return;
    const object = URL.createObjectURL(
      new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' })
    );
    const link = document.createElement('a');
    link.href = object;
    link.download = 'protopeek-cloudflare-evidence.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(object), 1000);
  };
  return (
    <section className="pp-canonical" aria-label="Canonical cloudflared operations">
      <header>
        <div>
          <h3>Canonical operations</h3>
          <p>
            Run one bounded check against the observed service configuration. Nothing runs
            automatically.
          </p>
        </div>
        <button
          type="button"
          className="pp-tunnel-button"
          disabled={Boolean(busy)}
          onClick={onRefresh}
        >
          Refresh host
        </button>
      </header>
      {!eligible ? (
        <p role="status">
          These operations require an observed locally managed canonical service and config.
          Remote-managed tunnels and user copies remain in their own workflow.
        </p>
      ) : (
        <>
          <p className="pp-canonical-path">
            <strong>Canonical file</strong>
            <code>{deployment.configPath}</code>
            <small>SHA-256 {revision}</small>
          </p>
          <fieldset disabled={Boolean(busy)}>
            <legend>Check configuration</legend>
            <div className="pp-canonical-actions">
              {[
                ['validate', 'Validate ingress'],
                ['logs', 'Recent log summary'],
                ['metrics', 'Metrics snapshot'],
                ['report', 'Prepare sanitized report'],
              ].map(([operation, label]) => (
                <button
                  type="button"
                  className="pp-tunnel-button"
                  key={operation}
                  onClick={() => void run(operation)}
                >
                  {label}
                </button>
              ))}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run('match');
              }}
            >
              <label>
                URL to match
                <input
                  type="url"
                  required
                  maxLength={2048}
                  value={url}
                  placeholder="https://app.example.com/path"
                  onChange={(event) => setURL(event.target.value)}
                />
              </label>
              <button className="pp-tunnel-button" type="submit">
                Match ingress rule
              </button>
            </form>
          </fieldset>
          {writable ? (
            <details>
              <summary>Add a route to this canonical config</summary>
              <p>
                Preview validates a temporary sibling file. Apply requires this exact file to be
                user-owned and writable. The service stays running with its current configuration
                until you explicitly restart it.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run('plan');
                }}
              >
                <fieldset disabled={Boolean(busy)}>
                  <legend>New ingress rule</legend>
                  <label>
                    Hostname
                    <input
                      required
                      maxLength={253}
                      value={hostname}
                      placeholder="app.example.com"
                      onChange={(event) => {
                        setHostname(event.target.value);
                        invalidate();
                      }}
                    />
                  </label>
                  <label>
                    Path expression (optional)
                    <input
                      maxLength={1024}
                      value={path}
                      onChange={(event) => {
                        setPath(event.target.value);
                        invalidate();
                      }}
                    />
                  </label>
                  <label>
                    Origin service
                    <input
                      required
                      maxLength={2048}
                      value={service}
                      onChange={(event) => {
                        setService(event.target.value);
                        invalidate();
                      }}
                    />
                  </label>
                  <button type="submit" className="pp-tunnel-button">
                    Preview validated change
                  </button>
                </fieldset>
              </form>
            </details>
          ) : null}
          {plan ? (
            <div className="pp-canonical-plan">
              <h4>{plan.applied ? 'Applied config plan' : 'Review config change'}</h4>
              <p>
                {plan.route.hostname ? (
                  <>
                    {plan.route.hostname}
                    {plan.route.path} → {plan.route.service}
                  </>
                ) : (
                  'Recovered rollback reference for this observed file. Review the canonical file locally before restoring it.'
                )}
              </p>
              <dl>
                <dt>Before SHA-256</dt>
                <dd>{plan.beforeRevision}</dd>
                <dt>After SHA-256</dt>
                <dd>{plan.afterRevision}</dd>
                <dt>Plan expires</dt>
                <dd>{plan.expiresAt}</dd>
              </dl>
              <p>
                Rollback retains the original bytes privately in this process for ten minutes. It
                refuses unrelated file or service changes.
              </p>
              <p>
                Applying re-serializes YAML and may change formatting. Review the canonical file
                locally; secret values stay on the host.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={Boolean(busy)}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                I reviewed the path and hashes and approve{' '}
                {plan.applied ? 'restoring the original file' : 'replacing this canonical file'}.
              </label>
              <button
                type="button"
                className="pp-tunnel-button"
                disabled={!confirmed || Boolean(busy)}
                onClick={() => void run(plan.applied ? 'rollback' : 'apply')}
              >
                {plan.applied ? 'Roll back this change' : 'Apply reviewed change'}
              </button>
            </div>
          ) : null}
        </>
      )}
      {busy ? (
        <div role="status" className="pp-canonical-actions">
          <span>
            Running {busy}… Leaving this tool stops waiting; a committed file change is still
            revalidated.
          </span>
          <button type="button" className="pp-tunnel-button" onClick={cancel}>
            Cancel waiting
          </button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {retentionWarning ? <p role="status">{retentionWarning}</p> : null}
      {result ? (
        <div className="pp-canonical-result" role="status">
          <h4>
            {result.operation}: {result.status}
          </h4>
          <p>{result.message}</p>
          {result.data !== undefined ? (
            <textarea
              readOnly
              aria-label="Operation evidence"
              rows={10}
              value={JSON.stringify(result.data, null, 2)}
            />
          ) : null}
          {result.receipt ? (
            <dl>
              <dt>Receipt</dt>
              <dd>{result.receipt.id}</dd>
              <dt>Observed SHA-256</dt>
              <dd>{result.receipt.afterRevision || 'Unverified; inspect the canonical file'}</dd>
            </dl>
          ) : null}
          {result.operation === 'report' && result.status === 'completed' ? (
            <button type="button" className="pp-tunnel-button" onClick={download}>
              Download sanitized report
            </button>
          ) : null}
        </div>
      ) : null}
      <p className="pp-canonical-note">
        Full cloudflared diagnostic archives remain a manual vendor operation: they may include raw
        configuration, logs, profiles and traceroutes. This sanitized report excludes them. No log
        tail, metrics polling or port discovery runs in the background.
      </p>
    </section>
  );
}
