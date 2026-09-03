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
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { StatusFact } from './evidence/StatusFact';
import {
  addTransferBatch,
  fetchTransferSnapshot,
  mutateTransferJob,
  mutateTransferQueue,
  startTransferEngine,
  type TransferBatchFailureCode,
  type TransferBatchResult,
  type TransferJob,
  type TransferJobStatus,
  type TransferRequestHeader,
  type TransferSnapshot,
} from './transfer-api';
import './downloader.css';

type QueueFilter = 'all' | 'active' | 'completed' | 'failed';

const activeStatuses = new Set<TransferJobStatus>(['queued', 'downloading', 'paused']);
const maxBatchJobs = 32;

type HeaderDraft = TransferRequestHeader & { id: number };

let nextHeaderID = 1;

export function Downloader() {
  const [snapshot, setSnapshot] = useState<TransferSnapshot | null>(null);
  const [selectedID, setSelectedID] = useState('');
  const [source, setSource] = useState('');
  const [outputName, setOutputName] = useState('');
  const [sha256, setSha256] = useState('');
  const [destinationDirectory, setDestinationDirectory] = useState('');
  const [jobUserAgent, setJobUserAgent] = useState('');
  const [headers, setHeaders] = useState<HeaderDraft[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
    if (advancedOpen) void import('./downloader-advanced.css');
  }, [advancedOpen]);

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

  const batchSources = useMemo(() => parseBatchSources(source), [source]);
  const batchCount = batchSources.length;

  function addHeader() {
    setHeaders((current) =>
      current.length >= 16 ? current : [...current, { id: nextHeaderID++, name: '', value: '' }]
    );
  }

  function updateHeader(id: number, field: 'name' | 'value', value: string) {
    setHeaders((current) =>
      current.map((header) => (header.id === id ? { ...header, [field]: value } : header))
    );
  }

  function removeHeader(id: number) {
    setHeaders((current) => current.filter((header) => header.id !== id));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (batchCount === 0 || busy) return;
    if (batchCount > maxBatchJobs) {
      setError(`Queue at most ${maxBatchJobs} independent URLs in one batch.`);
      return;
    }
    if (headers.some((header) => !header.name.trim() || !header.value.trim())) {
      setError('Complete or remove every request header row before queueing.');
      return;
    }
    setBusy('add');
    setError('');
    setWarning('');
    try {
      if (!snapshot?.health.ready) await startTransferEngine();
      const singleJob = batchCount === 1;
      const result = await addTransferBatch(
        batchSources.map((jobSource) => ({
          source: jobSource,
          outputName: singleJob ? outputName.trim() : undefined,
          sha256: singleJob ? sha256.trim() : undefined,
          destinationDirectory: destinationDirectory.trim(),
          userAgent: jobUserAgent.trim(),
          headers: headers.map(({ name, value }) => ({ name: name.trim(), value })),
        }))
      );
      if (result.queuedCount > 0) {
        const failedSources = result.results
          .filter((item) => !item.queued)
          .map((item) => batchSources[item.index])
          .filter((item): item is string => Boolean(item));
        setSource(failedSources.join('\n'));
        setOutputName('');
        setSha256('');
        setHeaders([]);
      }
      await refresh();
      const firstQueued = result.results.find((item) => item.queued)?.id;
      if (firstQueued) setSelectedID(firstQueued);
      const summary = batchResultMessage(result);
      if (result.queuedCount === 0) {
        setError(summary);
      } else {
        setWarning([summary, result.persistenceWarning].filter(Boolean).join(' '));
      }
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

  async function runQueueAction(action: 'pause-all' | 'resume-all') {
    if (busy) return;
    setBusy(action);
    setError('');
    setWarning('');
    try {
      const result = await mutateTransferQueue(action);
      await refresh();
      setWarning(result.persistenceWarning);
    } catch (cause) {
      await refresh();
      setError(
        cause instanceof Error
          ? cause.message
          : action === 'pause-all'
            ? 'The queue could not be paused.'
            : 'The queue could not be resumed.'
      );
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
            Queue one URL or a bounded batch of independent jobs, then inspect real local transfer
            and checksum evidence.
          </p>
        </div>
        <EngineState snapshot={snapshot} loading={loading} onRefresh={() => void refresh()} />
      </header>

      <form className="pp-download-composer" onSubmit={submit}>
        <label htmlFor="download-source">URLs · one independent job per line</label>
        <textarea
          id="download-source"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          maxLength={maxBatchJobs * (8 * 1024 + 1)}
          rows={2}
          aria-describedby="download-batch-hint"
          placeholder={'https://example.com/artifact.tar.gz\nhttps://example.com/checksums.txt'}
          value={source}
          onChange={(event) => setSource(event.target.value)}
        />
        <button
          type="submit"
          disabled={batchCount === 0 || batchCount > maxBatchJobs || Boolean(busy)}
        >
          {busy === 'add' ? (
            <LoaderCircle className="is-spinning" aria-hidden="true" />
          ) : (
            <ArrowDownToLine aria-hidden="true" />
          )}
          {snapshot?.health.ready
            ? batchCount > 1
              ? `Queue ${batchCount} downloads`
              : 'Start download'
            : batchCount > 1
              ? `Start Downloader + ${batchCount} jobs`
              : 'Start Downloader'}
        </button>
        <span id="download-batch-hint" className="pp-batch-hint">
          <strong>{batchCount}</strong>/{maxBatchJobs} jobs · each line is queued separately, never
          treated as a mirror.
        </span>
        <details
          className="pp-download-options"
          onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        >
          <summary>
            Advanced per-job options <span>loaded when opened</span>
          </summary>
          {advancedOpen ? (
            <div className="pp-download-advanced-grid">
              <section>
                <div className="pp-advanced-heading">
                  <div>
                    <strong>File integrity</strong>
                    <small>Available for a single URL.</small>
                  </div>
                  <ShieldCheck aria-hidden="true" />
                </div>
                {batchCount > 1 ? (
                  <p className="pp-advanced-note" role="status">
                    File name and checksum are disabled for batches because every line is an
                    independent artifact.
                  </p>
                ) : null}
                <label htmlFor="download-output-name">Output file name</label>
                <input
                  id="download-output-name"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={255}
                  disabled={batchCount > 1}
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
                  disabled={batchCount > 1}
                  placeholder="64 hexadecimal characters"
                  value={sha256}
                  onChange={(event) => setSha256(event.target.value)}
                />
              </section>

              <section>
                <div className="pp-advanced-heading">
                  <div>
                    <strong>Job routing</strong>
                    <small>Applied independently to every line in this batch.</small>
                  </div>
                </div>
                <label htmlFor="download-destination">Absolute destination directory</label>
                <input
                  id="download-destination"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={4 * 1024}
                  placeholder={snapshot?.config.downloadDirectory || '/absolute/path/to/downloads'}
                  value={destinationDirectory}
                  onChange={(event) => setDestinationDirectory(event.target.value)}
                />
                <label htmlFor="download-user-agent">User-Agent override</label>
                <input
                  id="download-user-agent"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={256}
                  placeholder={snapshot?.config.userAgent || 'ProtoPeek'}
                  value={jobUserAgent}
                  onChange={(event) => setJobUserAgent(event.target.value)}
                />
              </section>

              <section className="pp-advanced-headers">
                <div className="pp-advanced-heading">
                  <div>
                    <strong>Request headers</strong>
                    <small>
                      Values are masked and cleared from this form after queueing. Exact retry and
                      resume state stays only in private local transfer storage and is never
                      returned by queue or API results.
                    </small>
                  </div>
                  <button
                    type="button"
                    className="pp-header-add"
                    disabled={headers.length >= 16}
                    onClick={addHeader}
                  >
                    <Plus aria-hidden="true" /> Add header
                  </button>
                </div>
                {headers.length === 0 ? (
                  <p className="pp-advanced-note">
                    No per-job headers. ProtoPeek will not invent any.
                  </p>
                ) : (
                  <div className="pp-header-list">
                    {headers.map((header, index) => (
                      <div className="pp-header-row" key={header.id}>
                        <label htmlFor={`download-header-name-${header.id}`}>
                          Header {index + 1} name
                        </label>
                        <input
                          id={`download-header-name-${header.id}`}
                          type="text"
                          autoComplete="off"
                          spellCheck={false}
                          maxLength={128}
                          placeholder="Authorization"
                          value={header.name}
                          onChange={(event) => updateHeader(header.id, 'name', event.target.value)}
                        />
                        <label htmlFor={`download-header-value-${header.id}`}>
                          Header {index + 1} value
                        </label>
                        <input
                          id={`download-header-value-${header.id}`}
                          type="password"
                          autoComplete="new-password"
                          spellCheck={false}
                          maxLength={4 * 1024}
                          placeholder="Masked value"
                          value={header.value}
                          onChange={(event) => updateHeader(header.id, 'value', event.target.value)}
                        />
                        <button
                          type="button"
                          className="pp-header-remove"
                          onClick={() => removeHeader(header.id)}
                          aria-label={`Remove header ${index + 1}`}
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          ) : null}
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
            <div className="pp-transfer-queue-tools">
              <button
                type="button"
                disabled={
                  !snapshot?.health.ready ||
                  Boolean(busy) ||
                  (snapshot.metrics.activeCount === 0 && snapshot.metrics.queuedCount === 0)
                }
                onClick={() => void runQueueAction('pause-all')}
              >
                {busy === 'pause-all' ? (
                  <LoaderCircle className="is-spinning" aria-hidden="true" />
                ) : (
                  <Pause aria-hidden="true" />
                )}
                Pause all
              </button>
              <button
                type="button"
                disabled={
                  !snapshot?.health.ready || Boolean(busy) || snapshot.metrics.pausedCount === 0
                }
                onClick={() => void runQueueAction('resume-all')}
              >
                {busy === 'resume-all' ? (
                  <LoaderCircle className="is-spinning" aria-hidden="true" />
                ) : (
                  <Play aria-hidden="true" />
                )}
                Resume all
              </button>
              <span>
                {counts.all}/{snapshot?.config.maxTrackedJobs || '—'} tracked
              </span>
            </div>
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
          <button
            type="button"
            disabled={!job.retryAvailable}
            title={job.retryAvailable ? undefined : job.retryUnavailableReason}
            onClick={() => onAction('retry')}
            aria-label={`Retry ${job.name}`}
          >
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
          <StatusFact
            label="Downloaded"
            value={formatProgress(job.completedBytes, job.totalBytes)}
          />
          <StatusFact label="Speed" value={formatRate(job.bytesPerSecond)} />
          <StatusFact label="ETA" value={formatETA(job.etaSeconds, job.status)} />
          <StatusFact label="Connections" value={job.connections} />
        </dl>
      </section>

      <section className="pp-inspector-section">
        <span className="pp-kicker">Destination</span>
        <dl>
          <StatusFact
            label="File path"
            value={job.outputPath || 'Assigned when the engine accepts the transfer.'}
          />
          <StatusFact
            label="Total size"
            value={job.totalBytes ? formatBytes(job.totalBytes) : 'Unknown'}
          />
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
          <StatusFact label="SHA-256" value={integrityLabel(job)} />
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
            <button
              type="button"
              disabled={jobBusy || !job.retryAvailable}
              title={job.retryAvailable ? undefined : job.retryUnavailableReason}
              onClick={() => void onAction('retry', job.id)}
            >
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
        {job.status === 'failed' && !job.retryAvailable ? (
          <small className="pp-copy-status" role="status">
            {job.retryUnavailableReason ||
              'Exact retry options are unavailable. Queue a new job and re-enter any required headers.'}
          </small>
        ) : null}
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
          ? 'Paste one or more HTTP(S) URLs above; every line becomes its own queue item.'
          : kind === 'stopped'
            ? 'Queue URLs and ProtoPeek will explicitly start the configured external aria2c engine.'
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

export function parseBatchSources(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function batchResultMessage(result: TransferBatchResult) {
  if (result.failedCount === 0) return '';
  const counts = new Map<TransferBatchFailureCode | '', number>();
  for (const item of result.results) {
    if (item.queued) continue;
    counts.set(item.failureCode, (counts.get(item.failureCode) ?? 0) + 1);
  }
  const reasons = Array.from(counts.entries())
    .map(([code, count]) => `${batchFailureLabel(code)} (${count})`)
    .join(', ');
  if (result.queuedCount === 0) {
    return `No downloads were queued. ${reasons || 'The local engine rejected the batch.'}`;
  }
  return `Queued ${result.queuedCount} of ${result.requestedCount} independent downloads. ${result.failedCount} not queued: ${reasons || 'engine rejected'}.`;
}

function batchFailureLabel(code: TransferBatchFailureCode | '') {
  if (code === 'invalid_request') return 'invalid job options';
  if (code === 'engine_stopped') return 'engine stopped';
  if (code === 'queue_full') return 'queue capacity reached';
  if (code === 'insufficient_disk') return 'free-space reserve reached';
  if (code === 'cancelled') return 'request cancelled';
  return 'aria2c rejected the job';
}

export function safeSourceLabel(source: string) {
  if (!source) return 'Source hidden until the engine reports it.';
  try {
    const url = new URL(source);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'Source hidden because the engine returned an unsupported URL.';
    }
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return 'Source hidden because the engine returned an invalid URL.';
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
