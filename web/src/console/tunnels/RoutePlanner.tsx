import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Copy,
  ShieldCheck,
  X,
} from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import type { TunnelDeployment } from '../tunnels-api';
import {
  type PlannedTunnelRoute,
  protocolFromService,
  validateTunnelRoutePlan,
} from './route-plan';

export default function RoutePlanner({
  deployment,
  initialService = 'http://localhost:8080',
  initialContext = '',
  onClose,
  onSave,
}: {
  deployment: TunnelDeployment;
  initialService?: string;
  initialContext?: string;
  onClose: () => void;
  onSave: (route: PlannedTunnelRoute) => void;
}) {
  const [hostname, setHostname] = useState('');
  const [path, setPath] = useState('');
  const [service, setService] = useState(initialService);
  const [stage, setStage] = useState<'edit' | 'review'>('edit');
  const [error, setError] = useState('');
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => firstInputRef.current?.focus());
    function handleKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href]'
        ) ?? []
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const validation = validateTunnelRoutePlan(hostname, path, service);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (validation) {
      setError(validation);
      return;
    }
    setError('');
    setStage('review');
  }

  const draftDestination =
    deployment.managementMode === 'remote'
      ? 'Portable draft · Cloudflare account authority'
      : deployment.configPath
        ? `Local YAML draft · ${deployment.configPath}`
        : 'Portable draft · local YAML destination not proven';
  const yaml = `- hostname: ${hostname.trim()}${path.trim() ? `\n  path: ${path.trim()}` : ''}\n  service: ${service.trim()}`;

  return (
    <div className="pp-tunnel-drawer-layer" role="presentation">
      <button
        type="button"
        className="pp-tunnel-drawer-backdrop"
        aria-label="Close route planner"
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        className="pp-tunnel-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="route-planner-title"
      >
        <header>
          <div>
            <span className="pp-tunnel-kicker">Safe route plan</span>
            <h2 id="route-planner-title">Draft ingress route</h2>
            <p>{deployment.name}</p>
          </div>
          <button type="button" aria-label="Close route planner" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        {stage === 'edit' ? (
          <form onSubmit={submit}>
            {initialContext ? (
              <div className="pp-tunnel-drawer-note is-authority" role="status">
                <ShieldCheck aria-hidden="true" />
                <p>
                  <strong>Prefilled local origin</strong>
                  <span>{initialContext}</span>
                </p>
              </div>
            ) : null}
            <div className="pp-tunnel-drawer-note">
              <ShieldCheck aria-hidden="true" />
              <p>
                <strong>Preview only</strong>
                <span>
                  This build will not write YAML, restart a service, or contact Cloudflare.
                </span>
              </p>
            </div>
            <div className="pp-tunnel-drawer-note is-authority">
              <Cloud aria-hidden="true" />
              <p>
                <strong>
                  {deployment.managementMode === 'remote'
                    ? 'Cloudflare account authority'
                    : 'Local YAML authority'}
                </strong>
                <span>
                  {deployment.managementMode === 'remote'
                    ? 'This creates a portable browser-only draft. No local YAML destination is assumed.'
                    : deployment.configPath
                      ? `This draft targets the deployment’s own observed config: ${deployment.configPath}`
                      : 'No local destination was proven, so this draft stays portable and browser-only.'}
                </span>
              </p>
            </div>
            <label>
              <span>Public hostname</span>
              <input
                ref={firstInputRef}
                value={hostname}
                onChange={(event) => setHostname(event.currentTarget.value)}
                placeholder="api.example.com"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label>
              <span>
                Path regular expression <small>optional</small>
              </span>
              <input
                value={path}
                onChange={(event) => setPath(event.currentTarget.value)}
                placeholder="^/api/.*"
                autoComplete="off"
                spellCheck={false}
              />
              <small className="pp-tunnel-field-help">
                cloudflared treats this as a regular expression, not a shell glob. Example:{' '}
                <code>^/api/.*</code>
              </small>
            </label>
            <label>
              <span>Origin service</span>
              <input
                value={service}
                onChange={(event) => setService(event.currentTarget.value)}
                placeholder="http://localhost:8080"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <fieldset className="pp-tunnel-origin-presets">
              <legend className="pp-sr-only">Origin presets</legend>
              <button type="button" onClick={() => setService('http://localhost:8080')}>
                HTTP · 8080
              </button>
              <button type="button" onClick={() => setService('h2c://localhost:50051')}>
                gRPC · 50051
              </button>
              <button type="button" onClick={() => setService('ssh://localhost:22')}>
                SSH · 22
              </button>
            </fieldset>
            {error ? (
              <p className="pp-tunnel-form-error" role="alert">
                <AlertTriangle aria-hidden="true" /> {error}
              </p>
            ) : null}
            <div className="pp-tunnel-drawer-actions">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="is-primary">
                Review plan <ChevronRight aria-hidden="true" />
              </button>
            </div>
          </form>
        ) : (
          <div className="pp-tunnel-plan-review">
            <div className="pp-tunnel-plan-summary">
              <CheckCircle2 aria-hidden="true" />
              <div>
                <strong>Browser-validated draft</strong>
                <p>
                  ProtoPeek checked the browser form and regular-expression syntax only. cloudflared
                  has not validated this draft.
                </p>
              </div>
            </div>
            <dl>
              <div>
                <dt>Destination</dt>
                <dd>{draftDestination}</dd>
              </div>
              <div>
                <dt>Action</dt>
                <dd>Draft one ingress rule</dd>
              </div>
              <div>
                <dt>Service action</dt>
                <dd>None in this build</dd>
              </div>
              <div>
                <dt>Host impact</dt>
                <dd>No change</dd>
              </div>
            </dl>
            <div className="pp-tunnel-yaml-preview">
              <header>
                <span>YAML fragment</span>
                <button type="button" onClick={() => void navigator.clipboard?.writeText(yaml)}>
                  <Copy aria-hidden="true" /> Copy
                </button>
              </header>
              <pre>{yaml}</pre>
            </div>
            <div className="pp-tunnel-plan-warning">
              <AlertTriangle aria-hidden="true" />
              <p>
                <strong>Apply is intentionally unavailable</strong>
                <span>
                  No file or Cloudflare account is changed. cloudflared validation, revision checks,
                  verification, and rollback are not run in this build.
                </span>
              </p>
            </div>
            <div className="pp-tunnel-drawer-actions">
              <button type="button" onClick={() => setStage('edit')}>
                Back
              </button>
              <button
                type="button"
                className="is-primary"
                onClick={() => {
                  onSave({
                    id: `draft-${Date.now()}`,
                    hostname: hostname.trim(),
                    path: path.trim(),
                    service: service.trim(),
                    protocol: protocolFromService(service),
                    catchAll: false,
                    planned: true,
                  });
                  onClose();
                }}
              >
                <Check aria-hidden="true" /> Keep as draft
              </button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
