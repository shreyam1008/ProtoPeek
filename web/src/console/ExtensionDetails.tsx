import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Copy, Pin, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { fetchJSON } from './api';
import {
  capabilityLabels,
  type ExtensionDefinition,
  parseExtensionObservation,
  type SetupPlatform,
  type SingleExtensionSnapshot,
} from './extension-catalog';
import type { ExtensionPack } from './extension-pack';
import { loadExtensionPack } from './extension-pack-loader';
import { useProtocolShell } from './ProtocolShellContext';
import { prepareServiceEntry } from './service-entry';
import { PageHeader } from './shell/PageHeader';
import './extension-details.css';

const statusLabels = {
  detected: 'Executable located',
  included: 'Included companion',
  missing: 'CLI not located',
  unavailable: 'Check unavailable',
  external: 'External companion',
};
export default function ExtensionDetails({
  entry,
  pinned,
  onPin,
  platform,
  onPlatform,
  previous,
  onChecked,
}: {
  entry: ExtensionDefinition;
  pinned: boolean;
  onPin: () => void;
  platform?: SetupPlatform;
  onPlatform: (platform?: SetupPlatform) => void;
  previous?: SingleExtensionSnapshot;
  onChecked: (snapshot: SingleExtensionSnapshot) => void;
}) {
  const shell = useProtocolShell();
  const [pack, setPack] = useState<ExtensionPack | null>(null);
  const [loadError, setLoadError] = useState('');
  const [request, setRequest] = useState(() => ({ id: entry.id }));
  const [snapshot, setSnapshot] = useState(previous);
  const [busy, setBusy] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [notice, setNotice] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [handoffError, setHandoffError] = useState('');
  const [copied, setCopied] = useState('');
  const controller = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const endpointInput = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    heading.current?.focus();
    return () => controller.current?.abort();
  }, []);
  useEffect(() => {
    let current = true;
    setPack(null);
    setLoadError('');
    void loadExtensionPack(request.id)
      .then((value) => {
        if (current) {
          setPack(value);
          setEndpoint(value.endpoint?.url ?? '');
        }
      })
      .catch(() => {
        if (current)
          setLoadError('Setup content could not be loaded. Try again, or return to the library.');
      });
    return () => {
      current = false;
    };
  }, [request]);
  async function check() {
    if (controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setCheckError('');
    setNotice('');
    try {
      const value = parseExtensionObservation(
        await fetchJSON<unknown>(`api/extensions?id=${encodeURIComponent(entry.id)}`, {
          signal: abort.signal,
          cache: 'no-store',
        }),
        entry.id
      );
      if (controller.current !== abort || abort.signal.aborted) return;
      setSnapshot(value);
      onChecked(value);
    } catch (cause) {
      if (!abort.signal.aborted && controller.current === abort)
        setCheckError(
          cause instanceof Error ? cause.message : 'The local tool could not be checked.'
        );
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  function cancelCheck() {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setNotice(
      'Stopped waiting for this check. Any filesystem lookup already in progress may finish on the host.'
    );
  }
  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(`${label} copied.`);
    } catch {
      setCopied('Clipboard unavailable. Select and copy the visible text.');
    }
  }
  function openEndpoint() {
    const prepared = prepareServiceEntry(endpoint, 'http');
    const result = prepared.ok
      ? shell.openHandoff(
          {
            ...prepared.handoff,
            provenance: {
              ...prepared.handoff.provenance,
              source: 'extension-library',
              path: '/extensions',
            },
          },
          { memoryOnly: true }
        )
      : prepared;
    setHandoffError(result.ok ? '' : result.error);
    if (!result.ok) endpointInput.current?.focus();
  }
  const observation = snapshot?.extensions[0];
  const route = entry.route ?? pack?.route;
  return (
    <article className="pp-extension-detail">
      <PageHeader>
        <div>
          <span className="pp-extension-level">{capabilityLabels[entry.capability]}</span>
          <h1 ref={heading} tabIndex={-1}>
            {entry.name}
          </h1>
          <p>{entry.summary}</p>
        </div>
        <button
          className="pp-extension-pin"
          type="button"
          aria-label={`${pinned ? 'Unpin' : 'Pin'} ${entry.name}`}
          aria-pressed={pinned}
          onClick={onPin}
        >
          <Pin aria-hidden="true" />
          {pinned ? 'Pinned' : 'Pin'}
        </button>
      </PageHeader>
      {loadError ? (
        <div role="alert">
          <p>{loadError}</p>
          <button type="button" onClick={() => setRequest({ id: entry.id })}>
            Retry setup
          </button>
        </div>
      ) : !pack ? (
        <p role="status">Loading this extension’s setup…</p>
      ) : (
        <>
          <div className="pp-extension-detail-actions">
            {route ? (
              <Link
                className="pp-button-secondary"
                to={route}
                search={
                  entry.id === 'wireshark'
                    ? { mode: 'live' }
                    : pack.diagnosticMode
                      ? { mode: pack.diagnosticMode }
                      : {}
                }
                preload={false}
              >
                {entry.openLabel ?? pack.openLabel ?? 'Open workbench'}
              </Link>
            ) : null}
            {pack.client ? (
              <Link
                className="pp-button-secondary"
                to="/agents"
                search={{ client: pack.client }}
                preload={false}
              >
                Configure {entry.name}
              </Link>
            ) : null}
            <a href={pack.download} target="_blank" rel="noreferrer">
              {entry.id === 'chatgpt' ? 'Open ChatGPT web' : 'Official download & install'}{' '}
              <ArrowUpRight aria-hidden="true" />
            </a>
            <a href={pack.guide} target="_blank" rel="noreferrer">
              Official guide <ArrowUpRight aria-hidden="true" />
            </a>
          </div>
          <section className="pp-panel" aria-label="Setup and requirements">
            <h2>Set up on the ProtoPeek host</h2>
            <label>
              Setup instructions for
              <select
                aria-label="Setup instructions for"
                value={platform ?? ''}
                onChange={(event) => onPlatform((event.target.value as SetupPlatform) || undefined)}
              >
                {!platform ? <option value="">Choose a system</option> : null}
                <option value="windows">Windows</option>
                <option value="darwin">macOS</option>
                <option value="linux">Linux</option>
              </select>
            </label>
            <p>
              {platform
                ? pack.setup[platform]
                : 'Choose the system running ProtoPeek. Its system can differ from the browser or your agent’s environment.'}
            </p>
            <p>{pack.afterSetup}</p>
            {pack.notes.map((note) => (
              <p className="pp-extension-note" key={note}>
                {note}
              </p>
            ))}
            {entry.id === 'wireshark' && platform === 'windows' ? (
              <a href="https://npcap.com/#download" target="_blank" rel="noreferrer">
                Npcap capture permissions and download
              </a>
            ) : null}
          </section>
          {entry.id !== 'chatgpt' ? (
            <section className="pp-panel" aria-label="Local installation observation">
              <header>
                <h2>Check the local CLI</h2>
                {busy ? (
                  <button type="button" onClick={cancelCheck}>
                    Cancel check
                  </button>
                ) : (
                  <button type="button" onClick={() => void check()}>
                    <RefreshCw aria-hidden="true" />
                    Check this host
                  </button>
                )}
              </header>
              <p>
                Locates {pack.tool} on this process’s PATH and supported install locations. It does
                not run the tool, sign in, start a service or prove readiness. aria2 may verify an
                existing included companion’s checksum.
              </p>
              {busy ? (
                <p role="status">Checking the host. No external tool is being executed.</p>
              ) : null}
              {notice ? <p role="status">{notice}</p> : null}
              {checkError ? <p role="alert">{checkError}</p> : null}
              {observation ? (
                <div className="pp-extension-observation">
                  <strong>{statusLabels[observation.status]}</strong>
                  <p>
                    Observed {new Date(snapshot?.observedAt ?? '').toLocaleString()} ·{' '}
                    {snapshot?.platform} / {snapshot?.architecture}
                  </p>
                  <p>{observation.message}</p>
                  {observation.path ? <code>{observation.path}</code> : null}
                  {observation.bundled ? (
                    <p>
                      This build includes an aria2 companion (
                      {(observation.bundledBytes / 1024 / 1024).toFixed(2)} MiB). It is prepared
                      only when Downloader is started.
                    </p>
                  ) : null}
                </div>
              ) : (
                <p>
                  Not checked. Install separately if needed, then check this host. Restart ProtoPeek
                  after a PATH change.
                </p>
              )}
            </section>
          ) : null}
          {pack.endpoint ? (
            <section className="pp-panel" aria-label="Prepare endpoint request">
              <h2>Inspect your endpoint</h2>
              <p>{pack.endpoint.notice}</p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  openEndpoint();
                }}
              >
                <label>
                  Endpoint URL
                  <input
                    ref={endpointInput}
                    value={endpoint}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={!!handoffError}
                    onChange={(event) => {
                      setEndpoint(event.target.value);
                      setHandoffError('');
                    }}
                  />
                </label>
                <button type="submit">Open HTTP draft</button>
              </form>
              {handoffError ? <p role="alert">{handoffError}</p> : null}
              <p>No probe runs here. Review the prepared request and choose Send in HTTP.</p>
            </section>
          ) : null}
          {pack.commands?.length ? (
            <section className="pp-panel pp-extension-recipes" aria-label="Manual recipes">
              <h2>{entry.id === 'chatgpt' ? 'A starting prompt' : 'Use in your own terminal'}</h2>
              <p>
                {entry.id === 'chatgpt'
                  ? 'This fixed template contains no local evidence.'
                  : 'Review placeholders and permissions before running these examples. Copying a command executes nothing. You own any process or forward you start.'}
              </p>
              {pack.commands.map((command) => (
                <div key={command.label}>
                  <header>
                    <h3>{command.label}</h3>
                    <button
                      type="button"
                      onClick={() => void copy(command.label, command.text)}
                      aria-label={`Copy ${command.label}`}
                    >
                      <Copy aria-hidden="true" />
                      Copy
                    </button>
                  </header>
                  <textarea
                    readOnly
                    aria-label={`${command.label} text`}
                    value={command.text}
                    rows={Math.min(8, command.text.split('\n').length + 1)}
                  />
                </div>
              ))}
              {copied ? <p role="status">{copied}</p> : null}
            </section>
          ) : null}
        </>
      )}
    </article>
  );
}
