import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { fetchJSON } from './api';

type ManagedID = 'cloudflared' | 'aria2';
type Tool = {
  id: ManagedID;
  status: 'available' | 'installed' | 'external' | 'unavailable' | 'invalid';
  version: string;
  installBytes: number;
  canInstall: boolean;
  canRemove: boolean;
  message: string;
  sourceUrl?: string;
};

function parseTool(value: unknown, id: ManagedID): Tool {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid companion status.');
  const v = value as Record<string, unknown>;
  if (
    v.id !== id ||
    !['available', 'installed', 'external', 'unavailable', 'invalid'].includes(String(v.status)) ||
    typeof v.version !== 'string' ||
    v.version.length > 128 ||
    !Number.isSafeInteger(v.installBytes) ||
    (v.installBytes as number) < 0 ||
    typeof v.canInstall !== 'boolean' ||
    typeof v.canRemove !== 'boolean' ||
    typeof v.message !== 'string' ||
    v.message.length > 2048 ||
    (v.sourceUrl !== undefined &&
      (typeof v.sourceUrl !== 'string' ||
        v.sourceUrl.length > 2048 ||
        !v.sourceUrl.startsWith(
          id === 'cloudflared'
            ? 'https://github.com/cloudflare/cloudflared/releases/download/'
            : 'https://github.com/aria2/aria2/releases/download/'
        ))) ||
    (v.canRemove && v.status !== 'installed') ||
    (v.canInstall && v.status !== 'available' && v.status !== 'external')
  )
    throw new Error('Invalid companion status.');
  return v as Tool;
}

export function ManagedExtension({ id }: { id: ManagedID }) {
  const [tool, setTool] = useState<Tool | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'install' | 'remove' | null>(null);
  const [notice, setNotice] = useState('');
  const [removalFailed, setRemovalFailed] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function request(action?: 'install' | 'remove') {
    if (controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setNotice('');
    setRemovalFailed(false);
    setConfirm(null);
    try {
      const result = await fetchJSON<unknown>(
        action ? `api/extensions/managed/${action}` : `api/extensions/managed?id=${id}`,
        action
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id }),
              signal: abort.signal,
            }
          : { cache: 'no-store', signal: abort.signal }
      );
      if (controller.current === abort && !abort.signal.aborted) setTool(parseTool(result, id));
    } catch (error) {
      if (controller.current === abort && !abort.signal.aborted) {
        setTool(null);
        setRemovalFailed(action === 'remove');
        setNotice(error instanceof Error ? error.message : 'Could not check the companion.');
      }
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  function stop() {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setTool(null);
    setNotice(
      'Stopped waiting. Check the status before trying again; an operation already in progress may finish.'
    );
  }
  return (
    <section className="pp-panel pp-managed-extension" aria-label="Optional managed companion">
      <h2>Optional managed companion</h2>
      {busy ? (
        <>
          <p role="status">Working on the host…</p>
          <button type="button" onClick={stop}>
            Stop waiting
          </button>
        </>
      ) : (
        <button type="button" onClick={() => void request()}>
          Check companion status
        </button>
      )}
      {notice ? <p role="status">{notice}</p> : null}
      {removalFailed ? (
        id === 'aria2' ? (
          <Link to="/settings" search={{ section: 'downloads' }}>
            Open Downloader settings
          </Link>
        ) : (
          <Link to="/extensions/publish">Open sharing sessions</Link>
        )
      ) : null}
      {tool ? (
        <div aria-live="polite">
          <p>
            <strong>
              {
                {
                  available: 'Available',
                  installed: 'Installed',
                  external: 'External tool found',
                  unavailable: 'Unavailable',
                  invalid: 'Needs attention',
                }[tool.status]
              }
            </strong>
            {tool.version ? ` · ${tool.version}` : ''}
          </p>
          {confirm === 'install' && tool.sourceUrl ? (
            <p>
              Source: <code>{tool.sourceUrl}</code>
            </p>
          ) : null}
          <p>{tool.message}</p>
          {!busy && !confirm && tool.canInstall ? (
            <button type="button" onClick={() => setConfirm('install')}>
              Install companion
            </button>
          ) : null}
          {!busy && !confirm && tool.canRemove ? (
            <button type="button" onClick={() => setConfirm('remove')}>
              Remove companion
            </button>
          ) : null}
        </div>
      ) : null}
      {confirm && tool && !busy ? (
        <fieldset className="pp-managed-confirm">
          <legend>Confirm {confirm}</legend>
          <p>
            {confirm === 'install'
              ? `Install ${id}${tool.version ? ` ${tool.version}` : ''}? ${tool.installBytes ? `Download ${(tool.installBytes / 1024 / 1024).toFixed(1)} MiB from the source shown.` : 'Prepare the available local companion; no download is needed.'} The pinned companion will be verified before use.`
              : `Remove the ProtoPeek-managed ${id} companion? Other installations and user files are left alone.`}
          </p>
          <button type="button" onClick={() => void request(confirm)}>
            Confirm {confirm}
          </button>{' '}
          <button type="button" onClick={() => setConfirm(null)}>
            Cancel
          </button>
        </fieldset>
      ) : null}
    </section>
  );
}
