import { Link } from '@tanstack/react-router';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Copy,
  Laptop,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJSON } from './api';
import { DirectoryPicker } from './DirectoryPicker';
import { PageHeader } from './shell/PageHeader';
import './local-transfer.css';

type Peer = { id: string; name: string; address: string };
type Job = {
  id: string;
  name: string;
  peer: string;
  direction: string;
  size: number;
  bytes: number;
  state: string;
  error?: string;
  path?: string;
  sha256?: string;
  started: string;
};
type Snapshot = {
  running: boolean;
  name: string;
  fingerprint: string;
  directory: string;
  addresses: string[];
  warning: string;
  peers: Peer[];
  jobs: Job[];
};
const active = new Set(['waiting', 'pending', 'sending', 'receiving']);
const bytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 ** 2
      ? `${(n / 1024).toFixed(1)} KB`
      : n < 1024 ** 3
        ? `${(n / 1024 ** 2).toFixed(1)} MB`
        : `${(n / 1024 ** 3).toFixed(2)} GB`;
const command = (action: string, body: object = {}, signal?: AbortSignal) =>
  fetchJSON<Snapshot>(`api/local-share/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

export function LocalTransfer() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [name, setName] = useState('My device');
  const [directory, setDirectory] = useState('');
  const [invitation, setInvitation] = useState('');
  const [selected, setSelected] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const sendController = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const mounted = useRef(true);
  const peer = snapshot?.peers.find((p) => p.id === selected);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await command('snapshot', {}, signal);
      if (!signal?.aborted && mounted.current) setSnapshot(next);
    } catch (cause) {
      if (!signal?.aborted && mounted.current)
        setError(cause instanceof Error ? cause.message : 'Could not read transfers.');
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => {
      mounted.current = false;
      controller.abort();
      sendController.current?.abort();
    };
  }, [refresh]);
  useEffect(() => {
    if (!snapshot?.running) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState !== 'hidden') await refresh(controller.signal);
      if (!controller.signal.aborted) timer = setTimeout(poll, 1000);
    };
    timer = setTimeout(poll, 1000);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [snapshot?.running, refresh]);
  async function run(action: string, body: object = {}) {
    setBusy(action);
    setError('');
    setNotice('');
    try {
      const next = await command(action, body);
      if (mounted.current) setSnapshot(next);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Operation failed.');
    } finally {
      if (mounted.current) setBusy('');
    }
  }
  async function connect() {
    const [address, fingerprint] = invitation.trim().split('#');
    if (!address || !fingerprint) {
      setError('Paste the receiver’s connection text: IP:port#fingerprint');
      return;
    }
    await run('connect', { address, fingerprint });
    setSelected(fingerprint.toLowerCase());
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('Connection copied. Share it with the sender.');
    } catch {
      setError('Clipboard unavailable. Select and copy the connection text below.');
    }
  }
  async function send() {
    if (!peer || !files.length) return;
    const controller = new AbortController();
    sendController.current = controller;
    setSending(true);
    setError('');
    setNotice('');
    try {
      for (const file of files) {
        const query = new URLSearchParams({ peer: peer.id, name: file.name });
        await fetchJSON(`api/local-share/send?${query}`, {
          method: 'POST',
          body: file,
          signal: controller.signal,
        });
        if (mounted.current) setFiles((remaining) => remaining.filter((item) => item !== file));
      }
      if (mounted.current) {
        setNotice('Files received and checksums matched.');
        if (fileInput.current) fileInput.current.value = '';
        setFiles([]);
      }
    } catch (cause) {
      if (mounted.current)
        setError(
          controller.signal.aborted
            ? 'Sending cancelled. Completed files remain on the receiver.'
            : cause instanceof Error
              ? cause.message
              : 'Send failed.'
        );
    } finally {
      if (mounted.current) {
        setSending(false);
        void refresh();
      }
      sendController.current = null;
    }
  }
  return (
    <main className="pp-local-transfer">
      <PageHeader>
        <div>
          <span className="pp-share-eyebrow">FILES / LOCAL TRANSFER</span>
          <h1>Send it directly.</h1>
          <p>Files between your devices, over LAN or an existing private network.</p>
        </div>
        <span className="pp-share-status">
          <Radio size={14} />
          {snapshot?.running ? 'Discoverable' : 'Offline'}
        </span>
      </PageHeader>
      {error && (
        <p role="alert" className="pp-share-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {snapshot?.jobs
        .filter((job) => job.state === 'pending')
        .map((job) => (
          <section className="pp-share-incoming" aria-label="Incoming file" key={job.id}>
            <ArrowDownToLine size={22} />
            <div>
              <strong>
                {job.peer} wants to send {job.name}
              </strong>
              <p>
                {bytes(job.size)} · Save into {snapshot.directory}
              </p>
            </div>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void run('decide', { id: job.id, accept: true })}
            >
              Accept file
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void run('decide', { id: job.id, accept: false })}
            >
              Decline
            </button>
          </section>
        ))}
      {!snapshot ? (
        <p role="status">Loading local transfer…</p>
      ) : !snapshot.running ? (
        <section className="pp-share-setup">
          <Laptop size={28} />
          <h2>Make this device available</h2>
          <p>Choose where incoming files go. You decide which files to accept.</p>
          <label>
            Device name
            <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Receive folder
            <input
              value={directory}
              placeholder="Choose a folder on this computer"
              onChange={(e) => setDirectory(e.target.value)}
            />
          </label>
          <DirectoryPicker initialPath={directory} onChoose={setDirectory} />
          <button
            className="pp-share-primary"
            type="button"
            disabled={!!busy || !name.trim() || !directory}
            onClick={() => void run('start', { name, directory })}
          >
            {busy === 'start' ? 'Enabling…' : 'Enable local transfer'}
          </button>
          <small>Available for one hour, or until you stop it. Uses TCP and UDP port 53318.</small>
        </section>
      ) : (
        <>
          <section className="pp-share-identity">
            <div>
              <strong>{snapshot.name}</strong>
              <span>Receiving into {snapshot.directory}</span>
            </div>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => {
                sendController.current?.abort();
                void run('stop');
              }}
            >
              Stop sharing
            </button>
            <details>
              <summary>Connection details for LAN or VPN</summary>
              <p>Send one of these to the other device. Choose an address it can reach.</p>
              {snapshot.addresses.map((address) => (
                <div className="pp-share-connection" key={address}>
                  <code>
                    {address}#{snapshot.fingerprint}
                  </code>
                  <button
                    type="button"
                    aria-label={`Copy connection for ${address}`}
                    onClick={() => void copy(`${address}#${snapshot.fingerprint}`)}
                  >
                    <Copy size={15} />
                  </button>
                </div>
              ))}
              <p>
                Session fingerprint: <code>{snapshot.fingerprint}</code>
              </p>
            </details>
          </section>
          {snapshot.warning && <p role="status">{snapshot.warning}</p>}
          <div className="pp-share-columns">
            <section>
              <div className="pp-share-section-title">
                <h2>1. Choose a device</h2>
                <button type="button" disabled={!!busy} onClick={() => void run('discover')}>
                  <RefreshCw size={14} />
                  Find nearby
                </button>
              </div>
              <div className="pp-share-peers">
                {snapshot.peers.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    aria-pressed={p.id === selected}
                    aria-label={`${p.name} ${p.address}`}
                    onClick={() => setSelected(p.id)}
                    disabled={sending}
                  >
                    <Laptop size={22} />
                    <span>
                      <strong>{p.name}</strong>
                      <small>{p.address}</small>
                    </span>
                    {p.id === selected && <Check size={16} />}
                  </button>
                ))}
              </div>
              {!snapshot.peers.length && (
                <div className="pp-share-empty">
                  <Radio size={24} />
                  <p>No devices nearby yet.</p>
                  <small>
                    Enable local transfer in ProtoPeek on the other device. If discovery is blocked,
                    paste its connection below.
                  </small>
                </div>
              )}
              <details open={!snapshot.peers.length}>
                <summary>Connect by address / VPN</summary>
                <label>
                  Receiver connection
                  <input
                    value={invitation}
                    onChange={(e) => setInvitation(e.target.value)}
                    placeholder="IP:port#fingerprint"
                    spellCheck={false}
                  />
                </label>
                <button
                  type="button"
                  disabled={!!busy || sending || !invitation.trim()}
                  onClick={() => void connect()}
                >
                  Connect device
                </button>
                <p>
                  Works over reachable Tailscale or WireGuard addresses.{' '}
                  <Link to="/network/tailnet">Open Tailscale devices</Link>
                </p>
              </details>
            </section>
            <section>
              <h2>2. Choose files</h2>
              <label className="pp-share-drop">
                <ArrowUpFromLine size={26} />
                <strong>Select files to send</strong>
                <span>Streamed directly. No cloud upload.</span>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  disabled={sending}
                  onChange={(e) => {
                    const next = Array.from(e.target.files ?? []);
                    if (next.length > 32) {
                      setError('Choose up to 32 files at a time.');
                      return;
                    }
                    setFiles(next);
                  }}
                />
              </label>
              {files.length > 0 && (
                <ul className="pp-share-file-list">
                  {files.map((f) => (
                    <li key={`${f.name}-${f.size}-${f.lastModified}`}>
                      <span>{f.name}</span>
                      <small>{bytes(f.size)}</small>
                    </li>
                  ))}
                </ul>
              )}
              {peer && (
                <div className="pp-share-target">
                  <strong>To {peer.name}</strong>
                  <small>
                    Check this fingerprint against the receiver’s connection details before sending
                    sensitive files. Device names are self-reported.
                  </small>
                  <code>{peer.id}</code>
                </div>
              )}
              <button
                className="pp-share-primary"
                type="button"
                disabled={!peer || !files.length || sending || !!busy}
                onClick={() => void send()}
              >
                <Send size={16} />
                {sending
                  ? 'Sending · receiver must accept each file'
                  : `Send${files.length ? ` ${files.length} file${files.length === 1 ? '' : 's'}` : ' files'}`}
              </button>
              {sending && (
                <button type="button" onClick={() => sendController.current?.abort()}>
                  Cancel sending
                </button>
              )}
            </section>
          </div>
        </>
      )}
      {!!snapshot?.jobs.length && (
        <section className="pp-share-history">
          <h2>
            Transfers <span>{snapshot.jobs.length}</span>
          </h2>
          {snapshot.jobs
            .filter((job) => job.state !== 'pending')
            .map((job) => {
              const rate = job.bytes / Math.max(1, (Date.now() - Date.parse(job.started)) / 1000);
              return (
                <article key={job.id}>
                  <div className="pp-share-job-title">
                    {job.direction === 'receive' ? (
                      <ArrowDownToLine size={18} />
                    ) : (
                      <ArrowUpFromLine size={18} />
                    )}
                    <strong>{job.name}</strong>
                    <span>{job.state === 'waiting' ? 'Waiting for peer' : job.state}</span>
                  </div>
                  <small>
                    {job.peer} · {bytes(job.size)}
                  </small>
                  {job.state === 'pending' ? (
                    <div className="pp-share-actions">
                      <span>Accept this file into {snapshot.directory}?</span>
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => void run('decide', { id: job.id, accept: true })}
                      >
                        Accept file
                      </button>
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => void run('decide', { id: job.id, accept: false })}
                      >
                        Decline
                      </button>
                    </div>
                  ) : active.has(job.state) ? (
                    <>
                      <progress
                        aria-label={`${job.name} progress`}
                        value={job.bytes}
                        max={Math.max(1, job.size)}
                      />
                      <div className="pp-share-actions">
                        <small>
                          {bytes(job.bytes)} / {bytes(job.size)} · {bytes(rate)}/s average
                        </small>
                        <button
                          type="button"
                          aria-label={`Cancel ${job.name}`}
                          onClick={() => void run('cancel', { id: job.id })}
                        >
                          <X size={14} />
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : null}
                  {job.error && <p className="pp-share-error">{job.error}</p>}
                  {job.path && (
                    <p>
                      Saved: <code>{job.path}</code>
                    </p>
                  )}
                  {job.sha256 && (
                    <details>
                      <summary>
                        <ShieldCheck size={14} /> SHA-256{' '}
                        {job.direction === 'send' ? 'matched receiver' : 'of received file'}
                      </summary>
                      <code>{job.sha256}</code>
                    </details>
                  )}
                </article>
              );
            })}
        </section>
      )}
      <footer>
        Direct encrypted transfer · No bandwidth cap · Speed depends on your network and storage.
        <br />
        Both devices need this ProtoPeek feature. VPN setup and internet relays are managed by your
        VPN.
      </footer>
    </main>
  );
}
