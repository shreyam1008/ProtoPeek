import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { fetchJSON } from './api';

type ManagedID = 'cloudflared' | 'aria2';
type Tool = {
  id: ManagedID;
  status: 'available' | 'installed' | 'external' | 'unavailable' | 'invalid' | 'incomplete';
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
  const repairable = id === 'aria2' && (v.status === 'invalid' || v.status === 'incomplete');
  if (
    v.id !== id ||
    !['available', 'installed', 'external', 'unavailable', 'invalid', 'incomplete'].includes(
      String(v.status)
    ) ||
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
    (v.status === 'incomplete' && id !== 'aria2') ||
    (v.canInstall && (v.installBytes as number) > 0 && !v.sourceUrl) ||
    (v.canRemove && v.status !== 'installed' && v.status !== 'incomplete') ||
    (v.canInstall && v.status !== 'available' && v.status !== 'external' && !repairable)
  )
    throw new Error('Invalid companion status.');
  return v as Tool;
}

export function ManagedExtension({ id }: { id: ManagedID }) {
  const [tool, setTool] = useState<Tool | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
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
    setConfirmRemove(false);
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
          {tool ? 'Refresh status' : 'Check companion status'}
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
                  incomplete: 'Incomplete setup',
                }[tool.status]
              }
            </strong>
            {tool.version ? ` · ${tool.version}` : ''}
          </p>
          {tool.canInstall && tool.sourceUrl ? (
            <p>
              Source:{' '}
              <a href={tool.sourceUrl} target="_blank" rel="noreferrer">
                {tool.sourceUrl}
              </a>
            </p>
          ) : null}
          <p>{tool.message}</p>
          {!busy && tool.canInstall ? (
            <>
              <p>
                {tool.installBytes
                  ? 'Download ' +
                    (tool.installBytes / 1024 / 1024).toFixed(1) +
                    ' MiB. ProtoPeek verifies the pinned file before use.'
                  : 'Uses the verified local archive. No download is needed.'}
              </p>
              <button type="button" onClick={() => void request('install')}>
                {tool.status === 'invalid' || tool.status === 'incomplete'
                  ? 'Repair companion'
                  : tool.installBytes
                    ? 'Confirm install'
                    : 'Prepare local engine'}
              </button>
            </>
          ) : null}
          {!busy && !confirmRemove && tool.canRemove ? (
            <button type="button" onClick={() => setConfirmRemove(true)}>
              Remove companion
            </button>
          ) : null}
        </div>
      ) : null}
      {confirmRemove && tool && !busy ? (
        <fieldset className="pp-managed-confirm">
          <legend>Remove companion?</legend>
          <p>Remove the verified {id} files from the ProtoPeek cache?</p>
          <button type="button" onClick={() => void request('remove')}>
            Confirm remove
          </button>{' '}
          <button type="button" onClick={() => setConfirmRemove(false)}>
            Cancel
          </button>
        </fieldset>
      ) : null}
    </section>
  );
}
