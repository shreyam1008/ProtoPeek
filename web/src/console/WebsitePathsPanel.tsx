import { useEffect, useRef, useState } from 'react';
import { readWebsiteTargets, rememberWebsiteTarget } from './website-draft';
import { fetchWebsitePaths, type WebsitePathsResult, websitePaths } from './website-paths-api';

export default function WebsitePathsPanel({ active }: { active: boolean }) {
  const [url, setURL] = useState(() => readWebsiteTargets().origin ?? '');
  const [storageError, setStorageError] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<WebsitePathsResult | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
    },
    []
  );
  useEffect(() => {
    if (!active && controller.current) {
      controller.current.abort();
      controller.current = null;
      setBusy(false);
      setMessage('Path checks cancelled when leaving this section.');
    }
  }, [active]);
  function cancel() {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setMessage('Path checks cancelled. Requests already sent cannot be recalled.');
  }
  async function run() {
    if (!consent || busy) return;
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setConsent(false);
    setResult(null);
    setMessage('');
    try {
      const next = await fetchWebsitePaths(url, current.signal);
      if (controller.current === current) {
        setResult(next);
        setStorageError(
          rememberWebsiteTarget('origin', next.origin)
            ? ''
            : 'This browser could not remember the origin.'
        );
      }
    } catch (error) {
      if (controller.current === current)
        setMessage(error instanceof Error ? error.message : 'Path checks failed.');
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  function save() {
    const objectURL = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              ...result,
              method: 'HEAD',
              limitation:
                'No response bodies were read. Status alone does not establish that a document exists.',
            },
            null,
            2
          ),
        ],
        { type: 'application/json' }
      )
    );
    const link = document.createElement('a');
    link.href = objectURL;
    link.download = 'protopeek-website-paths.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
  }
  const comparison = result?.paths.at(-1);
  return (
    <section className="pp-security-website" aria-label="Standard website paths">
      <header>
        <div>
          <h2>Standard website paths</h2>
          <p>
            Five HEAD requests at the website origin. Up to two at a time, with a 30-second
            deadline.
          </p>
        </div>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <label htmlFor="website-path-url">Website for path checks</label>
        <div className="pp-security-query-row">
          <input
            id="website-path-url"
            type="url"
            maxLength={8192}
            value={url}
            placeholder="https://example.com/"
            disabled={busy}
            onChange={(event) => {
              setURL(event.target.value);
              setConsent(false);
              setResult(null);
              setMessage('');
            }}
          />
          {busy ? (
            <button type="button" className="pp-security-cancel" onClick={cancel}>
              Cancel checks
            </button>
          ) : (
            <button type="submit" disabled={!consent || !url.trim()}>
              Check five paths
            </button>
          )}
        </div>
        <details className="pp-security-path-plan">
          <summary>Request plan · 5 × HEAD</summary>
          <ul>
            {websitePaths.map((path) => (
              <li key={path}>
                <code>{path}</code>
                {path === websitePaths[4] ? ' · missing-path comparison' : ''}
              </li>
            ))}
          </ul>
          <p>
            The entered URL’s path is replaced with this fixed list. Redirects are reported without
            following them. No cookies, credentials, or response bodies.
          </p>
        </details>
        <label className="pp-security-disclosure">
          <input
            type="checkbox"
            checked={consent}
            disabled={busy}
            onChange={(event) => setConsent(event.target.checked)}
          />
          <span>Send these five requests from this PC to the public website.</span>
        </label>
      </form>
      <div className="pp-security-remember">
        <span>{storageError || 'Only the website origin is remembered.'}</span>
        <button
          type="button"
          disabled={busy || !url}
          onClick={() => {
            setURL('');
            setConsent(false);
            setResult(null);
            setMessage('');
            setStorageError(
              rememberWebsiteTarget('origin', '') ? '' : 'Could not clear the remembered origin.'
            );
          }}
        >
          Forget path target
        </button>
      </div>
      {busy ? (
        <p className="pp-security-path-note" role="status">
          Checking the fixed path plan…
        </p>
      ) : null}
      {message ? (
        <p className="pp-security-path-note" role="status">
          {message}
        </p>
      ) : null}
      {result ? (
        <div className="pp-security-path-results">
          <header>
            <strong>{result.origin}</strong>
            <span>
              {new Date(result.observedAt).toLocaleString()} ·{' '}
              {result.partial ? 'Partial evidence' : '5 responses'}
            </span>
            <button type="button" onClick={save}>
              Save path report
            </button>
          </header>
          <p className="pp-security-path-note">
            HEAD reports response metadata. It cannot verify a document’s contents or establish that
            the site is secure.
          </p>
          {comparison?.statusCode === 200 ? (
            <p className="pp-security-path-note">
              The missing-path comparison also returned 200. This site may serve a fallback page for
              paths that do not exist.
            </p>
          ) : null}
          <div className="pp-security-path-table">
            <table>
              <thead>
                <tr>
                  <th>Path</th>
                  <th>Status</th>
                  <th>Content type</th>
                  <th>Bytes reported</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {result.paths.map((entry) => (
                  <tr key={entry.path}>
                    <td>
                      <code>{entry.path}</code>
                      {entry.redirectLocation ? (
                        <small>Redirect: {entry.redirectLocation}</small>
                      ) : null}
                      {entry.error ? <small>{entry.error}</small> : null}
                    </td>
                    <td>{entry.statusCode ?? 'Failed'}</td>
                    <td>{entry.contentType || '—'}</td>
                    <td>{entry.contentLength || '—'}</td>
                    <td>{entry.statusCode ? `${entry.totalMs.toFixed(1)} ms` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
