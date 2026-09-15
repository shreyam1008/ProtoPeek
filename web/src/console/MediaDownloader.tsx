import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJSON } from './api';
import { DirectoryPicker } from './DirectoryPicker';
import { OperationStatus } from './shell/OperationStatus';
import { PageHeader } from './shell/PageHeader';
import './media-downloader.css';

type Tool = {
  name: string;
  path: string;
  version: string;
  installBytes: number;
  canInstall: boolean;
  help: string;
};
type Job = {
  id: string;
  request: { url: string; engine: string };
  status: string;
  message: string;
  directory: string;
  bytes: number;
  total: number;
  speed: number;
  eta: number;
  files: number;
};
type Snapshot = { tools: Tool[]; jobs: Job[]; directory: string };
const active = (job: Job) =>
  ['queued', 'downloading', 'processing', 'cancelling'].includes(job.status);
function size(bytes: number) {
  return `${(bytes / 1048576).toFixed(1)} MiB`;
}
const choices = [
  {
    id: 'native-go',
    title: 'Direct & page media',
    description: 'Built-in Go · files, page images and HTML snapshots',
  },
  {
    id: 'yt-dlp',
    title: 'Video & audio',
    description: 'YouTube, playlists and supported social video',
  },
  {
    id: 'gallery-dl',
    title: 'Images & galleries',
    description: 'Albums, collections and supported image sites',
  },
  {
    id: 'archivebox',
    title: 'Webpage archive',
    description: 'HTML, screenshots and PDFs with ArchiveBox',
  },
];

