import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Play,
  RefreshCw,
  RotateCw,
  Square,
  Terminal,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import type {
  TunnelCapabilities,
  TunnelServiceAction,
  TunnelServiceActionResult,
  TunnelSnapshot,
} from '@/console/tunnels-api';
import { copyText, statusLabel } from './view-helpers';

const stableServiceStates = new Set(['running', 'stopped', 'paused']);

export function ServiceActions({
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

export function ServiceControls({
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

export function ServiceActionFeedback({
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

export function ServiceActionDialog({
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
