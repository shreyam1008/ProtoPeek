import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJSON } from './api';
import type { CommunityExtension } from './community-catalog';
import { PinExtension } from './MediaPacks';
import { PageHeader } from './shell/PageHeader';
import './extension-details.css';

type Tool = {
  id: string;
  status: 'available' | 'installed' | 'unavailable' | 'invalid';
  version: string;
  installBytes: number;
  canInstall: boolean;
  canRemove: boolean;
  message: string;
  sourceUrl?: string;
  path?: string;
  recoveryPath?: string;
};

function hasControl(value: string) {
  return [...value].some(
    (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
  );
}

function parseTool(value: unknown, id: string): Tool {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Could not read companion status.');
  const tool = value as Record<string, unknown>;
  const validSource =
    tool.sourceUrl === undefined ||
    (typeof tool.sourceUrl === 'string' &&
      tool.sourceUrl.length <= 2048 &&
      /^https:\/\/[^\s/@]+\//.test(tool.sourceUrl));
  if (
    tool.id !== id ||
    !['available', 'installed', 'unavailable', 'invalid'].includes(String(tool.status)) ||
    typeof tool.version !== 'string' ||
    tool.version.length > 128 ||
    !Number.isSafeInteger(tool.installBytes) ||
    (tool.installBytes as number) < 0 ||
    typeof tool.canInstall !== 'boolean' ||
    typeof tool.canRemove !== 'boolean' ||
    typeof tool.message !== 'string' ||
    tool.message.length > 2048 ||
    !validSource ||
    (tool.path !== undefined &&
      (tool.status !== 'installed' ||
        typeof tool.path !== 'string' ||
        tool.path.length > 4096 ||
        hasControl(tool.path))) ||
    (tool.recoveryPath !== undefined &&
      (tool.status !== 'invalid' ||
        typeof tool.recoveryPath !== 'string' ||
        tool.recoveryPath.length > 4096 ||
        hasControl(tool.recoveryPath))) ||
    (tool.canInstall && (tool.status !== 'available' || !tool.sourceUrl)) ||
    (tool.canRemove && tool.status !== 'installed')
  )
    throw new Error('Could not read companion status.');
  return tool as Tool;
}

export function CommunityExtensionSetup({ entry }: { entry: CommunityExtension }) {
  const [tool, setTool] = useState<Tool | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const removeButton = useRef<HTMLButtonElement | null>(null);
  const confirmButton = useRef<HTMLButtonElement | null>(null);
  const wasConfirming = useRef(false);

  useEffect(() => {
    if (confirmRemove) confirmButton.current?.focus();
    else if (wasConfirming.current && !busy && tool?.canRemove) removeButton.current?.focus();
    wasConfirming.current = confirmRemove;
  }, [confirmRemove, busy, tool?.canRemove]);

  const request = useCallback(
    async (action?: 'install' | 'remove') => {
      if (controller.current) return;
      const abort = new AbortController();
      controller.current = abort;
      setBusy(true);
      setNotice('');
      setConfirmRemove(false);
      try {
        const result = await fetchJSON<unknown>(
          action
            ? `api/extensions/managed/${action}`
            : `api/extensions/managed?id=${encodeURIComponent(entry.id)}`,
          action
            ? {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: entry.id }),
                signal: abort.signal,
              }
            : { cache: 'no-store', signal: abort.signal }
        );
        if (controller.current === abort && !abort.signal.aborted)
          setTool(parseTool(result, entry.id));
      } catch (error) {
        if (controller.current === abort && !abort.signal.aborted) {
          setTool(null);
          const message =
            error instanceof Error ? error.message : 'Could not manage the companion.';
          setNotice(action ? `${message} Check status before trying again.` : message);
        }
      } finally {
        if (controller.current === abort) {
          controller.current = null;
          setBusy(false);
        }
      }
    },
    [entry.id]
  );

  useEffect(() => {
    void request();
    return () => {
      controller.current?.abort();
      controller.current = null;
    };
  }, [request]);

  function stop() {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setTool(null);
    setNotice(
      'Stopped waiting. Refresh status before trying again; the operation may still finish.'
    );
  }

  async function copy(text: string, description: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`${description} copied.`);
    } catch {
      setNotice('Clipboard unavailable. Select and copy the text.');
    }
  }

  return (
    <section
      className="pp-panel pp-managed-extension"
      aria-label={`${entry.name} managed companion`}
    >
      <h2>Managed companion</h2>
      {busy ? (
        <>
          <p role="status">{tool ? 'Working on the host…' : 'Checking the host…'}</p>
          <button type="button" onClick={stop}>
            Stop waiting
          </button>
        </>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {tool ? (
        <div aria-live="polite">
          <p>
            <strong>
              {tool.status === 'available'
                ? 'Available'
                : tool.status === 'installed'
                  ? 'Installed'
                  : tool.status === 'invalid'
                    ? 'Needs attention'
                    : 'Unavailable'}
            </strong>
            {tool.version ? ` · ${tool.version}` : ''}
          </p>
          <p>{tool.message}</p>
          {tool.recoveryPath ? (
            <div>
              <p>Expected path on the ProtoPeek host</p>
              <code>{tool.recoveryPath}</code>{' '}
              <button
                type="button"
                onClick={() => void copy(tool.recoveryPath as string, 'Expected path')}
              >
                Copy path
              </button>
            </div>
          ) : null}
          {tool.path ? (
            <div>
              <p>Run the installed CLI tool in a terminal on the ProtoPeek host</p>
              <code>{`pp extensions run ${entry.id} --help`}</code>{' '}
              <button
                type="button"
                onClick={() => void copy(`pp extensions run ${entry.id} --help`, 'Command')}
              >
                Copy command
              </button>
              <p>Executable on the ProtoPeek host</p>
              <code>{tool.path}</code>{' '}
              <button
                type="button"
                onClick={() => void copy(tool.path as string, 'Executable path')}
              >
                Copy path
              </button>
              <p>The installation does not change PATH.</p>
            </div>
          ) : null}
          {tool.canInstall && tool.sourceUrl ? (
            <p>
              Download {(tool.installBytes / 1048576).toFixed(1)} MiB from{' '}
              <a href={tool.sourceUrl} target="_blank" rel="noreferrer">
                the pinned release
              </a>
              . ProtoPeek verifies the downloaded file.
            </p>
          ) : null}
          {!busy && tool.canInstall ? (
            <button
              className="pp-button-primary"
              type="button"
              onClick={() => void request('install')}
            >
              Install {entry.name}
            </button>
          ) : null}
          {!busy && tool.canRemove && !confirmRemove ? (
            <button ref={removeButton} type="button" onClick={() => setConfirmRemove(true)}>
              Remove {entry.name}
            </button>
          ) : null}
        </div>
      ) : null}
      {!busy ? (
        <button type="button" onClick={() => void request()}>
          {tool ? 'Refresh status' : 'Check companion status'}
        </button>
      ) : null}
      {confirmRemove && !busy ? (
        <fieldset className="pp-managed-confirm">
          <legend>Remove {entry.name}?</legend>
          <p>Remove the verified companion from the ProtoPeek cache?</p>
          <button ref={confirmButton} type="button" onClick={() => void request('remove')}>
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

export function CommunityExtensionDetail({
  entry,
  pinned,
  onPin,
}: {
  entry: CommunityExtension;
  pinned: boolean;
  onPin: () => void;
}) {
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <article className="pp-extension-detail">
      <PageHeader>
        <div>
          <span className="pp-extension-level">Managed CLI companion</span>
          <h1 ref={heading} tabIndex={-1}>
            {entry.name}
          </h1>
          <p>{entry.description}</p>
        </div>
        <PinExtension name={entry.name} pinned={pinned} onPin={onPin} />
      </PageHeader>
      <CommunityExtensionSetup entry={entry} />
      <p>
        <a href={entry.source} target="_blank" rel="noreferrer">
          Project documentation
        </a>{' '}
        · {entry.license}
      </p>
    </article>
  );
}
