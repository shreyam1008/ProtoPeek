import { useEffect, useRef, useState } from 'react';
import { fetchJSON } from './api';
import './directory-picker.css';

type Listing = {
  path: string;
  parent: string;
  directories: { name: string; path: string }[];
  truncated: boolean;
};

export function DirectoryPicker({
  initialPath,
  onChoose,
}: {
  initialPath: string;
  onChoose: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<Listing | null>(null);
  const [path, setPath] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const toggle = useRef<HTMLButtonElement | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function browse(nextPath: string) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      const next = await fetchJSON<Listing>('api/transfers/directories', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: nextPath }),
      });
      if (controller.signal.aborted) return;
      setListing(next);
      setPath(next.path);
      setFilter('');
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Cannot read this directory.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function close() {
    request.current?.abort();
    setBusy(false);
    setOpen(false);
    toggle.current?.focus();
  }
  return (
    <div className="pp-directory-picker">
      <button
        ref={toggle}
        type="button"
        aria-expanded={open}
        onClick={() => {
          if (open) close();
          else {
            setOpen(true);
            setPath(initialPath);
            void browse(initialPath);
          }
        }}
      >
        Browse folders
      </button>
      {open ? (
        <section
          aria-label="Choose download folder"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
          }}
        >
          <div className="pp-directory-toolbar">
            <input
              aria-label="Folder path"
              value={path}
              maxLength={4096}
              onChange={(event) => setPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void browse(path);
                }
              }}
            />
            <button type="button" disabled={busy} onClick={() => void browse(path)}>
              Go
            </button>
            <button type="button" disabled={busy} onClick={() => void browse('')}>
              Home folder
            </button>
            <button type="button" onClick={close}>
              Close folders
            </button>
          </div>
          {error ? <p role="alert">{error}</p> : null}
          {busy ? <p role="status">Reading folders…</p> : null}
          {listing ? (
            <>
              <div className="pp-directory-toolbar">
                <button
                  type="button"
                  disabled={busy || listing.path === listing.parent}
                  onClick={() => void browse(listing.parent)}
                >
                  Up one folder
                </button>
                <span>{listing.path}</span>
              </div>
              <input
                aria-label="Filter folders"
                placeholder="Find a folder"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
              <ul aria-label="Folders">
                {listing.directories
                  .filter((entry) => entry.name.toLowerCase().includes(filter.toLowerCase()))
                  .map((entry) => (
                    <li key={entry.path}>
                      <button type="button" disabled={busy} onClick={() => void browse(entry.path)}>
                        {entry.name}
                      </button>
                    </li>
                  ))}
              </ul>
              {!listing.directories.length ? <p>No subfolders here.</p> : null}
              {listing.truncated ? (
                <p role="status">
                  Listing limited to 512 folders / 4,096 entries. Enter an exact path to reach an
                  omitted folder.
                </p>
              ) : null}
              <button
                type="button"
                disabled={busy || !!error}
                onClick={() => {
                  onChoose(listing.path);
                  close();
                }}
              >
                Use this folder
              </button>
            </>
          ) : null}
          <small>
            Folders on the computer running ProtoPeek. Browse does not create or change files.
          </small>
        </section>
      ) : null}
    </div>
  );
}
