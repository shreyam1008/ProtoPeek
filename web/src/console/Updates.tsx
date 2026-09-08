import { CheckCircle2, Download, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { fetchJSON } from './api';
import { PageHeader } from './shell/PageHeader';
import './updates.css';

export type UpdateState = {
  installation: {
    version: string;
    revision: string;
    channel: string;
    os: string;
    arch: string;
    executable: string;
    manager: string;
    canUpdate: boolean;
    reason: string;
    commands: string[];
  };
  plan: {
    id: string;
    channel: string;
    version: string;
    revision: string;
    url: string;
    available: boolean;
    checkedAt: string;
    archive: string;
    size: number;
  } | null;
  phase: string;
  error: string;
  restartRequired: boolean;
  notice: string;
};
const activePhases = new Set(['checking', 'preparing', 'downloading', 'verifying', 'installing']);
const phases: Record<string, string> = {
  checking: 'Checking GitHub releases…',
  preparing: 'Preparing the installation…',
  downloading: 'Downloading the release archive…',
  verifying: 'Verifying both executables…',
  installing: 'Installing both commands…',
  cancelled: 'Update cancelled before installation.',
};

function request(path: string, signal: AbortSignal, body?: unknown) {
  const token = document.cookie.match(/(?:^|;\s*)_protopeek_csrf_token=([^;]+)/)?.[1] ?? '';
  return fetchJSON<UpdateState>(`api/update/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    signal,
    headers: {
      'x-protopeek-csrf-token': token,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export function Updates() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [channel, setChannel] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState('');
  const operation = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const c = new AbortController();
    request('state', c.signal)
      .then((value) => {
        if (!c.signal.aborted) {
          setState(value);
          setChannel(value.plan?.channel ?? value.installation.channel);
        }
      })
      .catch((cause) => {
        if (!c.signal.aborted) setError(String(cause.message ?? cause));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => {
      mounted.current = false;
      c.abort();
      operation.current?.abort();
    };
  }, []);

  const active = Boolean(busy) || activePhases.has(state?.phase ?? '');
  useEffect(() => {
    if (!active) return;
    const c = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const value = await request('state', c.signal);
        if (!c.signal.aborted) setState(value);
      } catch {
        /* The operation request reports failures; polling is only progress. */
      }
      if (!c.signal.aborted) timer = setTimeout(poll, 1000);
    }
    timer = setTimeout(poll, 500);
    return () => {
      c.abort();
      clearTimeout(timer);
    };
  }, [active]);

  async function run(action: 'check' | 'apply') {
    const c = new AbortController();
    operation.current = c;
    setBusy(action);
    setState((previous) =>
      previous ? { ...previous, phase: action === 'check' ? 'checking' : 'preparing' } : previous
    );
    setError('');
    setCopied('');
    setConfirmed(false);
    try {
      const value = await request(
        action,
        c.signal,
        action === 'check' ? { channel } : { id: state?.plan?.id, confirm: true }
      );
      if (mounted.current) setState(value);
    } catch (cause) {
      if (!mounted.current) return;
      setError(
        c.signal.aborted
          ? action === 'check'
            ? 'Update check cancelled.'
            : 'Cancellation requested. If installation has already started, it will finish safely.'
          : cause instanceof Error
            ? cause.message
            : 'Update failed.'
      );
      try {
        const value = await request('state', new AbortController().signal);
        if (mounted.current) setState(value);
      } catch {
        /* Keep the original error visible. */
      }
    } finally {
      if (mounted.current) setBusy('');
      operation.current = null;
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
    } catch {
      setError('Clipboard access failed. Select and copy the command below.');
    }
  }

  const installation = state?.installation;
  const plan = state?.plan;
  const previewMatches = plan?.channel === channel;
  const canInstall = Boolean(
    plan?.available && previewMatches && installation?.canUpdate && !state?.restartRequired
  );
  const command = `pp update${channel && channel !== installation?.channel ? ` --channel ${channel}` : ''}`;

  return (
    <div className="updates-workspace">
      <PageHeader>
        <div>
          <h1>Updates</h1>
          <p>Keep ProtoPeek current. You choose when to check, install, and restart.</p>
        </div>
      </PageHeader>
      {loading && (
        <p role="status">
          <LoaderCircle className="updates-spin" size={16} /> Reading the local installation…
        </p>
      )}
      {error && (
        <div className="updates-callout updates-warning" role="alert">
          <TriangleAlert size={18} />
          <p>{error}</p>
        </div>
      )}
      {installation && (
        <>
          <section className="updates-card" aria-label="Installed version">
            <div className="updates-title">
              <div>
                <span className="updates-eyebrow">THIS INSTALLATION</span>
                <h2>ProtoPeek {installation.version}</h2>
              </div>
              <span className="updates-chip">
                {installation.channel === 'nightly'
                  ? 'Nightly preview'
                  : installation.channel === 'edge'
                    ? 'Edge preview'
                    : 'Stable'}
              </span>
            </div>
            <dl className="updates-facts">
              <div>
                <dt>Platform</dt>
                <dd>
                  {installation.os} · {installation.arch}
                </dd>
              </div>
              <div>
                <dt>Installed through</dt>
                <dd>{installation.manager}</dd>
              </div>
              <div>
                <dt>Executable</dt>
                <dd>
                  <code>{installation.executable}</code>
                </dd>
              </div>
            </dl>
            {!installation.canUpdate && (
              <div className="updates-callout">
                <TriangleAlert size={18} />
                <div>
                  <strong>Use the installation’s update method</strong>
                  <p>{installation.reason}</p>
                  {installation.commands.map((text) => (
                    <div className="updates-command" key={text}>
                      <code>{text}</code>
                      <button type="button" onClick={() => void copy(text)}>
                        {copied === text ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
          {state?.restartRequired ? (
            <section className="updates-callout updates-success" role="status">
              <CheckCircle2 size={22} />
              <div>
                <h2>Update installed · restart required</h2>
                <p>
                  The running server still uses its previous version. Finish or pause active
                  downloads, stop ProtoPeek, then launch <code>pp</code> or <code>protopeek</code>{' '}
                  again.
                </p>
                <p>
                  Reloading this browser tab alone does not restart the server. Your saved local
                  settings and files are kept.
                </p>
                {state.notice && <p>{state.notice}</p>}
              </div>
            </section>
          ) : (
            <section className="updates-card" aria-label="Release update">
              <div className="updates-title">
                <div>
                  <h2>Choose a release</h2>
                  <p>Checking contacts GitHub. Nothing checks or installs automatically.</p>
                </div>
              </div>
              <div className="updates-actions">
                <label htmlFor="update-channel">
                  Release channel
                  <select
                    id="update-channel"
                    value={channel}
                    disabled={active}
                    onChange={(event) => {
                      setChannel(event.target.value);
                      setConfirmed(false);
                      setError('');
                    }}
                  >
                    <option value="stable">Stable</option>
                    <option value="nightly">Nightly preview</option>
                    <option value="edge">Edge (legacy preview)</option>
                  </select>
                </label>
                <button
                  className="updates-primary"
                  type="button"
                  disabled={active}
                  onClick={() => void run('check')}
                >
                  <RefreshCw size={16} />
                  Check for updates
                </button>
              </div>
              {channel !== 'stable' && (
                <div className="updates-callout updates-warning">
                  <TriangleAlert size={18} />
                  <p>
                    {channel === 'nightly'
                      ? 'Nightly follows successful main/master builds. It may be less stable and updates do not change the stable release.'
                      : 'Edge is a legacy prerelease channel, refreshed manually. Choose Nightly for new branch builds.'}
                  </p>
                </div>
              )}
              {channel !== installation.channel && (
                <p className="updates-muted">
                  You are choosing a different release channel. Review the version before
                  installing; switching from a preview to stable can remove preview features.
                </p>
              )}
              {active && (
                <div className="updates-progress" role="status">
                  <LoaderCircle className="updates-spin" size={18} />
                  <span>
                    {phases[state?.phase ?? ''] ??
                      (busy === 'check' ? phases.checking : phases.preparing)}
                  </span>
                  {busy && (
                    <button
                      type="button"
                      disabled={state?.phase === 'installing'}
                      onClick={() => operation.current?.abort()}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              )}
              {state?.phase === 'cancelled' && !active && <p role="status">{phases.cancelled}</p>}
              {plan && previewMatches && !active && (
                <div
                  className={plan.available ? 'updates-result updates-available' : 'updates-result'}
                  role="status"
                >
                  <div className="updates-title">
                    <h3>
                      {plan.available ? `Update available: ${plan.version}` : 'You’re up to date'}
                    </h3>
                    <a href={plan.url} target="_blank" rel="noreferrer">
                      Release notes ↗
                    </a>
                  </div>
                  <p>
                    {plan.channel !== 'stable' ? `Source ${plan.revision.slice(0, 12)} · ` : ''}
                    {(plan.size / 1048576).toFixed(1)} MiB · checked{' '}
                    {new Date(plan.checkedAt).toLocaleString()}
                  </p>
                  {canInstall && (
                    <>
                      <p>
                        Both owned commands will be updated. The existing server keeps running until
                        you restart it. Local settings, downloads, and browser data are kept.
                      </p>
                      <label className="updates-confirm">
                        <input
                          type="checkbox"
                          checked={confirmed}
                          onChange={(event) => setConfirmed(event.target.checked)}
                        />
                        I’ve reviewed this release and will restart after active work finishes.
                      </label>
                      <button
                        type="button"
                        className="updates-primary"
                        disabled={!confirmed}
                        onClick={() => void run('apply')}
                      >
                        <Download size={16} />
                        Install update
                      </button>
                    </>
                  )}
                </div>
              )}
            </section>
          )}
          <section className="updates-card" aria-label="Command line updates">
            <h2>From your terminal</h2>
            <p>
              <code>pp update</code> and <code>protopeek update</code> use the same updater on
              Windows, macOS, and Linux. Add <code>--check</code> to check without installing.
            </p>
            <div className="updates-command">
              <code>{command}</code>
              <button type="button" onClick={() => void copy(command)}>
                {copied === command ? 'Copied' : 'Copy command'}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
