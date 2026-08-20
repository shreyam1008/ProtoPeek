import { FileCode2, FolderOpen, RefreshCw, X } from 'lucide-react';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';

import {
  type BrowserProtoFolderSelection,
  enumerateBrowserProtoDirectory,
  enumerateWebkitProtoFiles,
  formatProtoFolderBytes,
  type ProtoDirectoryHandle,
} from '@/shared/proto-folder';

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options: { id: string; mode: 'read' }) => Promise<ProtoDirectoryHandle>;
};

const previewLimit = 6;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The folder could not be read.';
}

function isPickerCancellation(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function BrowserProtoFolderPicker({
  selection,
  onChange,
  onBusyChange,
  disabled,
}: {
  selection: BrowserProtoFolderSelection | null;
  onChange: (selection: BrowserProtoFolderSelection | null) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeEnumerationRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      generationRef.current++;
      activeEnumerationRef.current?.abort();
      activeEnumerationRef.current = null;
    },
    []
  );

  useEffect(() => {
    inputRef.current?.setAttribute('webkitdirectory', '');
  }, []);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(() => {
    if (!disabled) return;
    generationRef.current++;
    activeEnumerationRef.current?.abort();
    activeEnumerationRef.current = null;
    setBusy(false);
  }, [disabled]);

  function startFallbackPick() {
    generationRef.current++;
    activeEnumerationRef.current?.abort();
    activeEnumerationRef.current = null;
    setBusy(false);
    setError(null);
    inputRef.current?.click();
  }

  function chooseFolder() {
    if (disabled) return;
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      startFallbackPick();
      return;
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    activeEnumerationRef.current?.abort();
    const controller = new AbortController();
    activeEnumerationRef.current = controller;
    setBusy(true);
    setError(null);

    // Keep this call in the click activation. Safari/Chromium can reject delayed picker calls.
    let picked: Promise<ProtoDirectoryHandle>;
    try {
      picked = picker({ id: 'protopeek-protos', mode: 'read' });
    } catch (pickError) {
      activeEnumerationRef.current = null;
      setBusy(false);
      if (!isPickerCancellation(pickError)) setError(errorMessage(pickError));
      return;
    }
    void picked
      .then((directory) => enumerateBrowserProtoDirectory(directory, controller.signal))
      .then((nextSelection) => {
        if (generationRef.current !== generation || controller.signal.aborted) return;
        onChange(nextSelection);
      })
      .catch((pickError: unknown) => {
        if (
          generationRef.current !== generation ||
          controller.signal.aborted ||
          isPickerCancellation(pickError)
        ) {
          return;
        }
        setError(errorMessage(pickError));
      })
      .finally(() => {
        if (generationRef.current !== generation) return;
        activeEnumerationRef.current = null;
        setBusy(false);
      });
  }

  function handleFallbackFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = event.currentTarget.files;
    event.currentTarget.value = '';
    if (!files || files.length === 0) return;
    generationRef.current++;
    activeEnumerationRef.current?.abort();
    activeEnumerationRef.current = null;
    setBusy(false);
    setError(null);
    try {
      onChange(enumerateWebkitProtoFiles(files));
    } catch (selectionError) {
      setError(errorMessage(selectionError));
    }
  }

  function clearFolder() {
    generationRef.current++;
    activeEnumerationRef.current?.abort();
    activeEnumerationRef.current = null;
    setBusy(false);
    setError(null);
    onChange(null);
  }

  return (
    <div className="pp-proto-folder-picker">
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept=".proto"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleFallbackFiles}
      />

      {selection ? (
        <section className="pp-proto-folder-manifest" aria-label="Selected proto folder">
          <div className="pp-proto-folder-heading">
            <span className="pp-proto-folder-icon" aria-hidden="true">
              <FolderOpen />
            </span>
            <div className="min-w-0 flex-1">
              <strong className="pp-proto-folder-root">{selection.rootName}</strong>
              <div className="pp-proto-folder-summary" aria-live="polite">
                {selection.files.length} proto {selection.files.length === 1 ? 'file' : 'files'} ·{' '}
                {formatProtoFolderBytes(selection.totalBytes)}
                {selection.ignoredFileCount > 0
                  ? ` · ${selection.ignoredFileCount} non-proto ignored`
                  : ''}
              </div>
            </div>
            <div className="pp-proto-folder-actions">
              <button
                type="button"
                className="pp-button-ghost"
                aria-label="Replace proto folder"
                disabled={disabled || busy}
                onClick={chooseFolder}
              >
                <RefreshCw className={busy ? 'animate-spin' : ''} aria-hidden="true" />
                <span>Replace</span>
              </button>
              <button
                type="button"
                className="pp-button-ghost"
                aria-label="Clear proto folder"
                disabled={disabled}
                onClick={clearFolder}
              >
                <X aria-hidden="true" />
              </button>
            </div>
          </div>
          <ol className="pp-proto-folder-preview" aria-label="Proto file preview">
            {selection.files.slice(0, previewLimit).map((entry) => (
              <li key={entry.path} title={entry.path}>
                <FileCode2 aria-hidden="true" />
                <span>{entry.path}</span>
              </li>
            ))}
          </ol>
          {selection.files.length > previewLimit ? (
            <div className="pp-proto-folder-more">
              +{selection.files.length - previewLimit} more files in the upload manifest
            </div>
          ) : null}
          <p className="pp-proto-folder-boundary">
            On Connect, these files upload temporarily to this ProtoPeek instance—never to the gRPC
            target. Imports must resolve inside this selected root. Folder access is never saved.
          </p>
        </section>
      ) : (
        <div className="pp-proto-folder-empty">
          <div>
            <strong id="pp-browser-proto-folder-required">Folder required</strong>
            <p>
              Choose a local root. On Connect, lowercase .proto files upload temporarily to this
              ProtoPeek instance—never to the gRPC target. Imports must stay inside the root; folder
              access is never saved.
            </p>
          </div>
          <button
            type="button"
            className="pp-button-secondary"
            aria-label="Choose proto folder"
            disabled={disabled || busy}
            onClick={chooseFolder}
          >
            <FolderOpen aria-hidden="true" />
            {busy ? 'Reading folder…' : 'Choose folder'}
          </button>
        </div>
      )}

      {error ? (
        <p className="pp-proto-folder-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
