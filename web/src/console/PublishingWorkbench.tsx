import { useEffect, useRef, useState } from 'react';
import {
  type PublishPreview,
  type PublishRequest,
  type PublishSession,
  parsePublishPreview,
  parsePublishSession,
  publishRequest,
} from './publish-sessions';
import { PageHeader } from './shell/PageHeader';
import './publishing.css';

export function PublishingWorkbench() {
  const [draft, setDraft] = useState<PublishRequest>({
    mode: 'serve',
    origin: 'http://127.0.0.1:3000',
    port: 443,
    minutes: 15,
  });
  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [consent, setConsent] = useState(false);
  const [session, setSession] = useState<PublishSession | null>(null);
  const [checked, setChecked] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const active = useRef<AbortController | null>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const running = session && ['starting', 'running', 'stopping'].includes(session.state);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (preview) reviewHeading.current?.focus();
  }, [preview]);

  function update(value: Partial<PublishRequest>) {
    setDraft((current) => ({ ...current, ...value }));
    setPreview(null);
    setConsent(false);
    setError('');
  }
  async function run(operation: 'preview' | 'start' | 'stop' | 'status' | 'verify') {
    if (active.current || (operation === 'start' && (!preview || !consent))) return;
    if (operation === 'start' && preview && Date.parse(preview.expiresAt) <= Date.now()) {
      setPreview(null);
      setConsent(false);
      setError('The preview expired. Review the session again.');
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setBusy(operation);
    setError('');
    setMessage('');
    const input =
      operation === 'preview'
        ? draft
        : operation === 'start'
          ? { revision: preview?.revision, confirmed: consent }
          : operation === 'stop' || operation === 'verify'
            ? { id: session?.id }
            : undefined;
    if (operation === 'start') {
      setPreview(null);
      setConsent(false);
    }
    try {
      const value = await publishRequest(operation, input, controller.signal);
      if (active.current !== controller || controller.signal.aborted) return;
      if (operation === 'preview') {
        setPreview(parsePublishPreview(value));
        setConsent(false);
      } else if (operation === 'status') {
        if (!value || !Object.hasOwn(value, 'session'))
          throw new Error('Invalid publishing status.');
        setSession(value.session === null ? null : parsePublishSession(value.session));
        setChecked(true);
        setUncertain(false);
      } else {
        setSession(parsePublishSession(value));
        setChecked(true);
        setUncertain(false);
      }
      if (operation === 'start')
        setMessage(
          'Session accepted. Check session to observe startup. Leaving this page keeps it running until Stop, expiry, or ProtoPeek shutdown.'
        );
      if (operation === 'stop')
        setMessage('Owned process stopped. Review the cleanup evidence below.');
      if (operation === 'verify')
        setMessage(
          'Endpoint check completed. HTTP status and verified TLS reachability are separate from application correctness.'
        );
    } catch (cause) {
      if (active.current === controller && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Publishing request failed.');
        if (operation === 'start' || operation === 'stop') {
          setUncertain(true);
          setMessage(
            'An accepted native session may still exist. Check session before trying another operation.'
          );
        }
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy('');
      }
    }
  }
  function cancel() {
    active.current?.abort();
    active.current = null;
    if (busy === 'start' || busy === 'stop') setUncertain(true);
    setBusy('');
    setPreview(null);
    setConsent(false);
    setMessage(
      'Request cancelled locally. An accepted session can continue; Check session to observe it and use Stop when needed.'
    );
  }
  return (
    <section className="pp-publishing" aria-label="Temporary publishing sessions">
      <PageHeader>
        <div>
          <p className="pp-eyebrow">Extensions</p>
          <h1>Share a local service</h1>
          <p>Choose who can reach it, review the command, then start one temporary session.</p>
        </div>
        <button type="button" disabled={!!busy} onClick={() => void run('status')}>
          Check session
        </button>
      </PageHeader>
      <p className="pp-operation-banner">
        A session continues when you leave this page. Stop it here, wait for its duration, or close
        ProtoPeek. Existing native rules are preserved. No background refresh.
      </p>
      <form
        className="pp-publish-form pp-panel"
        onSubmit={(event) => {
          event.preventDefault();
          void run('preview');
        }}
      >
        <fieldset disabled={!!busy || !!running || uncertain || session?.cleanup === 'unconfirmed'}>
          <legend>Audience & destination</legend>
          <label>
            Who can reach it?
            <select
              value={draft.mode}
              onChange={(event) => {
                const mode = event.target.value as PublishRequest['mode'];
                update({ mode, port: mode === 'quick' ? 0 : 443 });
              }}
            >
              <option value="serve">Private · Tailscale Serve</option>
              <option value="quick">Public · Cloudflare Quick Tunnel</option>
              <option value="funnel">Public · Tailscale Funnel</option>
            </select>
          </label>
          <label>
            Local origin URL
            <input
              type="url"
              value={draft.origin}
              maxLength={2048}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => update({ origin: event.target.value })}
            />
          </label>
          <small>
            HTTP or verified HTTPS on a loopback address and explicit port. Only the chosen origin
            is published.
          </small>
          <div className="pp-publish-fields">
            {draft.mode !== 'quick' ? (
              <label>
                Published HTTPS port
                <select
                  value={draft.port}
                  onChange={(event) => update({ port: Number(event.target.value) })}
                >
                  <option value={443}>443</option>
                  <option value={8443}>8443</option>
                  <option value={10000}>10000</option>
                </select>
              </label>
            ) : null}
            <label>
              Session duration (minutes)
              <input
                type="number"
                min={1}
                max={60}
                value={draft.minutes}
                onChange={(event) => update({ minutes: Number(event.target.value) })}
              />
            </label>
          </div>
          <button type="submit">Review session</button>
        </fieldset>
      </form>
      {busy ? (
        <div className="pp-publish-actions">
          <p role="status">
            {busy === 'preview'
              ? 'Checking native prerequisites and the loopback origin…'
              : `${busy === 'status' ? 'Checking session' : busy === 'start' ? 'Starting reviewed session' : busy === 'verify' ? 'Checking endpoint HTTPS' : 'Stopping owned process'}…`}
          </p>
          <button type="button" onClick={cancel}>
            Cancel request
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="pp-operation-banner is-danger">
          {error}
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {preview ? (
        <section className="pp-panel pp-publish-review" aria-label="Publishing preview">
          <h2 tabIndex={-1} ref={reviewHeading}>
            Review · {preview.audience}
          </h2>
          <dl>
            <div>
              <dt>Origin</dt>
              <dd>{preview.request.origin}</dd>
            </div>
            <div>
              <dt>Origin TCP observation</dt>
              <dd>
                {preview.origin.connected
                  ? `Connected in ${preview.origin.durationMs} ms. HTTP behavior was not checked.`
                  : 'No connection. Start the origin and review again.'}
              </dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{preview.request.minutes} minutes</dd>
            </div>
          </dl>
          <p>{preview.notice}</p>
          <details>
            <summary>Executable & reviewed arguments</summary>
            <code>{preview.executable}</code>
            <ol>
              {preview.arguments.map((arg, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: reviewed arguments are immutable evidence in execution order
                <li key={`${index}:${arg}`}>
                  <code>{arg}</code>
                </li>
              ))}
            </ol>
          </details>
          <label className="pp-publish-consent">
            <input
              type="checkbox"
              checked={consent}
              disabled={!!busy}
              onChange={(event) => setConsent(event.target.checked)}
            />
            {preview.audience === 'public internet'
              ? 'I understand this service will be reachable from the public internet.'
              : 'I confirm this service may be shared with my tailnet.'}
          </label>
          <button
            type="button"
            disabled={!consent || !preview.origin.connected || !!busy}
            onClick={() => void run('start')}
          >
            Start reviewed session
          </button>
          <small>
            Preview expires at {new Date(preview.expiresAt).toLocaleTimeString()}. Start rechecks
            native state.
          </small>
        </section>
      ) : null}
      {session ? (
        <section className="pp-panel pp-publish-session" aria-label="Owned publishing session">
          <div className="pp-publish-actions">
            <h2>
              {session.audience} · {session.state}
            </h2>
            <button
              type="button"
              disabled={!!busy || (!running && session.cleanup === 'confirmed')}
              onClick={() => void run('stop')}
            >
              Stop owned session
            </button>
          </div>
          <dl>
            <div>
              <dt>Origin</dt>
              <dd>{session.originUrl}</dd>
            </div>
            <div>
              <dt>Native process</dt>
              <dd>
                PID {session.pid || 'not started'} · {session.mode}
              </dd>
            </div>
            <div>
              <dt>Ends</dt>
              <dd>{new Date(session.expiresAt).toLocaleTimeString()}</dd>
            </div>
            <div>
              <dt>Owned process cleanup</dt>
              <dd>{session.cleanup}</dd>
            </div>
          </dl>
          {session.endpoint ? (
            <p>
              Reported endpoint:{' '}
              <a href={session.endpoint} target="_blank" rel="noreferrer">
                {session.endpoint}
              </a>
            </p>
          ) : (
            <p>The native client has not reported an endpoint.</p>
          )}
          {session.endpointCheckedAt ? (
            <p>
              Endpoint check at {new Date(session.endpointCheckedAt).toLocaleTimeString()}:{' '}
              {session.endpointVerified
                ? `verified HTTPS peer responded · HTTP ${session.endpointStatus}. Redirects were not followed; application behavior was not checked.`
                : session.endpointError}
            </p>
          ) : (
            <p>
              Published endpoint reachability has not been verified. Origin TCP connection and
              process readiness are separate observations.
            </p>
          )}
          <button
            type="button"
            disabled={!!busy || session.state !== 'running' || !session.endpoint}
            onClick={() => void run('verify')}
          >
            Check endpoint HTTPS
          </button>
          {session.reason ? (
            <p
              role={
                session.cleanup === 'unconfirmed' || session.state === 'failed' ? 'alert' : 'status'
              }
            >
              {session.reason}
            </p>
          ) : null}
          {session.cleanup === 'unconfirmed' ? (
            <p>
              Resolve any remaining native rules in the installed client, then Check session to
              confirm cleanup before starting another session.
            </p>
          ) : null}
          <details>
            <summary>Operational events · {session.events.length}</summary>
            <p>
              Raw native output is omitted because it may include sign-in links or credentials.
              Events and output are bounded.
            </p>
            <ol>
              {session.events.map((event, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: bounded native events retain their observed order and have no child state
                <li key={`${index}:${event.observedAt}:${event.message}`}>
                  <time>{new Date(event.observedAt).toLocaleTimeString()}</time> · {event.message}
                </li>
              ))}
            </ol>
          </details>
        </section>
      ) : checked ? (
        <p>No session is owned by this ProtoPeek process.</p>
      ) : (
        <p>
          Check session to observe existing work. No tools run until you review or start a session.
        </p>
      )}
      <details className="pp-panel pp-publish-help">
        <summary>Installed clients & access</summary>
        <p>
          Serve and Funnel require an already connected Tailscale client with HTTPS enabled. Funnel
          also requires existing native public-access policy. This page does not sign in, enable
          policy, elevate, or change background rules.
        </p>
        <p>
          Quick Tunnel requires cloudflared and provides a temporary public URL intended for
          testing, without an uptime guarantee.
        </p>
        <a href="https://tailscale.com/kb/1312/serve" target="_blank" rel="noreferrer">
          Tailscale Serve documentation
        </a>
        {' · '}
        <a
          href="https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/"
          target="_blank"
          rel="noreferrer"
        >
          Cloudflare Quick Tunnels
        </a>
      </details>
    </section>
  );
}