export default function MediaDownloader() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [engine, setEngine] = useState('native-go');
  const [url, setURL] = useState('');
  const [format, setFormat] = useState('auto');
  const [directory, setDirectory] = useState('');
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(1);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<{
    title: string;
    items: { url: string; kind: string }[];
    truncated: boolean;
  } | null>(null);
  const operation = useRef<AbortController | null>(null);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const next = await fetchJSON<Snapshot>('api/media/snapshot', { signal });
    if (!signal?.aborted) {
      setSnapshot(next);
      setDirectory((current) => current || next.directory);
    }
  }, []);
  const moving = snapshot?.jobs.some(active) ?? false;
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function update() {
      if (document.hidden || controller.signal.aborted) return;
      try {
        await refresh(controller.signal);
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Cannot load the queue.');
      }
      if (moving && !controller.signal.aborted) timer = setTimeout(update, 1500);
    }
    function visibility() {
      clearTimeout(timer);
      if (!document.hidden) void update();
    }
    void update();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [refresh, moving]);
  useEffect(() => () => operation.current?.abort(), []);
  async function mutate(path: string, body: unknown, label: string) {
    const controller = new AbortController();
    operation.current = controller;
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await fetchJSON(`api/media/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        await refresh(controller.signal);
        if (path === 'add') setNotice('Queued. Downloads continue while ProtoPeek is running.');
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Operation failed.');
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setBusy('');
      }
    }
  }
  const tool = snapshot?.tools.find((item) => item.name === engine);
  const ffmpeg = snapshot?.tools.find((item) => item.name === 'ffmpeg');
  return (
    <div className="pp-media-downloader">
      <PageHeader>
        <div>
          <h1>Media downloader</h1>
          <p>Save videos, albums and webpages to your device.</p>
        </div>
      </PageHeader>
      <div className="pp-media-types">
        {choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            aria-pressed={engine === choice.id}
            onClick={() => {
              setEngine(choice.id);
              setFormat(choice.id === 'native-go' ? 'auto' : 'video');
              setPreview(null);
            }}
          >
            <strong>{choice.title}</strong>
            <span>{choice.description}</span>
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="pp-media-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <section className="pp-media-setup" aria-label="Engine setup">
        <div>
          <strong>
            {engine} {tool?.path ? '· Ready' : '· Setup needed'}
          </strong>
          <p>{tool?.help ?? 'Reading local capabilities…'}</p>
        </div>
        {tool &&
          tool.canInstall &&
          (!tool.path || (engine === 'yt-dlp' && tool.installBytes > 0)) && (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() =>
                void mutate(
                  'install',
                  { engine },
                  `Installing ${engine} · ${size(tool.installBytes)}`
                )
              }
            >
              {tool.path ? 'Complete setup' : `Install ${engine}`} · {size(tool.installBytes)}
            </button>
          )}
        {engine === 'archivebox' && !tool?.path && (
          <a
            href="https://github.com/ArchiveBox/ArchiveBox#quickstart"
            target="_blank"
            rel="noreferrer"
          >
            ArchiveBox setup
          </a>
        )}
        {engine === 'gallery-dl' && tool && !tool.path && !tool.canInstall && (
          <a
            href="https://github.com/mikf/gallery-dl#installation"
            target="_blank"
            rel="noreferrer"
          >
            Installation instructions
          </a>
        )}
      </section>
      <OperationStatus busy={Boolean(busy)} label={busy} />
      {(busy.startsWith('Installing') || busy === 'Inspecting page') && (
        <button
          type="button"
          onClick={() => {
            operation.current?.abort();
            setBusy('');
            setNotice('Operation cancelled.');
          }}
        >
          Cancel operation
        </button>
      )}
      <form
        className="pp-media-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void mutate('add', { url, engine, format, directory, start, end }, 'Adding to queue');
        }}
      >
        <label htmlFor="media-url">Link to save</label>
        <input
          id="media-url"
          type="url"
          required
          value={url}
          maxLength={8192}
          onChange={(event) => {
            setURL(event.target.value);
            setPreview(null);
          }}
          placeholder={
            engine === 'yt-dlp'
              ? 'YouTube video, playlist or another media URL'
              : engine === 'gallery-dl'
                ? 'Image, album or gallery URL'
                : 'Webpage URL'
          }
        />
        {engine === 'native-go' && (
          <>
            <button
              type="button"
              disabled={Boolean(busy) || !url}
              onClick={async () => {
                const controller = new AbortController();
                operation.current = controller;
                setBusy('Inspecting page');
                setError('');
                setPreview(null);
                try {
                  const result = await fetchJSON<{
                    title: string;
                    items: { url: string; kind: string }[];
                    truncated: boolean;
                  }>('api/media/inspect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url }),
                    signal: controller.signal,
                  });
                  if (!controller.signal.aborted) setPreview(result);
                } catch (cause) {
                  if (!controller.signal.aborted) setError(String(cause));
                } finally {
                  if (operation.current === controller) {
                    operation.current = null;
                    setBusy('');
                  }
                }
              }}
            >
              Find media on this page
            </button>
            {preview && (
              <details open>
                <summary>
                  {preview.title} · {preview.items.length} media links
                  {preview.truncated ? ' (first 100)' : ''}
                </summary>
                <ol>
                  {preview.items.map((item) => (
                    <li key={item.url}>
                      <small>
                        {item.kind} · {item.url}
                      </small>
                    </li>
                  ))}
                </ol>
                {preview.items.length === 0 && (
                  <p>
                    No direct media links found. Try a site engine for script-generated content.
                  </p>
                )}
              </details>
            )}
          </>
        )}
        <div className="pp-media-options">
          {engine === 'native-go' && (
            <label>
              Save as
              <select value={format} onChange={(event) => setFormat(event.target.value)}>
                <option value="auto">All detected media</option>
                <option value="images">Page images</option>
                <option value="video">Video links</option>
                <option value="audio">Audio links</option>
                <option value="page">Original HTML · linked assets stay external</option>
              </select>
            </label>
          )}
          {engine === 'yt-dlp' && (
            <label>
              Save as
              <select value={format} onChange={(event) => setFormat(event.target.value)}>
                <option value="video">Best available video</option>
                <option value="720">Video up to 720p</option>
                <option value="audio">Audio · original format</option>
              </select>
            </label>
          )}
          {engine !== 'archivebox' && (
            <>
              <label>
                First item
                <input
                  type="number"
                  min={1}
                  max={10000}
                  required
                  value={start}
                  onChange={(event) => setStart(Number(event.target.value))}
                />
              </label>
              <label>
                Last item
                <input
                  type="number"
                  min={start}
                  max={Math.min(start + 99, 10000)}
                  required
                  value={end}
                  onChange={(event) => setEnd(Number(event.target.value))}
                />
              </label>
            </>
          )}
        </div>
        {engine !== 'archivebox' && (
          <small>
            One item by default. For playlists or galleries, choose up to 100 items per job.
            Positions follow the source order.
          </small>
        )}
        <label htmlFor="media-directory">Destination folder</label>
        <div className="pp-media-destination">
          <input
            id="media-directory"
            required
            value={directory}
            onChange={(event) => setDirectory(event.target.value)}
          />
          <DirectoryPicker initialPath={directory} onChoose={setDirectory} />
        </div>
        {engine === 'yt-dlp' && !ffmpeg?.path && (
          <small>
            FFmpeg is missing: video is limited to formats that already contain audio. One-click
            setup includes FFmpeg where a managed build is available.
          </small>
        )}
        <div className="pp-media-submit">
          <small>
            Each job gets its own folder. Support and speed depend on the site; private and
            DRM-protected media may be unavailable.
          </small>
          <button type="submit" disabled={Boolean(busy) || !tool?.path}>
            Queue download
          </button>
        </div>
      </form>
      <section aria-label="Media queue" className="pp-media-queue">
        <div className="pp-media-queue-heading">
          <h2>
            Downloads <small>{snapshot?.jobs.length ?? 0}</small>
          </h2>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void refresh().catch((cause) => setError(String(cause)))}
          >
            Refresh
          </button>
        </div>
        {snapshot?.jobs.length === 0 && (
          <p>Paste a link above to start. Your saved files stay on this device.</p>
        )}
        {snapshot?.jobs.map((job) => (
          <article className="pp-media-job" key={job.id}>
            <div className="pp-media-job-heading">
              <strong>{job.request.engine}</strong>
              <span>{job.status}</span>
            </div>
            <p className="pp-media-url">{job.request.url}</p>
            {active(job) && (
              <progress
                aria-label={`Download progress for ${job.request.url}`}
                max={job.total > 0 && job.status === 'downloading' ? job.total : undefined}
                value={
                  job.total > 0 && job.status === 'downloading'
                    ? Math.min(job.bytes, job.total)
                    : undefined
                }
              />
            )}
            <small>
              {job.status === 'processing'
                ? 'Processing media…'
                : job.total > 0
                  ? `${size(job.bytes)} / ${size(job.total)}${job.speed > 0 ? ` · ${size(job.speed)}/s` : ''}${job.eta > 0 ? ` · ${Math.ceil(job.eta)}s remaining` : ''}`
                  : active(job)
                    ? 'Extracting or transferring; total size is not available yet.'
                    : ''}
              {job.files > 0 ? ` · ${job.files} files saved` : ''}
            </small>
            {job.message && <p>{job.message}</p>}
            <code>{job.directory}</code>
            <div className="pp-media-job-actions">
              {active(job) ? (
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void mutate('action', { id: job.id, action: 'cancel' }, 'Cancelling download')
                  }
                >
                  Cancel
                </button>
              ) : (
                <>
                  {job.status !== 'completed' && (
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void mutate('action', { id: job.id, action: 'retry' }, 'Retrying download')
                      }
                    >
                      Retry
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void mutate('action', { id: job.id, action: 'forget' }, 'Removing history')
                    }
                  >
                    Remove from history
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </section>
      <details>
        <summary>Local engines & supported formats</summary>
        {snapshot?.tools.map((item) => (
          <p key={item.name}>
            <strong>{item.name}</strong> · {item.path || 'Not installed'}
            {item.version ? ` · managed release ${item.version}` : ''}
            <br />
            {item.help}
          </p>
        ))}
        <p>
          Optional engines are downloaded separately and checked against pinned SHA-256 hashes. No
          cloud relay is required.
        </p>
      </details>
    </div>
  );
}
