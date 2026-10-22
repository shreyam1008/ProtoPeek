import { useEffect, useMemo, useRef, useState } from 'react';
import { sanitizeURLForPersistence } from '@/shared/utils';
import { type ImportedHTTPRequest, parseCurlCommand } from './http-curl-import';
import './http-tools.css';

export function HTTPImportPanel({
  onLoad,
  onClose,
}: {
  onLoad: (request: ImportedHTTPRequest) => void;
  onClose: () => void;
}) {
  const [command, setCommand] = useState('');
  const [preview, setPreview] = useState<ImportedHTTPRequest | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const safeURL = useMemo(
    () => (preview ? sanitizeURLForPersistence(preview.draft.url) : ''),
    [preview]
  );
  return (
    <section
      className="pp-http-tools-panel pp-http-curl-import"
      aria-label="Import cURL"
      data-pp-shortcut-scope
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <header>
        <strong>Import cURL</strong>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>
      <p>
        Paste Copy as cURL (bash/POSIX). One HTTP(S) URL, method, headers, inline body and timeout.
        No shell execution, files, proxies or insecure TLS. Credentials stay in memory.
      </p>
      <label>
        cURL command
        <textarea
          ref={inputRef}
          value={command}
          maxLength={512 * 1024}
          spellCheck={false}
          onChange={(event) => {
            setCommand(event.target.value);
            setPreview(null);
            setError('');
          }}
        />
      </label>
      <button
        type="button"
        disabled={!command.trim()}
        onClick={() => {
          try {
            setPreview(parseCurlCommand(command));
            setError('');
          } catch (cause) {
            setPreview(null);
            setError(cause instanceof Error ? cause.message : 'The command could not be imported.');
          }
        }}
      >
        Preview request
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {preview ? (
        <fieldset aria-label="cURL request preview">
          <p>
            <strong>{preview.draft.method}</strong> {safeURL}
          </p>
          <p>
            {preview.draft.headers.length} headers ·{' '}
            {new TextEncoder().encode(preview.draft.body).length} body bytes ·{' '}
            {preview.draft.timeoutSeconds}s timeout
          </p>
          <p>
            {preview.credentialCount} credential fields stay in the live editor. Body text is
            imported verbatim and is not saved automatically.
          </p>
          {preview.notices?.map((notice) => (
            <p key={notice}>{notice}</p>
          ))}
          <button type="button" onClick={() => onLoad(preview)}>
            Load into editor
          </button>
        </fieldset>
      ) : null}
    </section>
  );
}
