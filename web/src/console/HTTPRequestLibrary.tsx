import { useEffect, useMemo, useState } from 'react';
import type { HTTPDraft } from './http-draft-store';
import {
  deleteHTTPRecipe,
  exportHTTPLibrary,
  type HTTPRecipe,
  httpLibraryKey,
  readHTTPLibrary,
  resetHTTPLibrary,
  saveHTTPRecipe,
} from './http-library';
import './http-library.css';

export function HTTPRequestLibrary({
  getDraft,
  onLoad,
  onClose,
  activeRecipe,
  onSaved,
}: {
  getDraft: () => HTTPDraft;
  onLoad: (request: HTTPRecipe) => void;
  onClose: () => void;
  activeRecipe?: HTTPRecipe | null;
  onSaved?: (recipe: HTTPRecipe) => void;
}) {
  const [initial] = useState(readHTTPLibrary);
  const [requests, setRequests] = useState(initial.requests);
  const [error, setError] = useState(initial.error);
  const [notice, setNotice] = useState('');
  const [name, setName] = useState(activeRecipe?.name ?? '');
  const [selected, setSelected] = useState(activeRecipe?.id ?? '');
  const [includeBody, setIncludeBody] = useState(activeRecipe?.draft.rememberBody ?? false);
  const [filter, setFilter] = useState('');
  const [resetting, setResetting] = useState(false);
  useEffect(() => {
    if (activeRecipe === undefined) return;
    setSelected(activeRecipe?.id ?? '');
    setName(activeRecipe?.name ?? '');
    setIncludeBody(activeRecipe?.draft.rememberBody ?? false);
  }, [activeRecipe]);
  useEffect(() => {
    const reload = (event: StorageEvent) => {
      if (event.key !== null && event.key !== httpLibraryKey) return;
      const value = readHTTPLibrary();
      setRequests(value.requests);
      setError(value.error);
    };
    window.addEventListener('storage', reload);
    return () => window.removeEventListener('storage', reload);
  }, []);
  const visible = useMemo(
    () =>
      requests.filter((item) =>
        `${item.name} ${item.draft.method} ${item.draft.url}`
          .toLowerCase()
          .includes(filter.toLowerCase())
      ),
    [requests, filter]
  );
  function perform(action: () => void) {
    try {
      action();
      setError('');
    } catch (cause) {
      setNotice('');
      setError(cause instanceof Error ? cause.message : 'Saved request operation failed.');
    }
  }
  function save(replace = false) {
    perform(() => {
      const items = saveHTTPRecipe(
        name,
        { ...getDraft(), rememberBody: includeBody },
        replace ? selected : undefined
      );
      setRequests(items);
      setSelected(replace ? selected : items[0].id);
      const saved = replace ? items.find((item) => item.id === selected) : items[0];
      if (saved) onSaved?.(saved);
      setNotice('Request saved in this browser. Credentials are excluded.');
    });
  }
  function exportLibrary() {
    perform(() => {
      const url = URL.createObjectURL(
        new Blob([exportHTTPLibrary()], { type: 'application/json' })
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'protopeek-http-requests.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    });
  }
  return (
    <aside className="pp-http-library" aria-label="Saved HTTP requests">
      <header>
        <strong>
          Saved requests <small>{requests.length}/50</small>
        </strong>
        <button type="button" aria-label="Close saved requests" onClick={onClose}>
          Close
        </button>
      </header>
      <label>
        Request name
        <input
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          placeholder="Local health check"
        />
      </label>
      <label className="pp-http-library-body">
        <input
          type="checkbox"
          checked={includeBody}
          onChange={(event) => setIncludeBody(event.target.checked)}
        />
        Include this request body
      </label>
      <div className="pp-http-library-actions">
        <button type="button" disabled={!name.trim()} onClick={() => save()}>
          Save new
        </button>
        <button type="button" disabled={!selected || !name.trim()} onClick={() => save(true)}>
          Update selected
        </button>
      </div>
      <small>
        Auth is excluded. Included bodies are saved as entered; remove secrets before saving.
      </small>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <label>
        Find saved requests
        <input
          type="search"
          value={filter}
          maxLength={128}
          onChange={(event) => setFilter(event.target.value)}
        />
      </label>
      <div className="pp-http-library-list">
        {visible.map((item) => (
          <article key={item.id} className={item.id === selected ? 'is-selected' : ''}>
            <button
              type="button"
              aria-label={`Load ${item.name}`}
              onClick={() => {
                setSelected(item.id);
                setName(item.name);
                setIncludeBody(item.draft.rememberBody);
                onLoad(item);
                setNotice('Loaded into the editor. Review, enter credentials and Send when ready.');
              }}
            >
              <strong>{item.name}</strong>
              <small>
                {item.draft.method} · {item.draft.url}
              </small>
              <small>{item.draft.rememberBody ? 'Body included' : 'No saved body'}</small>
            </button>
            <button
              type="button"
              aria-label={`Delete ${item.name}`}
              onClick={() =>
                perform(() => {
                  setRequests(deleteHTTPRecipe(item.id));
                  if (item.id === selected) setSelected('');
                  setNotice('Saved request removed. The open editor is unchanged.');
                })
              }
            >
              Delete
            </button>
          </article>
        ))}
      </div>
      {!visible.length ? (
        <p>
          {requests.length
            ? 'No saved requests match.'
            : 'Save a request to reuse it after closing the browser.'}
        </p>
      ) : null}
      <footer>
        <button type="button" disabled={!requests.length} onClick={exportLibrary}>
          Export library
        </button>
        <button type="button" onClick={() => setResetting(true)}>
          Reset library
        </button>
      </footer>
      {resetting ? (
        <fieldset aria-label="Reset saved request library">
          <p>Remove all saved requests from this browser?</p>
          <button
            type="button"
            onClick={() =>
              perform(() => {
                resetHTTPLibrary();
                setRequests([]);
                setSelected('');
                setResetting(false);
                setNotice('Saved request library cleared.');
              })
            }
          >
            Remove all saved requests
          </button>
          <button type="button" onClick={() => setResetting(false)}>
            Keep requests
          </button>
        </fieldset>
      ) : null}
    </aside>
  );
}
