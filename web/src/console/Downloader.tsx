import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  CirclePause,
  Copy,
  FileSearch,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  addTransfer,
  fetchTransferSnapshot,
  mutateTransferJob,
  startTransferEngine,
  type TransferJob,
  type TransferJobStatus,
  type TransferSnapshot,
} from './transfer-api';
import './downloader.css';

type QueueFilter = 'all' | 'active' | 'completed' | 'failed';

const activeStatuses = new Set<TransferJobStatus>(['queued', 'downloading', 'paused']);

export function Downloader() {
  const [snapshot, setSnapshot] = useState<TransferSnapshot | null>(null);
  const [selectedID, setSelectedID] = useState('');
  const [source, setSource] = useState('');
  const [outputName, setOutputName] = useState('');
  const [sha256, setSha256] = useState('');
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const mountedRef = useRef(true);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await fetchTransferSnapshot(signal);
      if (!mountedRef.current || signal?.aborted) return;
      setSnapshot(next);
      setError('');
      setSelectedID((current) => {
        if (current && next.jobs.some((job) => job.id === current)) return current;
        return next.jobs[0]?.id ?? '';
      });
    } catch (cause) {
      if (!mountedRef.current || signal?.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Downloader state could not be loaded.');
    } finally {
      if (mountedRef.current && !signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => {
      mountedRef.current = false;
      controller.abort();
    };
  }, [refresh]);

  useEffect(() => {
    if (!snapshot?.health.ready) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !busy) void refresh();
    }, 1_500);
    return () => window.clearInterval(interval);
  }, [busy, refresh, snapshot?.health.ready]);

  const selected = snapshot?.jobs.find((job) => job.id === selectedID) ?? null;
  const filteredJobs = useMemo(() => {
    const jobs = snapshot?.jobs ?? [];
    if (filter === 'active') return jobs.filter((job) => activeStatuses.has(job.status));
    if (filter === 'completed') return jobs.filter((job) => job.status === 'completed');
    if (filter === 'failed') return jobs.filter((job) => job.status === 'failed');
    return jobs;
  }, [filter, snapshot?.jobs]);

  const counts = useMemo(() => {
    const jobs = snapshot?.jobs ?? [];
    return {
      all: jobs.length,
      active: jobs.filter((job) => activeStatuses.has(job.status)).length,
      completed: jobs.filter((job) => job.status === 'completed').length,
      failed: jobs.filter((job) => job.status === 'failed').length,
    };
  }, [snapshot?.jobs]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = source.trim();
    if (!trimmed || busy) return;
    setBusy('add');
    setError('');
    setWarning('');
    try {
      if (!snapshot?.health.ready) await startTransferEngine();
      const result = await addTransfer(trimmed, {
        outputName: outputName.trim(),
        sha256: sha256.trim(),
      });
      setSource('');
      setOutputName('');
      setSha256('');
      await refresh();
      setSelectedID(result.id);
      setWarning(result.persistenceWarning);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The download could not be started.');
    } finally {
      setBusy('');
    }
  }

  async function runJobAction(action: 'pause' | 'resume' | 'retry' | 'cancel', id: string) {
    if (busy) return;
    setBusy(`${action}:${id}`);
    setError('');
    setWarning('');
    try {
      const result = await mutateTransferJob(action, id);
      await refresh();
      if (result?.id) setSelectedID(result.id);
      setWarning(result?.persistenceWarning ?? '');
    } catch (cause) {
      // Queue mutations can succeed before an engine/session persistence error
      // is reported. Refresh before surfacing the error so the visible state
      // never tells the user the old queue state is authoritative.
      await refresh();
      setError(cause instanceof Error ? cause.message : `The transfer could not ${action}.`);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="pp-downloader">
      <header className="pp-downloader-heading">
        <div>
          <span className="pp-kicker">Download · verify · inspect</span>
          <h1>Downloader</h1>
          <p>
            Paste a URL, run a bounded local transfer, and inspect its download and checksum
            evidence.
          </p>
        </div>
        <EngineState snapshot={snapshot} loading={loading} onRefresh={() => void refresh()} />
      </header>

      <form className="pp-download-composer" onSubmit={submit}>
        <label htmlFor="download-source">URL</label>
        <input
          id="download-source"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          maxLength={8 * 1024}
          placeholder="https://example.com/artifact.tar.gz"
          value={source}
          onChange={(event) => setSource(event.target.value)}
        />
        <button type="submit" disabled={!source.trim() || Boolean(busy)}>
          {busy === 'add' ? (
            <LoaderCircle className="is-spinning" aria-hidden="true" />
          ) : (
            <ArrowDownToLine aria-hidden="true" />
          )}
          {snapshot?.health.ready ? 'Start download' : 'Start Downloader'}
        </button>
        <details className="pp-download-options">
          <summary>Optional file name and SHA-256 verification</summary>
          <div>
            <label htmlFor="download-output-name">Output file name</label>
            <input
              id="download-output-name"
              type="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={255}
              placeholder="artifact.tar.gz"
              value={outputName}
              onChange={(event) => setOutputName(event.target.value)}
            />
            <label htmlFor="download-sha256">Expected SHA-256</label>
            <input
              id="download-sha256"
              type="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
              pattern="[0-9a-fA-F]{64}"
              placeholder="64 hexadecimal characters"
              value={sha256}
              onChange={(event) => setSha256(event.target.value)}
            />
          </div>
        </details>
      </form>

      {error ? (
        <div className="pp-downloader-error" role="alert">
          <AlertTriangle aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Dismiss error">
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {warning ? (
        <div className="pp-downloader-warning" role="status">
          <AlertTriangle aria-hidden="true" />
          <span>{warning}</span>
          <button type="button" onClick={() => setWarning('')} aria-label="Dismiss warning">
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div className="pp-downloader-workspace">
        <section className="pp-transfer-queue" aria-labelledby="transfer-queue-title">
          <header>
            <div>
              <span className="pp-kicker">Queue</span>
              <h2 id="transfer-queue-title">Transfers</h2>
            </div>
            <span>
              {counts.all}/{snapshot?.config.maxTrackedJobs || '—'} tracked
            </span>
          </header>
          <nav className="pp-transfer-filters" aria-label="Filter transfers">
            {(['all', 'active', 'completed', 'failed'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={filter === value ? 'is-active' : ''}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {filterLabel(value)} <span>{counts[value]}</span>
              </button>
            ))}
          </nav>
          <div className="pp-transfer-columns" aria-hidden="true">
            <span>File</span>
            <span>Status</span>
            <span>Progress</span>
            <span>Size</span>
            <span>ETA</span>
            <span />
          </div>
          <div className="pp-transfer-list">
            {loading && !snapshot ? <QueueNotice kind="loading" /> : null}
            {!loading && !snapshot ? <QueueNotice kind="stopped" /> : null}
            {!loading && snapshot && filteredJobs.length === 0 ? (
              <QueueNotice kind={snapshot.health.ready ? 'empty' : 'stopped'} />
            ) : null}
            {filteredJobs.map((job) => (
              <TransferRow
                key={job.id}
                job={job}
                selected={job.id === selectedID}
                busy={busy.endsWith(`:${job.id}`)}
                onSelect={() => setSelectedID(job.id)}
                onAction={(action) => void runJobAction(action, job.id)}
              />
            ))}
          </div>
          <footer>
            <span>{filteredJobs.length} shown</span>
            <span>↓ {formatRate(snapshot?.metrics.bytesPerSecond ?? 0)}</span>
          </footer>
        </section>

        <TransferInspector
          key={selected?.id ?? 'no-selection'}
          job={selected}
          busy={busy}
          onAction={runJobAction}
        />
      </div>

      <footer className="pp-downloader-status">
        <span className={snapshot?.health.ready ? 'is-ready' : ''}>
          <i className="pp-engine-dot" aria-hidden="true" />{' '}
          {snapshot?.health.ready ? 'Engine ready' : 'Engine stopped'}
        </span>
        <span>aria2c {snapshot?.health.engineVersion || 'external engine'}</span>
        <span>Storage {snapshot?.config.downloadDirectory || 'not loaded'}</span>
        <span>
          Active {snapshot?.metrics.activeCount ?? 0}/{snapshot?.config.maxActiveJobs || '—'}
        </span>
        <span>Local state · no cloud sync</span>
      </footer>
    </div>
  );
}

function EngineState({
  snapshot,
  loading,
  onRefresh,
}: {
  snapshot: TransferSnapshot | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="pp-engine-state" role="status">
      <span className={snapshot?.health.ready ? 'is-ready' : ''}>
        <i className="pp-engine-dot" aria-hidden="true" />{' '}
        {snapshot?.health.status || (loading ? 'loading' : 'unavailable')}
      </span>
      <small>{snapshot?.health.message || 'Reading the local transfer service.'}</small>
      <button type="button" onClick={onRefresh} aria-label="Refresh Downloader state">
        <RefreshCw aria-hidden="true" />
      </button>
    </div>
  );
}

function TransferRow({
  job,
  selected,
  busy,
  onSelect,
  onAction,
}: {
  job: TransferJob;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onAction: (action: 'pause' | 'resume' | 'retry' | 'cancel') => void;
}) {
  return (
    <article className={selected ? 'is-selected' : ''} aria-current={selected || undefined}>
      <button type="button" className="pp-transfer-select" onClick={onSelect}>
        <span className="pp-transfer-name">
          <strong>{job.name}</strong>
          <small>{safeSourceLabel(job.source)}</small>
        </span>
        <JobState status={job.status} />
        <span className="pp-transfer-progress">
          <i
            className="pp-progress-track"
            style={{ '--pp-progress': `${job.progressPercent}%` } as React.CSSProperties}
          />
          <small>{Math.round(job.progressPercent)}%</small>
        </span>
        <span>{formatProgress(job.completedBytes, job.totalBytes)}</span>
        <span>{formatETA(job.etaSeconds, job.status)}</span>
      </button>
      <div className="pp-transfer-row-actions">
        {busy ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : null}
        {!busy && job.status === 'downloading' ? (
          <button type="button" onClick={() => onAction('pause')} aria-label={`Pause ${job.name}`}>
            <Pause aria-hidden="true" />
          </button>
        ) : null}
        {!busy && job.status === 'paused' ? (
          <button
            type="button"
            onClick={() => onAction('resume')}
            aria-label={`Resume ${job.name}`}
          >
            <Play aria-hidden="true" />
          </button>
        ) : null}
        {!busy && job.status === 'failed' ? (
          <button type="button" onClick={() => onAction('retry')} aria-label={`Retry ${job.name}`}>
            <RotateCcw aria-hidden="true" />
          </button>
        ) : null}
        {!busy && activeStatuses.has(job.status) ? (
          <button
            type="button"
            onClick={() => onAction('cancel')}
            aria-label={`Cancel ${job.name}`}
          >
            <X aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </article>
  );
}

function TransferInspector({
  job,
  busy,
  onAction,
}: {
  job: TransferJob | null;
  busy: string;
  onAction: (action: 'pause' | 'resume' | 'retry' | 'cancel', id: string) => Promise<void>;
}) {
  const [copyStatus, setCopyStatus] = useState('');

  if (!job) {
    return (
      <aside className="pp-transfer-inspector is-empty" aria-label="Transfer details">
        <FileSearch aria-hidden="true" />
        <h2>No transfer selected</h2>
        <p>Add a URL or choose a queue item to inspect its local evidence.</p>
      </aside>
    );
  }

  const jobBusy = busy.endsWith(`:${job.id}`);
  return (
    <aside className="pp-transfer-inspector" aria-labelledby="transfer-detail-title">
      <header>
        <div className="pp-inspector-heading-copy">
          <span className="pp-kicker">Selected transfer</span>
          <h2 id="transfer-detail-title">{job.name}</h2>
          <small>{safeSourceLabel(job.source)}</small>
        </div>
        <JobState status={job.status} />
      </header>

      <section className="pp-inspector-progress">
        <div>
          <span className="pp-kicker">Progress</span>
          <strong>{Math.round(job.progressPercent)}%</strong>
        </div>
        <i
          className="pp-progress-track"
          style={{ '--pp-progress': `${job.progressPercent}%` } as React.CSSProperties}
        />
        <dl>
          <div>
            <dt>Downloaded</dt>
            <dd>{formatProgress(job.completedBytes, job.totalBytes)}</dd>
          </div>
          <div>
            <dt>Speed</dt>
            <dd>{formatRate(job.bytesPerSecond)}</dd>
          </div>
          <div>
            <dt>ETA</dt>
            <dd>{formatETA(job.etaSeconds, job.status)}</dd>
          </div>
          <div>
            <dt>Connections</dt>
            <dd>{job.connections}</dd>
          </div>
        </dl>
      </section>

      <section className="pp-inspector-section">
        <span className="pp-kicker">Destination</span>
        <dl>
          <div>
            <dt>File path</dt>
            <dd>{job.outputPath || 'Assigned when the engine accepts the transfer.'}</dd>
          </div>
          <div>
            <dt>Total size</dt>
            <dd>{job.totalBytes ? formatBytes(job.totalBytes) : 'Unknown'}</dd>
          </div>
        </dl>
        {job.outputPath ? (
          <button
            type="button"
            className="pp-inspector-copy"
            onClick={() => {
              void copyText(job.outputPath).then((copied) =>
                setCopyStatus(
                  copied ? 'Path copied.' : 'Clipboard unavailable; select the path above.'
                )
              );
            }}
          >
            <Copy aria-hidden="true" /> Copy path
          </button>
        ) : null}
        {copyStatus ? (
          <small className="pp-copy-status" role="status">
            {copyStatus}
          </small>
        ) : null}
      </section>

      <section className="pp-inspector-section">
        <span className="pp-kicker">Integrity</span>
        <dl>
          <div>
            <dt>SHA-256</dt>
            <dd>{integrityLabel(job)}</dd>
          </div>
        </dl>
      </section>

      {job.errorMessage ? (
        <section className="pp-inspector-failure" role="status">
          <AlertTriangle aria-hidden="true" />
          <div>
            <strong>{job.errorCode || 'Transfer failed'}</strong>
            <p>{job.errorMessage}</p>
          </div>
        </section>
      ) : null}

      <section className="pp-inspector-actions">
        <span className="pp-kicker">Actions</span>
        <div className="pp-inspector-action-row">
          {job.status === 'downloading' ? (
            <button type="button" disabled={jobBusy} onClick={() => void onAction('pause', job.id)}>
              <CirclePause aria-hidden="true" /> Pause
            </button>
          ) : null}
          {job.status === 'paused' ? (
            <button
              type="button"
              disabled={jobBusy}
              onClick={() => void onAction('resume', job.id)}
            >
              <Play aria-hidden="true" /> Resume
            </button>
          ) : null}
          {job.status === 'failed' ? (
            <button type="button" disabled={jobBusy} onClick={() => void onAction('retry', job.id)}>
              <RotateCcw aria-hidden="true" /> Retry
            </button>
          ) : null}
          {activeStatuses.has(job.status) ? (
            <button
              type="button"
              className="is-danger"
              disabled={jobBusy}
              onClick={() => void onAction('cancel', job.id)}
            >
              <X aria-hidden="true" /> Cancel
            </button>
          ) : null}
        </div>
      </section>
    </aside>
  );
}

function QueueNotice({ kind }: { kind: 'loading' | 'empty' | 'stopped' }) {
  return (
    <div className="pp-transfer-notice" role="status">
      {kind === 'loading' ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : null}
      {kind === 'empty' ? <Check aria-hidden="true" /> : null}
      {kind === 'stopped' ? <CirclePause aria-hidden="true" /> : null}
      <strong>
        {kind === 'loading'
          ? 'Reading the local queue…'
          : kind === 'empty'
            ? 'No transfers yet'
            : 'Downloader starts only when requested'}
      </strong>
      <p>
        {kind === 'empty'
          ? 'Paste an HTTP(S) URL above to add the first item.'
          : kind === 'stopped'
            ? 'Paste a URL and ProtoPeek will explicitly start the configured external aria2c engine.'
            : 'Nothing is contacted while this state is loading.'}
      </p>
    </div>
  );
}

function JobState({ status }: { status: TransferJobStatus }) {
  return (
    <span className={`pp-job-state is-${status}`}>
      <i className="pp-state-dot" aria-hidden="true" /> {status}
    </span>
  );
}

function filterLabel(value: QueueFilter) {
  if (value === 'all') return 'All';
  if (value === 'active') return 'Active';
  if (value === 'completed') return 'Completed';
  return 'Failed';
}

export function safeSourceLabel(source: string) {
  if (!source) return 'Source hidden until the engine reports it.';
  try {
    const url = new URL(source);
    url.username = '';
    url.password = '';
    for (const key of Array.from(url.searchParams.keys())) {
      if (/token|key|secret|signature|credential|password|auth/i.test(key)) {
        url.searchParams.set(key, '[redacted]');
      }
    }
    return url.toString();
  } catch {
    return source.slice(0, 8 * 1024);
  }
}

function formatBytes(value: number) {
  if (!value) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** index;
  return `${amount >= 100 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function formatProgress(completed: number, total: number) {
  if (!total) return `${formatBytes(completed)} / unknown`;
  return `${formatBytes(completed)} / ${formatBytes(total)}`;
}

function formatRate(value: number) {
  return value ? `${formatBytes(value)}/s` : '0 B/s';
}

function formatETA(seconds: number, status: TransferJobStatus) {
  if (status === 'completed') return 'Done';
  if (!seconds) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m ${rest}s` : `${rest}s`;
}

function integrityLabel(job: TransferJob) {
  if (job.verificationStatus === 'verified') {
    return job.verificationMessage || 'Verified by aria2c.';
  }
  if (job.verificationStatus === 'verifying') return 'aria2c is verifying the downloaded bytes.';
  if (job.verificationStatus === 'failed') return 'Checksum verification failed.';
  if (job.verificationStatus === 'mismatch') return 'Mismatch — do not trust this artifact.';
  if (job.verificationStatus === 'pending') return 'Verification pending.';
  if (job.verificationStatus === 'unavailable') return 'Verification unavailable.';
  return 'Not requested for this transfer.';
}

async function copyText(value: string) {
  if (!navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
