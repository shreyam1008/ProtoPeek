import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Cloud, Download, Network, Radar, RefreshCw, Waves } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchJSON } from './api';
import {
  type ExtensionDefinition,
  type ExtensionObservation,
  type ExtensionSnapshot,
  extensionCatalog,
  parseExtensionSnapshot,
  type SetupPlatform,
  setupPlatform,
} from './extension-catalog';
import { PageHeader } from './shell/PageHeader';
import './extensions.css';

const icons = {
  netbird: Network,
  tailscale: Network,
  cloudflared: Cloud,
  wireshark: Waves,
  nmap: Radar,
  aria2: Download,
};
const statusLabels = {
  detected: 'Detected',
  included: 'Included',
  missing: 'Not found',
  unavailable: 'Unavailable',
};
const groups = ['Connect & publish', 'Inspect traffic & services', 'Transfer files'] as const;
const platformLabels = { windows: 'Windows', darwin: 'macOS', linux: 'Linux' };

export function Extensions() {
  const [snapshot, setSnapshot] = useState<ExtensionSnapshot | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState<SetupPlatform | ''>('');
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError('');
    void fetchJSON<unknown>('api/extensions', {
      signal: controller.signal,
      cache: revision > 0 ? 'reload' : 'default',
    })
      .then(parseExtensionSnapshot)
      .then((value) => {
        if (!controller.signal.aborted) setSnapshot(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Could not check local tools.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [revision]);
  const platform = selectedPlatform || setupPlatform(snapshot?.platform);
  return (
    <div className="pp-extensions">
      <PageHeader>
        <div>
          <p className="pp-eyebrow">Extensions</p>
          <h1>Add only what you need.</h1>
          <p>
            Connect optional services and local tools. Install them on the computer running
            ProtoPeek, then open their workbench.
          </p>
        </div>
        <button
          className="pp-button-secondary"
          type="button"
          disabled={busy}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={16} aria-hidden="true" data-loading={busy || undefined} />
          {busy ? 'Checking tools…' : 'Refresh tools'}
        </button>
      </PageHeader>
      <aside className="pp-panel pp-extensions-base" aria-label="Included base tools">
        <strong>Your base workbench is ready.</strong>
        <p>
          HTTP and gRPC, nearby devices, TCP ports, network paths, and packet-file reading work
          without these tools.
        </p>
        <div>
          <Link to="/protocols">Inspect an API</Link>
          <Link to="/network/local">See nearby devices</Link>
          <Link to="/network/packets" search={{ mode: 'file' }}>
            Read a packet file
          </Link>
        </div>
      </aside>
      <div className="pp-extensions-context">
        <p role="status">
          {error
            ? 'Local status unavailable. Setup guides and workbenches are still available.'
            : busy
              ? 'Looking for local executables. No services are started.'
              : snapshot
                ? `Checked this ProtoPeek host at ${new Date(snapshot.observedAt).toLocaleTimeString()}. Detected does not mean connected or ready.`
                : 'Local tools have not been checked.'}
        </p>
        <label>
          Setup instructions
          <select
            aria-label="Setup instructions for"
            value={platform ?? ''}
            onChange={(event) => setSelectedPlatform(event.target.value as SetupPlatform | '')}
          >
            <option value="">Choose a system</option>
            <option value="windows">Windows</option>
            <option value="darwin">macOS</option>
            <option value="linux">Linux</option>
          </select>
        </label>
      </div>
      {error ? (
        <p className="pp-operation-banner is-danger" role="alert">
          {error}
        </p>
      ) : null}
      {groups.map((group) => (
        <section className="pp-extension-group" key={group} aria-label={group}>
          <h2>{group}</h2>
          {group === 'Connect & publish' ? (
            <p>
              <Link to="/extensions/publish">Share a local service</Link> with a reviewed, temporary
              session, then stop it here.
            </p>
          ) : null}
          <div className="pp-extension-grid">
            {extensionCatalog
              .filter((entry) => entry.group === group)
              .map((entry) => (
                <ExtensionCard
                  key={entry.id}
                  entry={entry}
                  observation={
                    error ? undefined : snapshot?.extensions.find((item) => item.id === entry.id)
                  }
                  platform={platform}
                  busy={busy}
                />
              ))}
          </div>
        </section>
      ))}
      <p className="pp-extensions-footnote">
        Integration screens ship with ProtoPeek and load when opened. External tools are installed
        separately; bundled companions are marked above.
      </p>
    </div>
  );
}

function ExtensionCard({
  entry,
  observation,
  platform,
  busy,
}: {
  entry: ExtensionDefinition;
  observation?: ExtensionObservation;
  platform?: SetupPlatform;
  busy: boolean;
}) {
  const Icon = icons[entry.id];
  return (
    <article className="pp-panel pp-extension-card" aria-labelledby={`extension-${entry.id}`}>
      <div className="pp-extension-card-heading">
        <span className="pp-extension-icon">
          <Icon aria-hidden="true" />
        </span>
        <div>
          <h3 id={`extension-${entry.id}`}>{entry.name}</h3>
          <span>{entry.tool}</span>
        </div>
        <span className={`pp-extension-status is-${observation?.status ?? 'unknown'}`}>
          {busy ? 'Checking…' : observation ? statusLabels[observation.status] : 'Not checked'}
        </span>
      </div>
      <p>{entry.summary}</p>
      {observation?.bundled ? (
        <p className="pp-extension-included">
          This build includes an aria2 companion (
          {(observation.bundledBytes / 1024 / 1024).toFixed(2)} MiB).
        </p>
      ) : null}
      <div className="pp-extension-actions">
        <Link
          className="pp-button-secondary"
          to={entry.route}
          search={entry.id === 'wireshark' ? { mode: 'live' as const } : {}}
          preload={false}
        >
          {entry.openLabel}
        </Link>
        <a href={entry.download} target="_blank" rel="noreferrer">
          Get{' '}
          {entry.id === 'cloudflared'
            ? 'cloudflared'
            : entry.id === 'wireshark'
              ? 'Wireshark'
              : entry.name}
          <ArrowUpRight aria-hidden="true" />
        </a>
      </div>
      <details className="pp-extension-setup">
        <summary>Setup & requirements</summary>
        <div>
          <p>
            {platform
              ? entry.setup[platform]
              : 'Choose the system running ProtoPeek above to see installation guidance.'}
          </p>
          {platform ? (
            <span className="pp-extension-platform">
              Instructions for {platformLabels[platform]}
            </span>
          ) : null}
          <p>{entry.afterSetup}</p>
          {observation ? <p className="pp-extension-observation">{observation.message}</p> : null}
          {observation?.path ? <code className="pp-extension-path">{observation.path}</code> : null}
          <a href={entry.guide} target="_blank" rel="noreferrer">
            Official setup guide <ArrowUpRight aria-hidden="true" />
          </a>
          {entry.id === 'wireshark' && platform === 'windows' ? (
            <a href="https://npcap.com/#download" target="_blank" rel="noreferrer">
              Npcap for Windows <ArrowUpRight aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </details>
    </article>
  );
}
